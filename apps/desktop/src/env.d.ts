import type {
  AdvisorResponse,
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
      };
      dashboard: {
        data: () => Promise<DashboardData>;
      };
      settings: {
        get: () => Promise<SettingsPayload>;
        save: (payload: SettingsPayload & { apiKey?: string }) => Promise<SettingsPayload>;
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
      advisor: {
        ask: (question: string) => Promise<AdvisorResponse>;
        savingsPlan: () => Promise<SavingsPlan>;
      };
      backup: {
        create: () => Promise<BackupRecord>;
        history: () => Promise<BackupHistory>;
      };
      exportData: {
        generate: () => Promise<ExportPayload>;
      };
    };
  }
}

export {};
