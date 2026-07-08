export const workspaceBlueprint = [
  'database',
  'imports/original',
  'imports/processed',
  'ai/memory',
  'ai/embeddings',
  'rules',
  'reports',
  'logs',
  'settings',
  'cache',
  'backups'
] as const;

export type WorkspaceEntry = (typeof workspaceBlueprint)[number];

export const maxImportFilesPerBatch = 10;

export type ImportStage =
  | 'queued'
  | 'validating'
  | 'deduplicating'
  | 'copying'
  | 'completed'
  | 'failed';

export type ImportStatus = 'pending' | 'completed' | 'failed';

export type ImportFailureCode =
  | 'LIMIT_EXCEEDED'
  | 'INVALID_EXTENSION'
  | 'EMPTY_FILE'
  | 'DUPLICATE_FILE'
  | 'COPY_FAILED';

export type ImportFileDescriptor = {
  name: string;
  path: string;
  size: number;
  lastModifiedMs: number;
};

export type ImportRecord = {
  id: string;
  batchId: string;
  fileName: string;
  originalPath: string;
  storedOriginalPath?: string;
  storedProcessedPath?: string;
  fileHash?: string;
  fileSize: number;
  status: ImportStatus;
  stage: ImportStage;
  progress: number;
  errorCode?: ImportFailureCode;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type ImportBatch = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ImportStatus;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  files: ImportRecord[];
};

export type ImportBatchResult = {
  batch: ImportBatch;
};

export type ResumeImportResult = {
  batch: ImportBatch;
};

export type ImportHistory = {
  batches: ImportBatch[];
};

export type SourceFormat =
  | 'generic-amount'
  | 'generic-debit-credit'
  | 'rbc'
  | 'unknown';

export type TransactionCategory =
  | 'salary'
  | 'income'
  | 'refunds'
  | 'credit_card_payments'
  | 'mortgage_payments'
  | 'line_of_credit_payments'
  | 'bank_transfers'
  | 'internal_transfers'
  | 'interac_e_transfers'
  | 'bill_payments'
  | 'utilities'
  | 'groceries'
  | 'restaurants'
  | 'fuel'
  | 'shopping'
  | 'travel'
  | 'insurance'
  | 'investments'
  | 'interest_charges'
  | 'interest_income'
  | 'fees'
  | 'taxes'
  | 'unknown';

export type TransactionKind =
  | 'income'
  | 'expense'
  | 'refund'
  | 'transfer'
  | 'internal_transfer'
  | 'payment'
  | 'unknown';

export type NormalizedTransaction = {
  id: string;
  batchId: string;
  importRecordId: string;
  sourceFormat: SourceFormat;
  accountName: string;
  postedAt: string;
  postedDate: string;
  postedTime?: string;
  amount: number;
  currency: string;
  descriptionRaw: string;
  merchantNormalized: string;
  category: TransactionCategory;
  transactionKind: TransactionKind;
  confidenceScore: number;
  fingerprint: string;
  isDuplicate: boolean;
  isInternalTransfer: boolean;
  transferPairKey?: string;
  requiresReview: boolean;
  metadataJson: string;
};

export type ReviewCandidate = {
  transactionId: string;
  description: string;
  amount: number;
  category: TransactionCategory;
  confidenceScore: number;
  accountName: string;
};

export type NormalizationSummary = {
  totalRows: number;
  insertedTransactions: number;
  duplicateTransactions: number;
  internalTransfers: number;
  lowConfidenceTransactions: number;
  sourceFormats: Record<string, number>;
  categories: Record<string, number>;
  accounts: string[];
  dateRange?: {
    start: string;
    end: string;
  };
};

export type NormalizationReport = {
  id: string;
  batchId: string;
  createdAt: string;
  summary: NormalizationSummary;
  flaggedTransactions: ReviewCandidate[];
};

export type NormalizationHistory = {
  reports: NormalizationReport[];
};

export type ImportWorkflowResult = {
  batch: ImportBatch;
  normalizationReport?: NormalizationReport;
};

export type DashboardKpi = {
  netCashFlow: number;
  income: number;
  expenses: number;
  savingsRate: number;
  interestPaid: number;
  debtPayments: number;
  budgetHealth: number;
  financialHealthScore: number;
  internalTransfers: number;
  reviewCount: number;
};

export type CategoryTotal = {
  category: string;
  total: number;
};

export type TimeSeriesPoint = {
  label: string;
  income: number;
  expenses: number;
  netCashFlow: number;
};

export type CalendarHeatmapPoint = {
  date: string;
  expenseTotal: number;
};

export type SankeyFlow = {
  source: string;
  target: string;
  value: number;
};

export type DashboardComparison = {
  currentPeriod: number;
  previousPeriod: number;
  changeAmount: number;
  changePercentage: number;
};

export type DashboardData = {
  generatedAt: string;
  kpis: DashboardKpi;
  topExpenseCategories: CategoryTotal[];
  monthlyTrend: TimeSeriesPoint[];
  yearlyTrend: TimeSeriesPoint[];
  spendingCalendar: CalendarHeatmapPoint[];
  sankeyFlows: SankeyFlow[];
  monthlyComparison: DashboardComparison;
  yearlyComparison: DashboardComparison;
};

export type AiProvider = 'local-rules' | 'ollama' | 'openai-compatible';

export type ProviderSettings = {
  localModel?: string;
  ollamaModel?: string;
  apiBaseUrl?: string;
  apiKeyConfigured: boolean;
};

export type AppSettings = {
  aiProvider: AiProvider;
  providerSettings: ProviderSettings;
  theme: 'dark' | 'system';
  notificationsEnabled: boolean;
  cloudAiEnabled: boolean;
  telemetryEnabled: boolean;
  backupDirectory?: string;
  importHistoryRetentionDays: number;
};

export type SettingsPayload = {
  settings: AppSettings;
};

export type Goal = {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline: string;
  monthlyContributionTarget: number;
  createdAt: string;
  updatedAt: string;
};

export type GoalsPayload = {
  goals: Goal[];
};

export type GoalRecommendation = {
  goalId: string;
  requiredMonthlySavings: number;
  projectedCompletionDate: string;
  successProbability: number;
};

export type AdvisorInsight = {
  title: string;
  detail: string;
  supportingData: string;
};

export type AdvisorResponse = {
  provider: AiProvider;
  answer: string;
  insights: AdvisorInsight[];
};

export type SavingsRecommendation = {
  category: string;
  title: string;
  monthlySavings: number;
  goalImpactDays: number;
  rationale: string;
};

export type SavingsPlan = {
  recommendations: SavingsRecommendation[];
  totalMonthlySavings: number;
  goalForecasts: GoalRecommendation[];
};

export type BackupRecord = {
  id: string;
  createdAt: string;
  archivePath: string;
  sizeBytes: number;
};

export type BackupHistory = {
  backups: BackupRecord[];
};

export type ExportRecord = {
  generatedAt: string;
  filePath: string;
  format: 'json';
};

export type ExportPayload = {
  record: ExportRecord;
};

export type ReviewTransaction = {
  id: string;
  accountName: string;
  postedAt: string;
  amount: number;
  descriptionRaw: string;
  merchantNormalized: string;
  currentCategory: TransactionCategory;
  confidenceScore: number;
};

export type CategorySuggestion = {
  transactionId: string;
  suggestedCategory: TransactionCategory;
  confidenceScore: number;
  rationale: string;
};

export type CategorySuggestionPayload = {
  suggestions: CategorySuggestion[];
};

export type CategoryRule = {
  id: string;
  merchantPattern: string;
  category: TransactionCategory;
  createdAt: string;
};

export type CategoryRulesPayload = {
  rules: CategoryRule[];
};

export type CategoryOverrideRequest = {
  transactionId: string;
  merchantNormalized: string;
  category: TransactionCategory;
};
