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

declare global {
  interface Window {
    ledgerPilot: {
      imports: {
        selectFiles: () => Promise<ImportFileDescriptor[]>;
        start: (files: ImportFileDescriptor[]) => Promise<ImportWorkflowResult>;
        history: () => Promise<ImportHistory>;
        resume: (batchId: string) => Promise<ResumeImportResult>;
      };
      normalization: {
        history: () => Promise<NormalizationHistory>;
        rerunBatch: (batchId: string) => Promise<NormalizationReport | undefined>;
      };
      transactions: {
        summary: () => Promise<{
          totalTransactions: number;
          income: number;
          expenses: number;
          reviewCount: number;
          internalTransfers: number;
          topCategories: Array<{ category: string; total: number }>;
        }>;
        review: () => Promise<{ transactions: ReviewTransaction[] }>;
        all: () => Promise<{ transactions: ReviewTransaction[] }>;
      };
      dashboard: {
        data: () => Promise<DashboardData>;
      };
      settings: {
        get: () => Promise<SettingsPayload>;
        save: (payload: SettingsPayload & { apiKey?: string }) => Promise<SettingsPayload>;
        testProvider: (payload: { provider: AppSettings['aiProvider']; model?: string; baseUrl?: string; apiKey?: string }) => Promise<{ success: boolean; message: string; sampleReply?: string }>;
      };
      goals: {
        get: () => Promise<GoalsPayload>;
        upsert: (goal: Goal) => Promise<GoalsPayload>;
        delete: (goalId: string) => Promise<GoalsPayload>;
      };
      categorization: {
        suggest: () => Promise<CategorySuggestionPayload>;
        override: (payload: CategoryOverrideRequest) => Promise<CategoryRulesPayload>;
        rules: () => Promise<CategoryRulesPayload>;
      };
      categories: {
        list: () => Promise<CustomCategoriesPayload>;
        add: (category: { name: string; bucket: 'income' | 'expense' | 'transfer'; nettingEnabled?: boolean }) => Promise<CustomCategoriesPayload>;
      };
      advisor: {
        ask: (question: string) => Promise<AdvisorResponse>;
        savingsPlan: () => Promise<SavingsPlan>;
      };
      backup: {
        create: () => Promise<BackupRecord>;
        history: () => Promise<BackupHistory>;
        restore: (backupId: string) => Promise<void>;
      };
      exportData: {
        generate: () => Promise<ExportPayload>;
      };
      workspace: {
        clear: () => Promise<void>;
        list: () => Promise<WorkspaceRegistry>;
        create: (name: string) => Promise<WorkspaceRegistryEntry>;
        select: (workspaceId: string) => Promise<void>;
      };
      menuEvents: {
        onNavigate: (callback: (view: string) => void) => () => void;
        onFilesSelected: (callback: (files: ImportFileDescriptor[]) => void) => () => void;
        onRequestExport: (callback: () => void) => () => void;
        onRequestBackup: (callback: () => void) => () => void;
      };
    };
  }
}

export {};
