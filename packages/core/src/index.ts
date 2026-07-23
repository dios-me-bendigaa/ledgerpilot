export const workspaceBlueprint = [
  'database',
  'imports/original',
  'imports/processed',
  'ai/memory',
  'ai/embeddings',
  'rules',
  'reports',
  'settings',
  'cache',
  'backups'
] as const;

export type WorkspaceEntry = (typeof workspaceBlueprint)[number];

// A single entry in the multi-workspace registry — metadata only, not the workspace's actual
// data (transactions/settings/goals/etc. live under workspaces/<id>/ using the same
// workspaceBlueprint layout as before). The registry itself lives one level up, alongside the
// workspaces/ directory, so it isn't scoped to (or duplicated inside) any single workspace.
export type WorkspaceRegistryEntry = {
  id: string;
  name: string;
  createdAt: string;
  lastOpenedAt: string;
};

export type WorkspaceRegistry = {
  workspaces: WorkspaceRegistryEntry[];
};

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

// Classifies an account by name into a debt-account type — the same regex patterns the
// normalization engine uses for its account-context classification step, shared here so the
// dashboard's "real outstanding debt" aggregation (sum of latest balances across every credit
// card / line of credit account) uses the identical definition of "this is a debt account" rather
// than an independently-drifting copy.
export type AccountDebtType = 'credit_card' | 'line_of_credit' | 'mortgage' | 'car_loan' | 'other';

export const classifyAccountDebtType = (accountName: string): AccountDebtType => {
  const normalized = accountName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/credit card|mastercard|visa|\bcc\b/.test(normalized)) return 'credit_card';
  if (/line of credit|\bloc\b|marge de credit|marge credit|ligne de credit/.test(normalized)) return 'line_of_credit';
  if (/mortgage|hypotheque/.test(normalized)) return 'mortgage';
  if (/car loan|auto loan|vehicle loan/.test(normalized)) return 'car_loan';
  return 'other';
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
  // The account's running balance immediately after this transaction posted, when the source CSV
  // provides one (many bank exports do — e.g. a trailing "Balance" column). Used to compute real
  // outstanding debt (credit card / line of credit balances actually owed) instead of just summing
  // payment flows, which only shows money movement, not what's still owed.
  balanceAfter?: number;
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
  // Rows that could not be cleanly parsed (column-count mismatch vs. header, or a non-numeric
  // amount cell) and were either recovered heuristically (kept, flagged for review) or dropped
  // outright because no usable amount could be found. Surfaced so a bad/messy source file never
  // silently loses transactions with zero user-visible signal.
  malformedRowCount: number;
  droppedRowCount: number;
  malformedRowSamples: string[];
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

// Real outstanding balance owed on a single debt account (credit card or line of credit), derived
// from the account's own latest running balance (when the source CSV provides one) rather than
// just summed payment flows — "total debt" means what you still owe, not what you paid this month.
export type DebtAccountSummary = {
  accountName: string;
  accountType: 'credit_card' | 'line_of_credit' | 'other';
  outstandingBalance: number;
  asOfDate: string;
  // Of the payments posted to this account in the current window, how much was interest vs.
  // actually reducing what's owed — a $200 LOC payment where $30 was interest_charges and $170 was
  // line_of_credit_payments is reported as interestPortion=30, principalPortion=170, not just "$200
  // paid" with no indication of how much of that was truly progress against the balance.
  interestPortion: number;
  principalPortion: number;
};

export type DebtSummary = {
  accounts: DebtAccountSummary[];
  totalOutstanding: number;
  // True only when at least one debt account's source CSV included a running balance column —
  // lets the UI say "here's your real total debt" vs. "we can't compute a real balance from this
  // data, only payment flows" instead of silently showing $0 as if there were no debt at all.
  hasBalanceData: boolean;
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
  debtSummary: DebtSummary;
};

export type AiProvider = 'local-rules' | 'ollama' | 'openai-compatible' | 'claude';

export type ProviderSettings = {
  localModel?: string;
  ollamaModel?: string;
  // Reused across openai-compatible and claude — both are "cloud model name" fields, just for a
  // different provider; kept as one field rather than two nearly-identical ones.
  cloudModel?: string;
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
  // ISO 4217 code (e.g. "CAD", "INR", "USD") used as: (a) the fallback currency for rows whose
  // source CSV gives no per-row currency signal, and (b) the display currency for aggregate KPIs.
  // Aggregates are NOT converted across currencies (no fabricated FX rate) — a transaction posted
  // in a different currency is tracked accurately as itself, and surfaced as "other currency", not
  // silently summed into the home-currency totals as if it were 1:1.
  homeCurrency: string;
  // Set once the user has completed the mandatory first-run AI provider setup (chosen and
  // successfully verified a real provider — local-rules alone does not satisfy this). Gates
  // whether the blocking setup screen shows on launch.
  aiSetupCompleted: boolean;
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
  // When true, positive-amount transactions in this category are netted against negative-amount
  // transactions in the same category when computing spend aggregates (e.g. someone reimbursing
  // part of a remittance you sent). Generalizes what was previously a single hardcoded special
  // case (india_expenses vs. Remitly) into a mechanism any category — and any user's specific
  // remittance/reimbursement pattern — can opt into.
  nettingEnabled?: boolean;
};

export type CustomCategoriesPayload = {
  categories: CustomCategory[];
};
