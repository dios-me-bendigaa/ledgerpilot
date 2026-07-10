import { Menu, app, BrowserWindow, dialog, ipcMain } from 'electron';
import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  type ImportBatch,
  maxImportFilesPerBatch,
  workspaceBlueprint,
  CategoryOverrideRequest,
  CategoryRulesPayload,
  CustomCategoriesPayload,
  CategorySuggestionPayload,
  DashboardData,
  ExportPayload,
  Goal,
  GoalsPayload,
  ImportFileDescriptor,
  ImportHistory,
  ImportWorkflowResult,
  NormalizationHistory,
  NormalizationReport,
  NormalizedTransaction,
  ResumeImportResult,
  ReviewTransaction,
  SavingsPlan,
  SettingsPayload,
  BackupHistory,
  BackupRecord
} from '@ledgerpilot/core';
import { ImportEngine } from '@ledgerpilot/import-engine';

import { getDashboardData, setCustomCategoryBuckets } from './analytics.js';
import {
  ensureAiService,
  requestAdvisorResponse,
  requestCategorySuggestions,
  requestSavingsPlan,
  shutdownAiService
} from './ai-service.js';
import {
  createEncryptedBackup,
  deleteGoal,
  exportWorkspaceData,
  loadApiKey,
  loadBackupHistory,
  loadGoals,
  loadSettings,
  saveSettings,
  upsertGoal
} from './local-state.js';

const isDev = !app.isPackaged;
const workspaceName = 'LedgerPilot';

let database: Database.Database;
let mainWindow: BrowserWindow | null = null;
let startupError: string | null = null;
let isReprocessing = false;

const getWorkspaceRoot = () => path.join(app.getPath('appData'), workspaceName);
const getDatabasePath = () => path.join(getWorkspaceRoot(), 'database', 'ledgerpilot.sqlite');
const getCategoryRulesPath = () => path.join(getWorkspaceRoot(), 'rules', 'category-rules.json');
const getCustomCategoriesPath = () => path.join(getWorkspaceRoot(), 'rules', 'custom-categories.json');
const getLogPath = () => path.join(getWorkspaceRoot(), 'logs', 'desktop.log');

const writeLog = async (message: string) => {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await fs.mkdir(path.dirname(getLogPath()), { recursive: true });
  await fs.appendFile(getLogPath(), line, 'utf8');
};

const installApplicationMenu = () => {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'LedgerPilot',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Focus Dashboard',
          accelerator: 'CmdOrCtrl+1',
          click: () => {
            mainWindow?.focus();
          }
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Show Logs Location',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'LedgerPilot Logs',
              message: `Logs are stored at:\n${getLogPath()}`
            });
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const readNormalizationReports = async (): Promise<NormalizationHistory> => {
  const reportsDirectory = path.join(getWorkspaceRoot(), 'reports');

  try {
    const reportFiles = await fs.readdir(reportsDirectory);
    const reports = await Promise.all(
      reportFiles
        .filter((file) => file.endsWith('.json') && file !== 'index.json')
        .map(async (file) => {
          const content = await fs.readFile(path.join(reportsDirectory, file), 'utf8');
          return JSON.parse(content) as NormalizationReport;
        }),
    );

    reports.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return { reports };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return { reports: [] };
    }

    throw error;
  }
};

const readCategoryRules = async (): Promise<CategoryRulesPayload> => {
  try {
    const content = await fs.readFile(getCategoryRulesPath(), 'utf8');
    return JSON.parse(content) as CategoryRulesPayload;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return { rules: [] };
    }

    throw error;
  }
};

const writeCategoryRules = async (payload: CategoryRulesPayload) => {
  await fs.mkdir(path.dirname(getCategoryRulesPath()), { recursive: true });
  await fs.writeFile(getCategoryRulesPath(), JSON.stringify(payload, null, 2), 'utf8');
};

const readCustomCategories = async (): Promise<CustomCategoriesPayload> => {
  try {
    const content = await fs.readFile(getCustomCategoriesPath(), 'utf8');
    return JSON.parse(content) as CustomCategoriesPayload;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { categories: [] };
    }
    throw error;
  }
};

const writeCustomCategories = async (payload: CustomCategoriesPayload) => {
  await fs.mkdir(path.dirname(getCustomCategoriesPath()), { recursive: true });
  await fs.writeFile(getCustomCategoriesPath(), JSON.stringify(payload, null, 2), 'utf8');
};

// Register custom-category buckets with analytics, then compute the dashboard. Every dashboard
// read goes through here so custom income/transfer categories are bucketed correctly.
const buildDashboard = async (): Promise<DashboardData> => {
  const custom = await readCustomCategories();
  setCustomCategoryBuckets(custom.categories);
  return getDashboardData(database);
};

const initializeDatabase = async () => {
  const dbPath = getDatabasePath();
  await writeLog(`initializeDatabase path=${dbPath}`);
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  database = new Database(dbPath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      import_record_id TEXT NOT NULL,
      source_format TEXT NOT NULL,
      account_name TEXT NOT NULL,
      posted_at TEXT NOT NULL,
      posted_date TEXT NOT NULL,
      posted_time TEXT,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      description_raw TEXT NOT NULL,
      merchant_normalized TEXT NOT NULL,
      category TEXT NOT NULL,
      transaction_kind TEXT NOT NULL,
      confidence_score REAL NOT NULL,
      fingerprint TEXT NOT NULL UNIQUE,
      is_duplicate INTEGER NOT NULL,
      is_internal_transfer INTEGER NOT NULL,
      transfer_pair_key TEXT,
      requires_review INTEGER NOT NULL,
      metadata_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_transactions_posted_at ON transactions (posted_at);
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions (category);
    CREATE INDEX IF NOT EXISTS idx_transactions_account_name ON transactions (account_name);
    CREATE INDEX IF NOT EXISTS idx_transactions_requires_review ON transactions (requires_review);
  `);
  await writeLog(`initializeDatabase ready`);
};

const persistTransactions = (transactions: NormalizedTransaction[], upsert = false) => {
  const sql = upsert
    ? `INSERT INTO transactions (
        id, batch_id, import_record_id, source_format, account_name, posted_at,
        posted_date, posted_time, amount, currency, description_raw,
        merchant_normalized, category, transaction_kind, confidence_score,
        fingerprint, is_duplicate, is_internal_transfer, transfer_pair_key,
        requires_review, metadata_json
      ) VALUES (
        @id, @batchId, @importRecordId, @sourceFormat, @accountName, @postedAt,
        @postedDate, @postedTime, @amount, @currency, @descriptionRaw,
        @merchantNormalized, @category, @transactionKind, @confidenceScore,
        @fingerprint, @isDuplicate, @isInternalTransfer, @transferPairKey,
        @requiresReview, @metadataJson
      ) ON CONFLICT(id) DO UPDATE SET
        category = excluded.category,
        transaction_kind = excluded.transaction_kind,
        is_internal_transfer = excluded.is_internal_transfer,
        transfer_pair_key = excluded.transfer_pair_key,
        requires_review = excluded.requires_review,
        confidence_score = excluded.confidence_score`
    : `INSERT OR IGNORE INTO transactions (
        id, batch_id, import_record_id, source_format, account_name, posted_at,
        posted_date, posted_time, amount, currency, description_raw,
        merchant_normalized, category, transaction_kind, confidence_score,
        fingerprint, is_duplicate, is_internal_transfer, transfer_pair_key,
        requires_review, metadata_json
      ) VALUES (
        @id, @batchId, @importRecordId, @sourceFormat, @accountName, @postedAt,
        @postedDate, @postedTime, @amount, @currency, @descriptionRaw,
        @merchantNormalized, @category, @transactionKind, @confidenceScore,
        @fingerprint, @isDuplicate, @isInternalTransfer, @transferPairKey,
        @requiresReview, @metadataJson
      )`;

  const stmt = database.prepare(sql);

  const transaction = database.transaction((records: NormalizedTransaction[]) => {
    for (const record of records) {
      stmt.run({
        ...record,
        postedTime: record.postedTime ?? null,
        transferPairKey: record.transferPairKey ?? null,
        isDuplicate: record.isDuplicate ? 1 : 0,
        isInternalTransfer: record.isInternalTransfer ? 1 : 0,
        requiresReview: record.requiresReview ? 1 : 0
      });
    }
  });

  transaction(transactions.filter((record) => !record.isDuplicate));
};

const getReviewTransactions = (): ReviewTransaction[] => {
  const rows = database
    .prepare(
      `SELECT id, account_name, posted_at, amount, description_raw, merchant_normalized, category, confidence_score
       FROM transactions
       WHERE requires_review = 1
       ORDER BY posted_at DESC
       LIMIT 50`,
    )
    .all() as Array<{
      id: string;
      account_name: string;
      posted_at: string;
      amount: number;
      description_raw: string;
      merchant_normalized: string;
      category: ReviewTransaction['currentCategory'];
      confidence_score: number;
    }>;

  return rows.map((row) => ({
    id: row.id,
    accountName: row.account_name,
    postedAt: row.posted_at,
    amount: row.amount,
    descriptionRaw: row.description_raw,
    merchantNormalized: row.merchant_normalized,
    currentCategory: row.category,
    confidenceScore: row.confidence_score
  }));
};

const getRecentTransactions = (limit = 250): ReviewTransaction[] => {
  const rows = database
    .prepare(
      `SELECT id, account_name, posted_at, amount, description_raw, merchant_normalized, category, confidence_score
       FROM transactions
       WHERE is_internal_transfer = 0
       ORDER BY posted_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
      id: string;
      account_name: string;
      posted_at: string;
      amount: number;
      description_raw: string;
      merchant_normalized: string;
      category: ReviewTransaction['currentCategory'];
      confidence_score: number;
    }>;

  return rows.map((row) => ({
    id: row.id,
    accountName: row.account_name,
    postedAt: row.posted_at,
    amount: row.amount,
    descriptionRaw: row.description_raw,
    merchantNormalized: row.merchant_normalized,
    currentCategory: row.category,
    confidenceScore: row.confidence_score
  }));
};

// Every transaction (including paired transfers), newest first — backs the full transaction view
// where the user can reassign any row's category, not just the low-confidence review queue.
const getAllTransactions = (limit = 5000): ReviewTransaction[] => {
  const rows = database
    .prepare(
      `SELECT id, account_name, posted_at, amount, description_raw, merchant_normalized, category, confidence_score
       FROM transactions
       WHERE is_duplicate = 0
       ORDER BY posted_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
      id: string;
      account_name: string;
      posted_at: string;
      amount: number;
      description_raw: string;
      merchant_normalized: string;
      category: ReviewTransaction['currentCategory'];
      confidence_score: number;
    }>;

  return rows.map((row) => ({
    id: row.id,
    accountName: row.account_name,
    postedAt: row.posted_at,
    amount: row.amount,
    descriptionRaw: row.description_raw,
    merchantNormalized: row.merchant_normalized,
    currentCategory: row.category,
    confidenceScore: row.confidence_score
  }));
};

const applyCategoryRuleOverrides = async (suggestions: CategorySuggestionPayload): Promise<CategorySuggestionPayload> => {
  const rules = await readCategoryRules();

  return {
    suggestions: suggestions.suggestions.map((suggestion) => {
      const reviewTransaction = getReviewTransactions().find((transaction) => transaction.id === suggestion.transactionId);
      if (!reviewTransaction) {
        return suggestion;
      }

      const matchedRule = rules.rules.find((rule) =>
        reviewTransaction.merchantNormalized.includes(rule.merchantPattern),
      );

      if (!matchedRule) {
        return suggestion;
      }

      return {
        ...suggestion,
        suggestedCategory: matchedRule.category,
        confidenceScore: Math.max(suggestion.confidenceScore, 0.99),
        rationale: `Matched saved rule for ${matchedRule.merchantPattern}.`
      };
    })
  };
};

const saveCategoryOverride = async (request: CategoryOverrideRequest) => {
  const rules = await readCategoryRules();
  const merchantPattern = request.merchantNormalized;
  const existing = rules.rules.find((rule) => rule.merchantPattern === merchantPattern);
  const nextRules = existing
    ? rules.rules.map((rule) =>
        rule.merchantPattern === merchantPattern
          ? { ...rule, category: request.category }
          : rule,
      )
    : [
        ...rules.rules,
        {
          id: crypto.randomUUID(),
          merchantPattern,
          category: request.category,
          createdAt: new Date().toISOString()
        }
      ];

  await writeCategoryRules({ rules: nextRules });

  // Teach once, apply to all: unless explicitly scoped to one row, re-categorize every transaction
  // sharing this merchant pattern (existing + future imports pick it up via applyCategoryRuleOverrides).
  if (request.applyToAll === false) {
    database
      .prepare('UPDATE transactions SET category = ?, requires_review = 0 WHERE id = ?')
      .run(request.category, request.transactionId);
  } else {
    const result = database
      .prepare('UPDATE transactions SET category = ?, requires_review = 0 WHERE merchant_normalized LIKE ?')
      .run(request.category, `%${merchantPattern}%`);
    void writeLog(`categorization:override merchant="${merchantPattern}" -> ${request.category} applied to ${result.changes} transaction(s)`);
  }

  return { rules: nextRules };
};

const importEngine = new ImportEngine({
  workspaceRoot: getWorkspaceRoot(),
  logger: (message) => void writeLog(`[import] ${message}`),
  onBatchImported: async ({
    batch,
    report,
    transactions
  }: {
    batch: ImportBatch;
    report: NormalizationReport;
    transactions: NormalizedTransaction[];
    history: ImportHistory;
  }) => {
    void writeLog(
      `normalization complete batchId=${batch.id} ` +
      `total=${report.summary.totalRows} inserted=${report.summary.insertedTransactions} ` +
      `duplicates=${report.summary.duplicateTransactions} formats=${JSON.stringify(report.summary.sourceFormats)}`
    );
    persistTransactions(transactions, isReprocessing);
    void writeLog(`persistTransactions done non-duplicate count=${transactions.filter((t) => !t.isDuplicate).length}`);
  }
});

const ensureWorkspace = async () => {
  const root = getWorkspaceRoot();
  await writeLog(`ensureWorkspace root=${root}`);
  await Promise.all(
    workspaceBlueprint.map((entry) => fs.mkdir(path.join(root, entry), { recursive: true })),
  );
  await writeLog(`ensureWorkspace done`);
};

const toFileDescriptor = async (filePath: string): Promise<ImportFileDescriptor> => {
  const stats = await fs.stat(filePath);

  return {
    name: path.basename(filePath),
    path: filePath,
    size: stats.size,
    lastModifiedMs: stats.mtimeMs
  };
};

const buildExportPayload = async () => {
  const [settings, goals, dashboard, normalizationHistory, backups, rules] = await Promise.all([
    loadSettings(getWorkspaceRoot()),
    loadGoals(getWorkspaceRoot()),
    buildDashboard(),
    readNormalizationReports(),
    loadBackupHistory(getWorkspaceRoot()),
    readCategoryRules()
  ]);

  return {
    exportedAt: new Date().toISOString(),
    dashboard,
    settings,
    goals,
    normalizationHistory,
    backups,
    categoryRules: rules,
    reviewTransactions: getReviewTransactions(),
    recentTransactions: getRecentTransactions(100)
  };
};

const registerIpcHandlers = () => {
  ipcMain.handle('imports:select-files', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import CSV files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'CSV files', extensions: ['csv'] }]
    });

    if (result.canceled) {
      return [] as ImportFileDescriptor[];
    }

    return Promise.all(result.filePaths.slice(0, maxImportFilesPerBatch).map(toFileDescriptor));
  });

  ipcMain.handle('imports:start', async (_event, files: ImportFileDescriptor[]) => {
    void writeLog(`imports:start files=${files.map((f) => f.name).join(', ')}`);
    try {
      const result = await importEngine.importFiles(files);
      void writeLog(`imports:start complete batchId=${result.batch.id} status=${result.batch.status}`);
      return result as ImportWorkflowResult;
    } catch (error) {
      void writeLog(`imports:start error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      throw error;
    }
  });

  ipcMain.handle('imports:history', async () => {
    return importEngine.getHistory() as Promise<ImportHistory>;
  });

  ipcMain.handle('imports:resume', async (_event, batchId: string) => {
    return importEngine.resumeFailedBatch(batchId) as Promise<ResumeImportResult>;
  });

  ipcMain.handle('normalization:rerun-batch', async (_event, batchId: string) => {
    void writeLog(`normalization:rerun-batch batchId=${batchId}`);
    isReprocessing = true;
    try {
      return await importEngine.renormalizeBatch(batchId) as NormalizationReport | undefined;
    } finally {
      isReprocessing = false;
    }
  });

  ipcMain.handle('normalization:history', async () => {
    return readNormalizationReports() as Promise<NormalizationHistory>;
  });

  ipcMain.handle('transactions:summary', async () => {
    const dashboard = await buildDashboard();
    return {
      totalTransactions: getRecentTransactions(100000).length,
      income: dashboard.kpis.income,
      expenses: dashboard.kpis.expenses,
      reviewCount: dashboard.kpis.reviewCount,
      internalTransfers: dashboard.kpis.internalTransfers,
      topCategories: dashboard.topExpenseCategories
    };
  });

  ipcMain.handle('transactions:review', async () => {
    return { transactions: getReviewTransactions() };
  });

  ipcMain.handle('transactions:all', async () => {
    return { transactions: getAllTransactions() };
  });

  ipcMain.handle('dashboard:data', async () => {
    return (await buildDashboard()) as DashboardData;
  });

  ipcMain.handle('settings:get', async () => {
    return loadSettings(getWorkspaceRoot()) as Promise<SettingsPayload>;
  });

  ipcMain.handle('settings:save', async (_event, payload: SettingsPayload & { apiKey?: string }) => {
    return saveSettings(getWorkspaceRoot(), payload) as Promise<SettingsPayload>;
  });

  ipcMain.handle('goals:get', async () => {
    return loadGoals(getWorkspaceRoot()) as Promise<GoalsPayload>;
  });

  ipcMain.handle('goals:upsert', async (_event, goal: Goal) => {
    return upsertGoal(getWorkspaceRoot(), goal) as Promise<GoalsPayload>;
  });

  ipcMain.handle('goals:delete', async (_event, goalId: string) => {
    return deleteGoal(getWorkspaceRoot(), goalId) as Promise<GoalsPayload>;
  });

  ipcMain.handle('categorization:suggest', async () => {
    const settings = (await loadSettings(getWorkspaceRoot())).settings;
    const apiKey = await loadApiKey();
    await ensureAiService(app.getAppPath(), app.isPackaged, process.resourcesPath);
    const suggestions = await requestCategorySuggestions({
      settings,
      transactions: getReviewTransactions(),
      apiKey,
    });
    return applyCategoryRuleOverrides(suggestions) as Promise<CategorySuggestionPayload>;
  });

  ipcMain.handle('categorization:override', async (_event, payload: CategoryOverrideRequest) => {
    return saveCategoryOverride(payload) as Promise<CategoryRulesPayload>;
  });

  ipcMain.handle('rules:get', async () => {
    return readCategoryRules() as Promise<CategoryRulesPayload>;
  });

  ipcMain.handle('categories:list', async () => {
    return readCustomCategories() as Promise<CustomCategoriesPayload>;
  });

  ipcMain.handle('categories:add', async (_event, category: { name: string; bucket: 'income' | 'expense' | 'transfer' }) => {
    const name = category.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const existing = await readCustomCategories();
    if (!name) {
      return existing;
    }
    const withoutDup = existing.categories.filter((entry) => entry.name !== name);
    const next: CustomCategoriesPayload = { categories: [...withoutDup, { name, bucket: category.bucket }] };
    await writeCustomCategories(next);
    void writeLog(`categories:add name="${name}" bucket=${category.bucket}`);
    return next;
  });

  ipcMain.handle('advisor:ask', async (_event, question: string) => {
    const settings = (await loadSettings(getWorkspaceRoot())).settings;
    const goals = (await loadGoals(getWorkspaceRoot())).goals;
    const apiKey = await loadApiKey();
    await ensureAiService(app.getAppPath(), app.isPackaged, process.resourcesPath);
    return requestAdvisorResponse({
      settings,
      dashboard: await buildDashboard(),
      goals,
      transactions: getRecentTransactions(250),
      question,
      apiKey,
    });
  });

  ipcMain.handle('advisor:savings-plan', async () => {
    const settings = (await loadSettings(getWorkspaceRoot())).settings;
    const goals = (await loadGoals(getWorkspaceRoot())).goals;
    const apiKey = await loadApiKey();
    await ensureAiService(app.getAppPath(), app.isPackaged, process.resourcesPath);
    return requestSavingsPlan({
      settings,
      dashboard: await buildDashboard(),
      goals,
      transactions: getRecentTransactions(250),
      apiKey,
    }) as Promise<SavingsPlan>;
  });

  ipcMain.handle('backup:create', async () => {
    const settings = (await loadSettings(getWorkspaceRoot())).settings;
    return createEncryptedBackup(getWorkspaceRoot(), settings) as Promise<BackupRecord>;
  });

  ipcMain.handle('backup:history', async () => {
    return loadBackupHistory(getWorkspaceRoot()) as Promise<BackupHistory>;
  });

  ipcMain.handle('export:data', async () => {
    const payload = await buildExportPayload();
    return exportWorkspaceData(getWorkspaceRoot(), payload) as Promise<ExportPayload>;
  });

  ipcMain.handle('workspace:clear', async () => {
    void writeLog('workspace:clear requested — wiping all user data');
    database.close();
    const root = getWorkspaceRoot();
    await fs.rm(root, { recursive: true, force: true });
    await ensureWorkspace();
    await initializeDatabase();
    void writeLog('workspace:clear done — workspace recreated fresh');
  });
};

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1240,
    minHeight: 820,
    backgroundColor: '#020617',
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      preload: path.join(app.getAppPath(), 'dist-electron', 'preload.cjs')
    }
  });

  mainWindow.on('closed', () => {
    void writeLog('Main window closed');
    mainWindow = null;
  });

  mainWindow.on('ready-to-show', () => {
    void writeLog('Window ready-to-show');
    mainWindow?.show();
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    void writeLog(`did-fail-load code=${errorCode} description=${errorDescription}`);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    void writeLog(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    void writeLog(`renderer console level=${level} source=${sourceId} line=${line} message=${message}`);
  });

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    void writeLog(`preload-error path=${preloadPath} error=${error?.stack ?? error?.message ?? String(error)}`);
  });

  if (isDev) {
    await writeLog('Loading development URL http://localhost:5173');
    await mainWindow.loadURL('http://localhost:5173');
    return;
  }

  if (startupError) {
    const startupHtml = `<!doctype html>
<html>
  <body style="margin:0;padding:32px;background:#020617;color:#e2e8f0;font-family:system-ui,sans-serif;">
    <h1 style="margin:0 0 16px;font-size:28px;">LedgerPilot failed to start</h1>
    <p style="margin:0 0 16px;line-height:1.6;">A startup error occurred before the desktop app could finish loading.</p>
    <pre style="white-space:pre-wrap;background:#0f172a;border:1px solid #334155;border-radius:16px;padding:16px;line-height:1.5;">${startupError}</pre>
    <p style="margin-top:16px;color:#94a3b8;">Check ~/Library/Application Support/LedgerPilot/logs/desktop.log for more details.</p>
  </body>
</html>`;
    await writeLog('Loading startup error fallback page');
    await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(startupHtml)}`);
    return;
  }

  const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
  await writeLog(`Loading production file ${indexPath}`);
  await mainWindow.loadFile(indexPath);
};

app.whenReady().then(() => {
  void (async () => {
    await writeLog('App ready');
    installApplicationMenu();
    try {
      await ensureWorkspace();
      await initializeDatabase();
      registerIpcHandlers();
      startupError = null;
    } catch (error) {
      startupError = error instanceof Error ? error.stack ?? error.message : String(error);
      await writeLog(`startup initialization failed: ${startupError}`);
    }

    try {
      await createWindow();
    } catch (error) {
      await writeLog(
        `createWindow failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
      );
      throw error;
    }
  })();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  void writeLog('All windows closed');
  shutdownAiService();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

process.on('uncaughtException', (error) => {
  void writeLog(`uncaughtException: ${error.stack ?? error.message}`);
});

process.on('unhandledRejection', (reason) => {
  void writeLog(`unhandledRejection: ${String(reason)}`);
});
