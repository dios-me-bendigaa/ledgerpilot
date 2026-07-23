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

const imports = {
  selectFiles: () => ipcRenderer.invoke('imports:select-files') as Promise<ImportFileDescriptor[]>,
  start: (files: ImportFileDescriptor[]) =>
    ipcRenderer.invoke('imports:start', files) as Promise<ImportWorkflowResult>,
  history: () => ipcRenderer.invoke('imports:history') as Promise<ImportHistory>,
  resume: (batchId: string) =>
    ipcRenderer.invoke('imports:resume', batchId) as Promise<ResumeImportResult>
};

const normalization = {
  history: () => ipcRenderer.invoke('normalization:history') as Promise<NormalizationHistory>,
  rerunBatch: (batchId: string) =>
    ipcRenderer.invoke('normalization:rerun-batch', batchId) as Promise<NormalizationReport | undefined>
};

const transactions = {
  summary: () =>
    ipcRenderer.invoke('transactions:summary') as Promise<{
      totalTransactions: number;
      income: number;
      expenses: number;
      reviewCount: number;
      internalTransfers: number;
      topCategories: Array<{ category: string; total: number }>;
    }>,
  review: () => ipcRenderer.invoke('transactions:review') as Promise<{ transactions: ReviewTransaction[] }>,
  all: () => ipcRenderer.invoke('transactions:all') as Promise<{ transactions: ReviewTransaction[] }>
};

const dashboard = {
  data: () => ipcRenderer.invoke('dashboard:data') as Promise<DashboardData>
};

const settings = {
  get: () => ipcRenderer.invoke('settings:get') as Promise<SettingsPayload>,
  save: (payload: SettingsPayload & { apiKey?: string }) =>
    ipcRenderer.invoke('settings:save', payload) as Promise<SettingsPayload>,
  testProvider: (payload: { provider: AppSettings['aiProvider']; model?: string; baseUrl?: string; apiKey?: string }) =>
    ipcRenderer.invoke('provider:test', payload) as Promise<{ success: boolean; message: string; sampleReply?: string }>
};

const goals = {
  get: () => ipcRenderer.invoke('goals:get') as Promise<GoalsPayload>,
  upsert: (goal: Goal) => ipcRenderer.invoke('goals:upsert', goal) as Promise<GoalsPayload>,
  delete: (goalId: string) => ipcRenderer.invoke('goals:delete', goalId) as Promise<GoalsPayload>
};

const categorization = {
  suggest: () => ipcRenderer.invoke('categorization:suggest') as Promise<CategorySuggestionPayload>,
  override: (payload: CategoryOverrideRequest) =>
    ipcRenderer.invoke('categorization:override', payload) as Promise<CategoryRulesPayload>,
  rules: () => ipcRenderer.invoke('rules:get') as Promise<CategoryRulesPayload>
};

const categories = {
  list: () => ipcRenderer.invoke('categories:list') as Promise<CustomCategoriesPayload>,
  add: (category: { name: string; bucket: 'income' | 'expense' | 'transfer'; nettingEnabled?: boolean }) =>
    ipcRenderer.invoke('categories:add', category) as Promise<CustomCategoriesPayload>
};

const advisor = {
  ask: (question: string) => ipcRenderer.invoke('advisor:ask', question) as Promise<AdvisorResponse>,
  savingsPlan: () => ipcRenderer.invoke('advisor:savings-plan') as Promise<SavingsPlan>
};

const backup = {
  create: () => ipcRenderer.invoke('backup:create') as Promise<BackupRecord>,
  history: () => ipcRenderer.invoke('backup:history') as Promise<BackupHistory>,
  restore: (backupId: string) => ipcRenderer.invoke('backup:restore', backupId) as Promise<void>
};

const exportData = {
  generate: () => ipcRenderer.invoke('export:data') as Promise<ExportPayload>
};

const workspace = {
  clear: () => ipcRenderer.invoke('workspace:clear') as Promise<void>,
  list: () => ipcRenderer.invoke('workspace:list') as Promise<WorkspaceRegistry>,
  create: (name: string) => ipcRenderer.invoke('workspace:create', name) as Promise<WorkspaceRegistryEntry>,
  select: (workspaceId: string) => ipcRenderer.invoke('workspace:select', workspaceId) as Promise<void>
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
  menuEvents
});
