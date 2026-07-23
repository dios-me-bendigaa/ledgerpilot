import { Menu, app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  type ImportBatch,
  maxImportFilesPerBatch,
  workspaceBlueprint,
  AppSettings,
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
  BackupRecord,
  WorkspaceRegistry,
  WorkspaceRegistryEntry
} from '@ledgerpilot/core';
import { ImportEngine } from '@ledgerpilot/import-engine';

import { getDashboardData, setCustomCategoryBuckets } from './analytics.js';
import {
  ensureAiService,
  requestAdvisorResponse,
  requestCategorySuggestions,
  requestSavingsPlan,
  shutdownAiService,
  testProviderConnection
} from './ai-service.js';
import {
  createEncryptedBackup,
  decryptBackupBundle,
  deleteGoal,
  exportWorkspaceData,
  loadApiKey,
  loadBackupHistory,
  loadGoals,
  loadSettings,
  restoreSettingsAndGoals,
  saveSettings,
  upsertGoal
} from './local-state.js';
import { createWorkspace, getWorkspacePath, loadRegistry, migrateLegacyWorkspaceIfNeeded, touchWorkspace } from './workspace-registry.js';

const isDev = !app.isPackaged;
const workspaceName = 'LedgerPilot';

// Test-only override: points the app at an isolated directory instead of the real
// ~/Library/Application Support/LedgerPilot, so multi-workspace migration and other filesystem
// logic can be tested against copied/synthetic data without ever touching real user data. Inert
// unless LEDGERPILOT_TEST_APPDATA is explicitly set in the environment — never active in normal
// use (a real launch never sets this). Must run before any getAppRoot()/getWorkspaceRoot() call.
if (process.env.LEDGERPILOT_TEST_APPDATA) {
  app.setPath('appData', process.env.LEDGERPILOT_TEST_APPDATA);
}

let database: Database.Database | undefined;
let importEngine: ImportEngine | undefined;
let mainWindow: BrowserWindow | null = null;
let startupError: string | null = null;
let isReprocessing = false;
// Set once the renderer calls workspace:select. Every workspace-scoped path/handler is gated on
// this being set — there is no "default" workspace to silently fall back to once more than one
// can exist, so callers get a clear error instead of accidentally reading/writing the wrong data.
let activeWorkspaceId: string | undefined;

// The stable container root — always resolvable, independent of whether a workspace has been
// selected yet. Holds the workspace registry (workspaces.json) and a workspaces/ directory with
// one subfolder per workspace, each using the exact same internal layout (workspaceBlueprint) a
// single workspace always used. This is also where app-level logs live (see getLogPath) — logging
// needs to work before any workspace is selected, e.g. during migration or the picker itself.
const getAppRoot = () => path.join(app.getPath('appData'), workspaceName);

const getWorkspaceRoot = () => {
  if (!activeWorkspaceId) {
    throw new Error('No workspace selected yet.');
  }
  return getWorkspacePath(getAppRoot(), activeWorkspaceId);
};

const getDatabase = (): Database.Database => {
  if (!database) {
    throw new Error('No workspace selected yet \u2014 database is not initialized.');
  }
  return database;
};

const getImportEngine = (): ImportEngine => {
  if (!importEngine) {
    throw new Error('No workspace selected yet \u2014 import engine is not initialized.');
  }
  return importEngine;
};

const getDatabasePath = () => path.join(getWorkspaceRoot(), 'database', 'ledgerpilot.sqlite');
const getCategoryRulesPath = () => path.join(getWorkspaceRoot(), 'rules', 'category-rules.json');
const getCustomCategoriesPath = () => path.join(getWorkspaceRoot(), 'rules', 'custom-categories.json');
// App-level, not per-workspace: a single continuous log file that works before any workspace is
// selected and doesn't silently restart every time the user switches workspaces. This is the same
// physical path logs always lived at (getAppRoot() === the old, pre-multi-workspace
// getWorkspaceRoot()), so existing log history is unaffected.
const getLogPath = () => path.join(getAppRoot(), 'logs', 'desktop.log');

const writeLog = async (message: string) => {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await fs.mkdir(path.dirname(getLogPath()), { recursive: true });
  await fs.appendFile(getLogPath(), line, 'utf8');
};

// Pushes an event to the renderer — the only main -> renderer direction in the app (everything
// else is renderer-initiated ipcMain.handle/ipcRenderer.invoke). Used exclusively by the native
// application menu below, so menu actions (page shortcuts, "Import CSV Files...", etc.) can drive
// the renderer without the main process knowing anything about React state.
const sendToRenderer = (channel: string, ...args: unknown[]) => {
  mainWindow?.webContents.send(channel, ...args);
};

const installApplicationMenu = () => {
  app.setAboutPanelOptions({
    applicationName: 'LedgerPilot',
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: 'Local-first AI personal finance for macOS'
  });

  const navigate = (view: string) => sendToRenderer('menu:navigate', view);

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'LedgerPilot',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences…',
          accelerator: 'CmdOrCtrl+,',
          click: () => navigate('settings')
        },
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
          label: 'Import CSV Files…',
          accelerator: 'CmdOrCtrl+I',
          click: async () => {
            navigate('import');
            const result = await dialog.showOpenDialog({
              title: 'Import CSV files',
              properties: ['openFile', 'multiSelections'],
              filters: [{ name: 'CSV files', extensions: ['csv'] }]
            });
            if (result.canceled || result.filePaths.length === 0) return;
            const files = await Promise.all(result.filePaths.slice(0, maxImportFilesPerBatch).map(toFileDescriptor));
            sendToRenderer('menu:files-selected', files);
          }
        },
        {
          label: 'Export Data…',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => {
            navigate('settings');
            sendToRenderer('menu:request-export');
          }
        },
        {
          label: 'Create Encrypted Backup',
          accelerator: 'CmdOrCtrl+B',
          click: () => {
            navigate('settings');
            sendToRenderer('menu:request-backup');
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
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find Transaction…',
          accelerator: 'CmdOrCtrl+F',
          click: () => navigate('transactions')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Overview', accelerator: 'CmdOrCtrl+1', click: () => navigate('overview') },
        { label: 'Transactions', accelerator: 'CmdOrCtrl+2', click: () => navigate('transactions') },
        { label: 'Categorize', accelerator: 'CmdOrCtrl+3', click: () => navigate('categorize') },
        { label: 'Goals', accelerator: 'CmdOrCtrl+4', click: () => navigate('goals') },
        { label: 'Advisor', accelerator: 'CmdOrCtrl+5', click: () => navigate('advisor') },
        { label: 'Import Data', accelerator: 'CmdOrCtrl+6', click: () => navigate('import') },
        { type: 'separator' },
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
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Reveal Logs in Finder',
          click: async () => {
            await writeLog('Help menu: reveal logs requested');
            shell.showItemInFolder(getLogPath());
          }
        },
        {
          label: 'Open Workspace Folder',
          click: () => {
            shell.openPath(getWorkspaceRoot());
          }
        },
        { type: 'separator' },
        {
          label: 'About LedgerPilot',
          click: () => {
            app.showAboutPanel();
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
          // Reports are read from disk as untrusted JSON, not guaranteed to match the current
          // NormalizationReport type — only the 3 fields added this session are actually optional
          // on real historical data; every other field has always been written. Casting through
          // this narrower shape (rather than a blanket Partial<>) keeps the rest of the type
          // meaningfully checked while still letting the defaults below apply to old reports.
          type LegacyNormalizationSummary = Omit<
            NormalizationReport['summary'],
            'malformedRowCount' | 'droppedRowCount' | 'malformedRowSamples'
          > &
            Partial<Pick<NormalizationReport['summary'], 'malformedRowCount' | 'droppedRowCount' | 'malformedRowSamples'>>;
          const parsed = JSON.parse(content) as Omit<NormalizationReport, 'summary'> & {
            summary: LegacyNormalizationSummary;
          };
          // Reports written before malformedRowCount/droppedRowCount/malformedRowSamples were
          // added to NormalizationSummary won't have them at all — backfill defaults here (the
          // single place everything reads reports from) rather than requiring every UI consumer
          // to defensively guard against fields that may not exist on older persisted JSON.
          return {
            ...parsed,
            summary: {
              malformedRowCount: 0,
              droppedRowCount: 0,
              malformedRowSamples: [],
              ...parsed.summary
            }
          } satisfies NormalizationReport;
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
  return getDashboardData(getDatabase());
};

// Schema migrations, tracked via SQLite's built-in `PRAGMA user_version`. Previously the schema
// was created with a single `CREATE TABLE IF NOT EXISTS` and never versioned at all — since that
// statement is a silent no-op once the table exists, any future column/index change would ship
// invisibly broken for every existing user's on-disk database (the app would think it succeeded;
// the new column would simply never exist). Each migration below is idempotent and runs inside its
// own transaction; `runMigrations` applies only the ones a given database hasn't seen yet, in
// order, and advances `user_version` one step at a time so a failure partway through a future
// migration doesn't skip recording the migrations that DID complete.
type Migration = { version: number; description: string; migrate: (db: Database.Database) => void };

const migrations: Migration[] = [
  {
    version: 1,
    description: 'baseline transactions table + core indexes',
    migrate: (db) => {
      db.exec(`
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
    }
  },
  {
    version: 2,
    description: 'index is_internal_transfer/is_duplicate (filtered on in nearly every dashboard query)',
    migrate: (db) => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_transactions_is_internal_transfer ON transactions (is_internal_transfer);
        CREATE INDEX IF NOT EXISTS idx_transactions_is_duplicate ON transactions (is_duplicate);
      `);
    }
  },
  {
    version: 3,
    description: 'add balance_after column for real outstanding-debt calculation from source CSVs that carry a running balance',
    migrate: (db) => {
      const columns = db.prepare("PRAGMA table_info(transactions)").all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === 'balance_after')) {
        db.exec('ALTER TABLE transactions ADD COLUMN balance_after REAL;');
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_account_posted ON transactions (account_name, posted_at);');
    }
  }
];

const runMigrations = (db: Database.Database, logger: (message: string) => void) => {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;
  const pending = migrations.filter((m) => m.version > currentVersion).sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    const applyMigration = db.transaction(() => {
      migration.migrate(db);
      db.pragma(`user_version = ${migration.version}`);
    });
    applyMigration();
    logger(`migration applied version=${migration.version} "${migration.description}"`);
  }

  return { from: currentVersion, to: db.pragma('user_version', { simple: true }) as number };
};

const initializeDatabase = async () => {
  // Closes any handle from a previously-selected workspace first — this runs every time
  // workspace:select is called, not just once at app startup.
  if (database) {
    database.close();
  }
  const dbPath = getDatabasePath();
  await writeLog(`initializeDatabase path=${dbPath}`);
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  database = new Database(dbPath);
  const { from, to } = runMigrations(database, (message) => void writeLog(message));
  await writeLog(`initializeDatabase ready schemaVersion ${from} -> ${to}`);
};

// `upsert=true` is used by "re-process batch" (normalization:rerun-batch). The conflict target
// MUST be `fingerprint`, not `id`: normalizeBatch() assigns a fresh random UUID as `id` on every
// run, but `fingerprint` is deterministic (derived from account/date/amount/merchant), so a
// re-run's rows collide on `fingerprint`, not `id`. Targeting `id` here previously meant SQLite's
// conflict resolution never engaged for that collision — it hit the bare UNIQUE(fingerprint)
// constraint instead and threw, crashing every re-process of a previously-imported batch. With
// fingerprint as the conflict target, the pre-existing row's original `id` (and any other columns
// not listed below) is preserved, and only the classification-derived columns are refreshed.
const persistTransactions = (transactions: NormalizedTransaction[], upsert = false) => {
  const sql = upsert
    ? `INSERT INTO transactions (
        id, batch_id, import_record_id, source_format, account_name, posted_at,
        posted_date, posted_time, amount, currency, description_raw,
        merchant_normalized, category, transaction_kind, confidence_score,
        fingerprint, is_duplicate, is_internal_transfer, transfer_pair_key,
        requires_review, metadata_json, balance_after
      ) VALUES (
        @id, @batchId, @importRecordId, @sourceFormat, @accountName, @postedAt,
        @postedDate, @postedTime, @amount, @currency, @descriptionRaw,
        @merchantNormalized, @category, @transactionKind, @confidenceScore,
        @fingerprint, @isDuplicate, @isInternalTransfer, @transferPairKey,
        @requiresReview, @metadataJson, @balanceAfter
      ) ON CONFLICT(fingerprint) DO UPDATE SET
        category = excluded.category,
        transaction_kind = excluded.transaction_kind,
        is_internal_transfer = excluded.is_internal_transfer,
        transfer_pair_key = excluded.transfer_pair_key,
        requires_review = excluded.requires_review,
        confidence_score = excluded.confidence_score,
        balance_after = excluded.balance_after`
    : `INSERT OR IGNORE INTO transactions (
        id, batch_id, import_record_id, source_format, account_name, posted_at,
        posted_date, posted_time, amount, currency, description_raw,
        merchant_normalized, category, transaction_kind, confidence_score,
        fingerprint, is_duplicate, is_internal_transfer, transfer_pair_key,
        requires_review, metadata_json, balance_after
      ) VALUES (
        @id, @batchId, @importRecordId, @sourceFormat, @accountName, @postedAt,
        @postedDate, @postedTime, @amount, @currency, @descriptionRaw,
        @merchantNormalized, @category, @transactionKind, @confidenceScore,
        @fingerprint, @isDuplicate, @isInternalTransfer, @transferPairKey,
        @requiresReview, @metadataJson, @balanceAfter
      )`;

  const stmt = getDatabase().prepare(sql);

  const transaction = getDatabase().transaction((records: NormalizedTransaction[]) => {
    for (const record of records) {
      stmt.run({
        ...record,
        postedTime: record.postedTime ?? null,
        transferPairKey: record.transferPairKey ?? null,
        isDuplicate: record.isDuplicate ? 1 : 0,
        isInternalTransfer: record.isInternalTransfer ? 1 : 0,
        requiresReview: record.requiresReview ? 1 : 0,
        balanceAfter: record.balanceAfter ?? null
      });
    }
  });

  transaction(transactions.filter((record) => !record.isDuplicate));
};

const getReviewTransactions = (): ReviewTransaction[] => {
  const rows = getDatabase()
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

// Count only (not a full row fetch) — used by transactions:summary, which previously called
// getRecentTransactions(100000).length just to read a count, fetching and JS-mapping up to
// 100,000 full rows on every dashboard load.
const getTransactionCount = (): number => {
  const row = getDatabase()
    .prepare('SELECT COUNT(*) as count FROM transactions WHERE is_internal_transfer = 0')
    .get() as { count: number };
  return row.count;
};

const getRecentTransactions = (limit = 250): ReviewTransaction[] => {
  const rows = getDatabase()
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
  const rows = getDatabase()
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

  // Always allocate the transaction the user actually clicked, so the dashboard reflects it even
  // when the merchant pattern is empty or would not match via the propagation query below.
  getDatabase()
    .prepare('UPDATE transactions SET category = ?, requires_review = 0 WHERE id = ?')
    .run(request.category, request.transactionId);

  // Teach once, apply to all: unless explicitly scoped to one row, re-categorize sibling transactions
  // that share this exact merchant (existing + future imports pick it up via applyCategoryRuleOverrides).
  // Match on equality rather than a `LIKE %pattern%` substring: an empty/short pattern would otherwise
  // match unrelated rows (empty -> every row), silently corrupting categories and dashboard totals.
  const trimmedPattern = merchantPattern.trim();
  if (request.applyToAll !== false && trimmedPattern.length > 0) {
    const result = getDatabase()
      .prepare('UPDATE transactions SET category = ?, requires_review = 0 WHERE merchant_normalized = ? AND id != ?')
      .run(request.category, merchantPattern, request.transactionId);
    void writeLog(`categorization:override merchant="${merchantPattern}" -> ${request.category} applied to ${result.changes + 1} transaction(s)`);
  } else {
    void writeLog(`categorization:override single txn=${request.transactionId} -> ${request.category}`);
  }

  return { rules: nextRules };
};

// Fingerprints already persisted in OTHER batches, so normalizeBatch's own duplicate detection can
// catch a transaction reappearing across separate import batches (previously always an empty Set).
// Must exclude the batch being (re-)normalized itself, since re-processing legitimately regenerates
// fingerprints it already wrote — those are updates-in-place via persistTransactions' upsert path,
// not cross-batch duplicates.
const getKnownFingerprints = (excludeBatchId: string): Set<string> => {
  const rows = getDatabase()
    .prepare('SELECT fingerprint FROM transactions WHERE batch_id != ?')
    .all(excludeBatchId) as Array<{ fingerprint: string }>;
  return new Set(rows.map((row) => row.fingerprint));
};

// Re-applies any saved "teach once, apply to all" rules (exact merchant match, same semantics as
// saveCategoryOverride's propagation) to freshly (re-)normalized transactions before they're
// persisted. Without this, re-processing a batch — or importing a new file containing a merchant
// the user previously corrected — would silently revert to the auto-classified category, discarding
// the user's prior correction every time normalization re-runs.
const applySavedRulesToTransactions = async (transactions: NormalizedTransaction[]): Promise<NormalizedTransaction[]> => {
  const rules = await readCategoryRules();
  if (rules.rules.length === 0) {
    return transactions;
  }

  const ruleByMerchant = new Map(rules.rules.map((rule) => [rule.merchantPattern, rule]));

  return transactions.map((transaction) => {
    const matchedRule = ruleByMerchant.get(transaction.merchantNormalized);
    if (!matchedRule) {
      return transaction;
    }

    return {
      ...transaction,
      // `category` is a free-text SQLite TEXT column with no CHECK constraint — a saved rule can
      // legitimately point at a user-defined custom category (CategoryValue), which is a
      // deliberately wider type than NormalizedTransaction['category']'s TransactionCategory
      // union. This mirrors how custom categories already flow into this column elsewhere
      // (e.g. saveCategoryOverride's raw SQL update, which isn't statically typed against it).
      category: matchedRule.category as NormalizedTransaction['category'],
      requiresReview: false,
      confidenceScore: Math.max(transaction.confidenceScore, 0.99)
    };
  });
};

// Constructs a fresh ImportEngine bound to whatever workspace is currently active. Must be called
// AFTER activeWorkspaceId is set (so getWorkspaceRoot() resolves), and again every time the user
// switches workspaces — ImportEngine takes its workspaceRoot once in its constructor, so switching
// workspaces means building a new instance rather than mutating the existing one.
const createImportEngine = () =>
  new ImportEngine({
    workspaceRoot: getWorkspaceRoot(),
    logger: (message) => void writeLog(`[import] ${message}`),
    getKnownFingerprints: (excludeBatchId) => getKnownFingerprints(excludeBatchId),
    getHomeCurrency: async () => (await loadSettings(getWorkspaceRoot())).settings.homeCurrency || 'CAD',
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
      const correctedTransactions = await applySavedRulesToTransactions(transactions);
      persistTransactions(correctedTransactions, isReprocessing);
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
  // Workspace selection — the only handlers that work before a workspace has been chosen. Every
  // other handler below depends on activeWorkspaceId being set (via getWorkspaceRoot/getDatabase/
  // getImportEngine's guards), which only happens once workspace:select resolves.
  ipcMain.handle('workspace:list', async () => {
    return loadRegistry(getAppRoot()) as Promise<WorkspaceRegistry>;
  });

  ipcMain.handle('workspace:create', async (_event, name: string) => {
    return createWorkspace(getAppRoot(), name) as Promise<WorkspaceRegistryEntry>;
  });

  ipcMain.handle('workspace:select', async (_event, workspaceId: string) => {
    void writeLog(`workspace:select id=${workspaceId}`);
    activeWorkspaceId = workspaceId;
    await ensureWorkspace();
    await initializeDatabase();
    importEngine = createImportEngine();
    await touchWorkspace(getAppRoot(), workspaceId);
    void writeLog(`workspace:select ready root=${getWorkspaceRoot()}`);
  });

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
      const result = await getImportEngine().importFiles(files);
      void writeLog(`imports:start complete batchId=${result.batch.id} status=${result.batch.status}`);
      return result as ImportWorkflowResult;
    } catch (error) {
      void writeLog(`imports:start error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      throw error;
    }
  });

  ipcMain.handle('imports:history', async () => {
    return getImportEngine().getHistory() as Promise<ImportHistory>;
  });

  ipcMain.handle('imports:resume', async (_event, batchId: string) => {
    return getImportEngine().resumeFailedBatch(batchId) as Promise<ResumeImportResult>;
  });

  ipcMain.handle('normalization:rerun-batch', async (_event, batchId: string) => {
    void writeLog(`normalization:rerun-batch batchId=${batchId}`);
    isReprocessing = true;
    try {
      return await getImportEngine().renormalizeBatch(batchId) as NormalizationReport | undefined;
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
      totalTransactions: getTransactionCount(),
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

  ipcMain.handle(
    'provider:test',
    async (
      _event,
      payload: { provider: AppSettings['aiProvider']; model?: string; baseUrl?: string; apiKey?: string },
    ) => {
      if (payload.provider === 'local-rules') {
        return { success: true, message: 'Local rules run entirely on-device — nothing to connect to.' };
      }
      try {
        await ensureAiService(app.getAppPath(), app.isPackaged, process.resourcesPath);
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : 'Local AI sidecar failed to start.'
        };
      }
      // Prefer the key the user just typed (not yet saved); fall back to whatever's already in
      // Keychain so re-testing an already-configured provider doesn't require re-entering the key.
      const apiKey = payload.apiKey || (await loadApiKey());
      return testProviderConnection({ ...payload, apiKey });
    },
  );

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

  ipcMain.handle(
    'categories:add',
    async (_event, category: { name: string; bucket: 'income' | 'expense' | 'transfer'; nettingEnabled?: boolean }) => {
      const name = category.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const existing = await readCustomCategories();
      if (!name) {
        return existing;
      }
      const withoutDup = existing.categories.filter((entry) => entry.name !== name);
      const next: CustomCategoriesPayload = {
        categories: [...withoutDup, { name, bucket: category.bucket, nettingEnabled: category.nettingEnabled }]
      };
      await writeCustomCategories(next);
      void writeLog(`categories:add name="${name}" bucket=${category.bucket} nettingEnabled=${Boolean(category.nettingEnabled)}`);
      return next;
    },
  );

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
    const [categoryRules, customCategories, normalizationReports] = await Promise.all([
      readCategoryRules(),
      readCustomCategories(),
      readNormalizationReports()
    ]);
    return createEncryptedBackup(getWorkspaceRoot(), settings, {
      categoryRules,
      customCategories,
      normalizationReports
    }) as Promise<BackupRecord>;
  });

  ipcMain.handle('backup:history', async () => {
    return loadBackupHistory(getWorkspaceRoot()) as Promise<BackupHistory>;
  });

  ipcMain.handle('backup:restore', async (_event, backupId: string) => {
    void writeLog(`backup:restore requested backupId=${backupId}`);
    const history = await loadBackupHistory(getWorkspaceRoot());
    const record = history.backups.find((entry) => entry.id === backupId);
    if (!record) {
      throw new Error('Backup not found.');
    }

    // Decrypt BEFORE touching any live state, so a corrupt/wrong-machine backup fails loudly with
    // nothing modified yet, rather than leaving the workspace half-restored.
    const bundle = await decryptBackupBundle(record.archivePath);

    // Safety net: snapshot the CURRENT state as a fresh backup before overwriting anything, so a
    // restore of the wrong backup (or a change of mind) can itself be undone via the same restore
    // flow rather than being permanently destructive.
    const currentSettings = (await loadSettings(getWorkspaceRoot())).settings;
    const [currentCategoryRules, currentCustomCategories, currentNormalizationReports] = await Promise.all([
      readCategoryRules(),
      readCustomCategories(),
      readNormalizationReports()
    ]);
    await createEncryptedBackup(getWorkspaceRoot(), currentSettings, {
      categoryRules: currentCategoryRules,
      customCategories: currentCustomCategories,
      normalizationReports: currentNormalizationReports
    });
    void writeLog('backup:restore pre-restore safety snapshot created');

    // Swap in the restored database. The live better-sqlite3 handle must be closed before its
    // backing file is overwritten, then reopened (running any migrations added since the backup
    // was taken, so an older backup doesn't resurrect a stale schema).
    getDatabase().close();
    await fs.writeFile(getDatabasePath(), Buffer.from(bundle.files.database, 'base64'));
    await initializeDatabase();

    await restoreSettingsAndGoals(getWorkspaceRoot(), bundle);

    if (bundle.files.categoryRules) {
      await writeCategoryRules(bundle.files.categoryRules as CategoryRulesPayload);
    }
    if (bundle.files.customCategories) {
      await writeCustomCategories(bundle.files.customCategories as CustomCategoriesPayload);
    }
    const restoredReports = (bundle.files.normalizationReports as NormalizationHistory | undefined)?.reports ?? [];
    if (restoredReports.length > 0) {
      const reportsDir = path.join(getWorkspaceRoot(), 'reports');
      await fs.mkdir(reportsDir, { recursive: true });
      await Promise.all(
        restoredReports.map((report) =>
          fs.writeFile(path.join(reportsDir, `${report.batchId}.json`), JSON.stringify(report, null, 2), 'utf8'),
        ),
      );
    }

    void writeLog(`backup:restore complete backupId=${backupId} createdAt=${bundle.createdAt}`);
  });

  ipcMain.handle('export:data', async () => {
    const payload = await buildExportPayload();
    return exportWorkspaceData(getWorkspaceRoot(), payload) as Promise<ExportPayload>;
  });

  ipcMain.handle('workspace:clear', async () => {
    void writeLog('workspace:clear requested — wiping all user data');
    getDatabase().close();
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
      // No workspace is selected yet at this point — ensureWorkspace()/initializeDatabase() now
      // happen inside the workspace:select handler once the renderer's picker screen resolves,
      // not unconditionally here. Migration only needs the app-level root, which is always
      // resolvable, so it can safely run before any workspace exists or is chosen.
      await migrateLegacyWorkspaceIfNeeded(getAppRoot(), (message) => void writeLog(message));
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
