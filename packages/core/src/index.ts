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
  | 'rent'
  | 'car_payments'
  | 'line_of_credit_payments'
  | 'debt'
  | 'bank_transfers'
  | 'internal_transfers'
  | 'interac_e_transfers'
  | 'bill_payments'
  | 'utilities'
  | 'home_utilities'
  | 'mobile'
  | 'internet'
  | 'groceries'
  | 'restaurants'
  | 'fuel'
  | 'shopping'
  | 'travel'
  | 'vacation'
  | 'lifestyle'
  | 'india_expenses'
  | 'insurance'
  | 'car_insurance'
  | 'home_insurance'
  | 'investments'
  | 'interest_charges'
  | 'interest_income'
  | 'fees'
  | 'taxes'
  | 'property_tax'
  | 'unknown';

// The three buckets that drive dashboard cash-flow. Single source of truth shared by the
// classifier and analytics so income/expense stay symmetric. Categories not listed here are
// treated by sign (negative -> expense, positive -> income).
export type SpendBucket = 'income' | 'expense' | 'transfer';

// Money in.
export const INCOME_CATEGORIES: TransactionCategory[] = ['salary', 'income', 'interest_income', 'refunds'];

// Movement between the user's own accounts or debt servicing — excluded from spend AND income so
// they never inflate either side. Debt/card payments are surfaced separately via the debtPayments KPI.
export const TRANSFER_CATEGORIES: TransactionCategory[] = [
  'credit_card_payments', 'line_of_credit_payments', 'debt',
  'bank_transfers', 'internal_transfers', 'interac_e_transfers', 'investments'
];

// Debt-servicing payments excluded from expenses and surfaced in their own dashboard section.
export const DEBT_CATEGORIES: TransactionCategory[] = [
  'mortgage_payments', 'car_payments', 'rent'
];

export const spendBucket = (category: TransactionCategory, amount: number): SpendBucket => {
  if (TRANSFER_CATEGORIES.includes(category)) return 'transfer';
  if (DEBT_CATEGORIES.includes(category)) return 'transfer';
  if (INCOME_CATEGORIES.includes(category)) return 'income';
  if (category === 'unknown') return amount < 0 ? 'expense' : 'income';
  return 'expense';
};

// UI-facing ordered list of built-in categories, grouped income -> expense -> transfer -> unknown.
// The review-queue dropdown is driven from this so new categories never get missed.
export const ALL_CATEGORIES: TransactionCategory[] = [
  'salary', 'income', 'interest_income', 'refunds',
  'rent', 'mortgage_payments', 'home_insurance', 'property_tax', 'home_utilities',
  'car_payments', 'car_insurance', 'fuel',
  'groceries', 'restaurants',
  'mobile', 'internet', 'bill_payments', 'utilities',
  'shopping', 'lifestyle', 'travel', 'vacation',
  'insurance', 'india_expenses', 'interest_charges', 'fees', 'taxes',
  'credit_card_payments', 'line_of_credit_payments', 'debt',
  'investments', 'bank_transfers', 'internal_transfers', 'interac_e_transfers',
  'unknown'
];

// Parent groups shown on the dashboard. Each category rolls up into exactly one group.
export type CategoryGroup =
  | 'Home' | 'Car' | 'Food' | 'Bills' | 'Lifestyle'
  | 'Income' | 'India' | 'Debt' | 'Fees & Interest' | 'Transfers' | 'Other';

export const CATEGORY_GROUP: Record<TransactionCategory, CategoryGroup> = {
  // Home
  mortgage_payments: 'Home', rent: 'Home', home_insurance: 'Home', property_tax: 'Home', home_utilities: 'Home',
  // Car
  car_payments: 'Car', car_insurance: 'Car', fuel: 'Car',
  // Food
  groceries: 'Food', restaurants: 'Food',
  // Bills
  mobile: 'Bills', internet: 'Bills', bill_payments: 'Bills', utilities: 'Bills',
  // Lifestyle
  shopping: 'Lifestyle', lifestyle: 'Lifestyle', travel: 'Lifestyle', vacation: 'Lifestyle',
  // Income
  salary: 'Income', income: 'Income', interest_income: 'Income', refunds: 'Income',
  // India
  india_expenses: 'India',
  // Debt
  line_of_credit_payments: 'Debt', debt: 'Debt',
  // Fees & interest
  fees: 'Fees & Interest', interest_charges: 'Fees & Interest',
  // Transfers (excluded from spend)
  credit_card_payments: 'Transfers', investments: 'Transfers', bank_transfers: 'Transfers',
  internal_transfers: 'Transfers', interac_e_transfers: 'Transfers',
  // Other
  insurance: 'Other', taxes: 'Other', unknown: 'Other'
};

// Group for any category value (built-in or custom). Custom names fall back by bucket.
export const groupForCategory = (category: string): CategoryGroup =>
  CATEGORY_GROUP[category as TransactionCategory] ?? 'Other';

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

export type DebtBreakdown = {
  mortgage: number;
  carPayments: number;
  rent: number;
  creditCard: number;
  lineOfCredit: number;
  total: number;
};

export type DashboardKpi = {
  netCashFlow: number;
  income: number;
  expenses: number;
  savingsRate: number;
  interestPaid: number;
  debtPayments: number;
  debtBreakdown: DebtBreakdown;
  budgetHealth: number;
  financialHealthScore: number;
  internalTransfers: number;
  reviewCount: number;
};

export type CategoryTotal = {
  category: string;
  total: number;
};

// Expense rolled up to a parent group, with its per-category breakdown for drill-down.
export type GroupTotal = {
  group: string;
  total: number;
  categories: CategoryTotal[];
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

export type CategoryMonthComparison = {
  category: string;
  currentMonth: number;
  previousMonth: number;
  changeAmount: number;
};

export type DashboardData = {
  generatedAt: string;
  kpis: DashboardKpi;
  topExpenseCategories: CategoryTotal[];
  expenseGroups: GroupTotal[];
  categoryComparisons: CategoryMonthComparison[];
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
  goalName: string;
  requiredMonthlySavings: number;
  projectedCompletionDate: string;
  successProbability: number;
  verdict: 'on_track' | 'achievable_with_cuts' | 'shortfall' | 'needs_income_boost';
  shortfallPerMonth: number;
  maxReachableByDeadline: number;
  message: string;
};

export type FinancialHealthInsight = {
  title: string;
  metric: string;
  recommendation: string;
  severity: 'good' | 'warning' | 'alert';
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
  financialSummary: FinancialHealthInsight[];
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
  currentCategory: CategoryValue;
  confidenceScore: number;
};

export type CategorySuggestion = {
  transactionId: string;
  suggestedCategory: CategoryValue;
  confidenceScore: number;
  rationale: string;
};

export type CategorySuggestionPayload = {
  suggestions: CategorySuggestion[];
};

// A category value may be a built-in TransactionCategory or a user-defined custom name. The
// `(string & {})` keeps editor autocomplete for the built-ins while still allowing any string.
export type CategoryValue = TransactionCategory | (string & {});

export type CategoryRule = {
  id: string;
  merchantPattern: string;
  category: CategoryValue;
  createdAt: string;
};

export type CategoryRulesPayload = {
  rules: CategoryRule[];
};

export type CategoryOverrideRequest = {
  transactionId: string;
  merchantNormalized: string;
  category: CategoryValue;
  // When true (default), the correction is applied to every transaction sharing this merchant,
  // not just the one row — this is the "teach once, apply to all" behavior.
  applyToAll?: boolean;
};

// User-defined categories added at runtime, each tagged with the bucket that decides whether it
// counts as income, expense, or an excluded transfer in the dashboard.
export type CustomCategory = {
  name: string;
  bucket: SpendBucket;
};

export type CustomCategoriesPayload = {
  categories: CustomCategory[];
};
