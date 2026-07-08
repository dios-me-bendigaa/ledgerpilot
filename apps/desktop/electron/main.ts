import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  type ImportBatch,
  maxImportFilesPerBatch,
  workspaceBlueprint,
  CategoryOverrideRequest,
  CategoryRulesPayload,
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

import { getDashboardData } from './analytics.js';
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
  loadBackupHistory,
  loadGoals,
  loadSettings,
  saveSettings,
  upsertGoal
} from './local-state.js';

const isDev = !app.isPackaged;
const workspaceName = 'LedgerPilot';

let database: Database.Database;

const getWorkspaceRoot = () => path.join(app.getPath('appData'), workspaceName);
const getDatabasePath = () => path.join(getWorkspaceRoot(), 'database', 'ledgerpilot.sqlite');
const getCategoryRulesPath = () => path.join(getWorkspaceRoot(), 'rules', 'category-rules.json');
const getLogPath = () => path.join(getWorkspaceRoot(), 'logs', 'desktop.log');

const writeLog = async (message: string) => {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await fs.mkdir(path.dirname(getLogPath()), { recursive: true });
  await fs.appendFile(getLogPath(), line, 'utf8');
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

const initializeDatabase = () => {
  database = new Database(getDatabasePath());
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
};

const persistTransactions = (transactions: NormalizedTransaction[]) => {
  const insert = database.prepare(`
    INSERT OR IGNORE INTO transactions (
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
    )
  `);

  const transaction = database.transaction((records: NormalizedTransaction[]) => {
    for (const record of records) {
      insert.run({
        ...record,
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

  database
    .prepare('UPDATE transactions SET category = ?, requires_review = 0 WHERE id = ?')
    .run(request.category, request.transactionId);

  return { rules: nextRules };
};

const importEngine = new ImportEngine({
  workspaceRoot: getWorkspaceRoot(),
  onBatchImported: async ({
    transactions
  }: {
    batch: ImportBatch;
    report: NormalizationReport;
    transactions: NormalizedTransaction[];
    history: ImportHistory;
  }) => {
    persistTransactions(transactions);
  }
});

const ensureWorkspace = async () => {
  const root = getWorkspaceRoot();

  await Promise.all(
    workspaceBlueprint.map((entry) => fs.mkdir(path.join(root, entry), { recursive: true })),
  );
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
    Promise.resolve(getDashboardData(database)),
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
    return importEngine.importFiles(files) as Promise<ImportWorkflowResult>;
  });

  ipcMain.handle('imports:history', async () => {
    return importEngine.getHistory() as Promise<ImportHistory>;
  });

  ipcMain.handle('imports:resume', async (_event, batchId: string) => {
    return importEngine.resumeFailedBatch(batchId) as Promise<ResumeImportResult>;
  });

  ipcMain.handle('normalization:history', async () => {
    return readNormalizationReports() as Promise<NormalizationHistory>;
  });

  ipcMain.handle('transactions:summary', async () => {
    const dashboard = getDashboardData(database);
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

  ipcMain.handle('dashboard:data', async () => {
    return getDashboardData(database) as DashboardData;
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
    await ensureAiService(app.getAppPath());
    const suggestions = await requestCategorySuggestions({
      settings,
      transactions: getReviewTransactions()
    });
    return applyCategoryRuleOverrides(suggestions) as Promise<CategorySuggestionPayload>;
  });

  ipcMain.handle('categorization:override', async (_event, payload: CategoryOverrideRequest) => {
    return saveCategoryOverride(payload) as Promise<CategoryRulesPayload>;
  });

  ipcMain.handle('rules:get', async () => {
    return readCategoryRules() as Promise<CategoryRulesPayload>;
  });

  ipcMain.handle('advisor:ask', async (_event, question: string) => {
    const settings = (await loadSettings(getWorkspaceRoot())).settings;
    const goals = (await loadGoals(getWorkspaceRoot())).goals;
    await ensureAiService(app.getAppPath());
    return requestAdvisorResponse({
      settings,
      dashboard: getDashboardData(database),
      goals,
      transactions: getRecentTransactions(250),
      question
    });
  });

  ipcMain.handle('advisor:savings-plan', async () => {
    const settings = (await loadSettings(getWorkspaceRoot())).settings;
    const goals = (await loadGoals(getWorkspaceRoot())).goals;
    await ensureAiService(app.getAppPath());
    return requestSavingsPlan({
      settings,
      dashboard: getDashboardData(database),
      goals,
      transactions: getRecentTransactions(250)
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
};

const createWindow = async () => {
  const window = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1240,
    minHeight: 820,
    backgroundColor: '#020617',
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      preload: path.join(app.getAppPath(), 'dist-electron', 'preload.js')
    }
  });

  window.on('ready-to-show', () => {
    void writeLog('Window ready-to-show');
    window.show();
  });

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    void writeLog(`did-fail-load code=${errorCode} description=${errorDescription}`);
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    void writeLog(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });

  if (isDev) {
    await writeLog('Loading development URL http://localhost:5173');
    await window.loadURL('http://localhost:5173');
    return;
  }

  const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
  await writeLog(`Loading production file ${indexPath}`);
  await window.loadFile(indexPath);
};

app.whenReady().then(() => {
  void writeLog('App ready');
  initializeDatabase();
  registerIpcHandlers();
  void ensureWorkspace().then(async () => {
    try {
      await createWindow();
    } catch (error) {
      await writeLog(
        `createWindow failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
      );
      throw error;
    }
  });

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
