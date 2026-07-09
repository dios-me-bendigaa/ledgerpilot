import { contextBridge, ipcRenderer } from 'electron';

import type {
  AdvisorResponse,
  AppSettings,
  BackupHistory,
  BackupRecord,
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
  ResumeImportResult,
  ReviewTransaction,
  SavingsPlan,
  SettingsPayload
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
  review: () => ipcRenderer.invoke('transactions:review') as Promise<{ transactions: ReviewTransaction[] }>
};

const dashboard = {
  data: () => ipcRenderer.invoke('dashboard:data') as Promise<DashboardData>
};

const settings = {
  get: () => ipcRenderer.invoke('settings:get') as Promise<SettingsPayload>,
  save: (payload: SettingsPayload & { apiKey?: string }) =>
    ipcRenderer.invoke('settings:save', payload) as Promise<SettingsPayload>
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

const advisor = {
  ask: (question: string) => ipcRenderer.invoke('advisor:ask', question) as Promise<AdvisorResponse>,
  savingsPlan: () => ipcRenderer.invoke('advisor:savings-plan') as Promise<SavingsPlan>
};

const backup = {
  create: () => ipcRenderer.invoke('backup:create') as Promise<BackupRecord>,
  history: () => ipcRenderer.invoke('backup:history') as Promise<BackupHistory>
};

const exportData = {
  generate: () => ipcRenderer.invoke('export:data') as Promise<ExportPayload>
};

const workspace = {
  clear: () => ipcRenderer.invoke('workspace:clear') as Promise<void>
};

contextBridge.exposeInMainWorld('ledgerPilot', {
  imports,
  normalization,
  transactions,
  dashboard,
  settings,
  goals,
  categorization,
  advisor,
  backup,
  exportData,
  workspace
});
