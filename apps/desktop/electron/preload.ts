import { contextBridge, ipcRenderer } from 'electron';

import type {
  AdvisorResponse,
  AppSettings,
  BackupHistory,
  BackupRecord,
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
  ResumeImportResult,
  ReviewTransaction,
  SavingsPlan,
  SettingsPayload,
  WorkspaceRegistry,
  WorkspaceRegistryEntry
} from '@ledgerpilot/core';

const describeError = (error: unknown) =>
  error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };

// Every renderer-to-main operation is tracked here. UI handlers may catch an error to show a
// friendly toast, but the original failure is still written to desktop.log for support.
const trackedInvoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args).catch(async (error: unknown) => {
    try {
      await ipcRenderer.invoke('diagnostics:renderer-action-failed', { channel, ...describeError(error) });
    } catch {
      // Diagnostics must never mask the original operation failure.
    }
    throw error;
  }) as Promise<T>;

const imports = {
  selectFiles: () => trackedInvoke('imports:select-files') as Promise<ImportFileDescriptor[]>,
  start: (files: ImportFileDescriptor[]) =>
    trackedInvoke('imports:start', files) as Promise<ImportWorkflowResult>,
  history: () => trackedInvoke('imports:history') as Promise<ImportHistory>,
  resume: (batchId: string) =>
    trackedInvoke('imports:resume', batchId) as Promise<ResumeImportResult>
};

const normalization = {
  history: () => trackedInvoke('normalization:history') as Promise<NormalizationHistory>,
  rerunBatch: (batchId: string) =>
    trackedInvoke('normalization:rerun-batch', batchId) as Promise<NormalizationReport | undefined>
};

const transactions = {
  summary: () =>
    trackedInvoke('transactions:summary') as Promise<{
      totalTransactions: number;
      income: number;
      expenses: number;
      reviewCount: number;
      internalTransfers: number;
      topCategories: Array<{ category: string; total: number }>;
    }>,
  review: () => trackedInvoke('transactions:review') as Promise<{ transactions: ReviewTransaction[] }>,
  all: () => trackedInvoke('transactions:all') as Promise<{ transactions: ReviewTransaction[] }>
};

const dashboard = {
  data: () => trackedInvoke('dashboard:data') as Promise<DashboardData>
};

const settings = {
  getGlobal: () => trackedInvoke('settings:get-global') as Promise<SettingsPayload>,
  saveGlobal: (payload: SettingsPayload & { apiKey?: string }) =>
    trackedInvoke('settings:save-global', payload) as Promise<SettingsPayload>,
  get: () => trackedInvoke('settings:get') as Promise<SettingsPayload>,
  save: (payload: SettingsPayload & { apiKey?: string }) =>
    trackedInvoke('settings:save', payload) as Promise<SettingsPayload>,
  testProvider: (payload: { provider: AppSettings['aiProvider']; model?: string; baseUrl?: string; apiKey?: string }) =>
    trackedInvoke('provider:test', payload) as Promise<{ success: boolean; message: string; sampleReply?: string }>
};

const goals = {
  get: () => trackedInvoke('goals:get') as Promise<GoalsPayload>,
  upsert: (goal: Goal) => trackedInvoke('goals:upsert', goal) as Promise<GoalsPayload>,
  delete: (goalId: string) => trackedInvoke('goals:delete', goalId) as Promise<GoalsPayload>
};

const categorization = {
  suggest: () => trackedInvoke('categorization:suggest') as Promise<CategorySuggestionPayload>,
  override: (payload: CategoryOverrideRequest) =>
    trackedInvoke('categorization:override', payload) as Promise<CategoryRulesPayload>,
  rules: () => trackedInvoke('rules:get') as Promise<CategoryRulesPayload>
};

const categories = {
  list: () => trackedInvoke('categories:list') as Promise<CustomCategoriesPayload>,
  add: (category: { name: string; bucket: 'income' | 'expense' | 'transfer'; nettingEnabled?: boolean }) =>
    trackedInvoke('categories:add', category) as Promise<CustomCategoriesPayload>
};

const advisor = {
  ask: (question: string) => trackedInvoke('advisor:ask', question) as Promise<AdvisorResponse>,
  savingsPlan: () => trackedInvoke('advisor:savings-plan') as Promise<SavingsPlan>
};

const backup = {
  create: () => trackedInvoke('backup:create') as Promise<BackupRecord>,
  history: () => trackedInvoke('backup:history') as Promise<BackupHistory>,
  restore: (backupId: string) => trackedInvoke('backup:restore', backupId) as Promise<void>
};

const exportData = {
  generate: () => trackedInvoke('export:data') as Promise<ExportPayload>
};

const workspace = {
  clear: () => trackedInvoke('workspace:clear') as Promise<void>,
  list: () => trackedInvoke('workspace:list') as Promise<WorkspaceRegistry>,
  create: (name: string) => trackedInvoke('workspace:create', name) as Promise<WorkspaceRegistryEntry>,
  delete: (workspaceId: string) => trackedInvoke('workspace:delete', workspaceId) as Promise<WorkspaceRegistry>,
  select: (workspaceId: string) => trackedInvoke('workspace:select', workspaceId) as Promise<void>
};

const diagnostics = {
  reportError: (message: string, stack?: string) =>
    ipcRenderer.invoke('diagnostics:renderer-action-failed', { channel: 'renderer', message, stack }) as Promise<void>
};

// The only main -> renderer push channel (everything else above is renderer-initiated
// ipcRenderer.invoke). Used by the native application menu (View menu page shortcuts, File menu
// "Import CSV Files...", etc.) to drive the renderer without the main process needing to know
// anything about React state.
const menuEvents = {
  onNavigate: (callback: (view: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, view: string) => callback(view);
    ipcRenderer.on('menu:navigate', listener);
    return () => ipcRenderer.removeListener('menu:navigate', listener);
  },
  onFilesSelected: (callback: (files: ImportFileDescriptor[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, files: ImportFileDescriptor[]) => callback(files);
    ipcRenderer.on('menu:files-selected', listener);
    return () => ipcRenderer.removeListener('menu:files-selected', listener);
  },
  onRequestExport: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('menu:request-export', listener);
    return () => ipcRenderer.removeListener('menu:request-export', listener);
  },
  onRequestBackup: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('menu:request-backup', listener);
    return () => ipcRenderer.removeListener('menu:request-backup', listener);
  }
};

contextBridge.exposeInMainWorld('ledgerPilot', {
  imports,
  normalization,
  transactions,
  dashboard,
  settings,
  goals,
  categorization,
  categories,
  advisor,
  backup,
  exportData,
  workspace,
  diagnostics,
  menuEvents
});
