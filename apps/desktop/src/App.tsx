import {
  maxImportFilesPerBatch,
  type AdvisorResponse,
  type AppSettings,
  type BackupHistory,
  type CategorySuggestionPayload,
  type DashboardData,
  type ExportPayload,
  type Goal,
  type GoalsPayload,
  type ImportBatch,
  type ImportFileDescriptor,
  type ImportHistory,
  type NormalizationHistory,
  type ReviewTransaction,
  type SavingsPlan,
  workspaceBlueprint
} from '@ledgerpilot/core';
import { Button, Card, Meter } from '@ledgerpilot/ui';
import { useEffect, useState } from 'react';

const metrics = [
  { label: 'Workspace folders', value: workspaceBlueprint.length.toString() },
  { label: 'CSV imports supported', value: '10 / batch' },
  { label: 'Processing mode', value: 'Local first' },
  { label: 'AI providers', value: 'Ollama + OpenAI API' }
];

const emptyDashboardData: DashboardData = {
  generatedAt: '',
  kpis: {
    netCashFlow: 0,
    income: 0,
    expenses: 0,
    savingsRate: 0,
    interestPaid: 0,
    debtPayments: 0,
    budgetHealth: 0,
    financialHealthScore: 0,
    internalTransfers: 0,
    reviewCount: 0
  },
  topExpenseCategories: [],
  monthlyTrend: [],
  yearlyTrend: [],
  spendingCalendar: [],
  sankeyFlows: [],
  monthlyComparison: {
    currentPeriod: 0,
    previousPeriod: 0,
    changeAmount: 0,
    changePercentage: 0
  },
  yearlyComparison: {
    currentPeriod: 0,
    previousPeriod: 0,
    changeAmount: 0,
    changePercentage: 0
  }
};

const emptySettings: AppSettings = {
  aiProvider: 'local-rules',
  providerSettings: {
    localModel: 'rule-engine',
    ollamaModel: 'llama3.1',
    apiBaseUrl: 'http://127.0.0.1:11434',
    apiKeyConfigured: false
  },
  theme: 'dark',
  notificationsEnabled: true,
  cloudAiEnabled: false,
  telemetryEnabled: false,
  importHistoryRetentionDays: 365
};

const emptySavingsPlan: SavingsPlan = {
  recommendations: [],
  totalMonthlySavings: 0,
  goalForecasts: []
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0
  }).format(value);

const summarizeBatch = (batch: ImportBatch) => `${batch.completedFiles}/${batch.totalFiles} completed`;
const maxCategoryTotal = (totals: DashboardData['topExpenseCategories']) =>
  totals.reduce((current, entry) => Math.max(current, entry.total), 0);

type DroppedFile = File & { path?: string };
type TransactionSummary = {
  totalTransactions: number;
  income: number;
  expenses: number;
  reviewCount: number;
  internalTransfers: number;
  topCategories: Array<{ category: string; total: number }>;
};

type SparklineProps = {
  values: number[];
  strokeClassName: string;
};

const Sparkline = ({ values, strokeClassName }: SparklineProps) => {
  if (values.length === 0) {
    return <div className="h-20 rounded-2xl bg-slate-950/70" />;
  }

  const width = 320;
  const height = 96;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg className="h-24 w-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline
        className={strokeClassName}
        fill="none"
        points={points}
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

const nextGoalDraft = (): Goal => ({
  id: crypto.randomUUID(),
  name: 'New Goal',
  targetAmount: 5000,
  currentAmount: 0,
  deadline: new Date(new Date().getFullYear(), new Date().getMonth() + 6, 1)
    .toISOString()
    .slice(0, 10),
  monthlyContributionTarget: 400,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

export const App = () => {
  const [selectedFiles, setSelectedFiles] = useState<ImportFileDescriptor[]>([]);
  const [history, setHistory] = useState<ImportHistory>({ batches: [] });
  const [normalizationHistory, setNormalizationHistory] = useState<NormalizationHistory>({ reports: [] });
  const [dashboardData, setDashboardData] = useState<DashboardData>(emptyDashboardData);
  const [transactionSummary, setTransactionSummary] = useState<TransactionSummary>({
    totalTransactions: 0,
    income: 0,
    expenses: 0,
    reviewCount: 0,
    internalTransfers: 0,
    topCategories: []
  });
  const [reviewTransactions, setReviewTransactions] = useState<ReviewTransaction[]>([]);
  const [categorySuggestions, setCategorySuggestions] = useState<CategorySuggestionPayload>({ suggestions: [] });
  const [goals, setGoals] = useState<GoalsPayload>({ goals: [] });
  const [settings, setSettings] = useState<AppSettings>(emptySettings);
  const [backups, setBackups] = useState<BackupHistory>({ backups: [] });
  const [exportRecord, setExportRecord] = useState<ExportPayload['record']>();
  const [advisorQuestion, setAdvisorQuestion] = useState('Where am I overspending?');
  const [advisorResponse, setAdvisorResponse] = useState<AdvisorResponse>();
  const [savingsPlan, setSavingsPlan] = useState<SavingsPlan>(emptySavingsPlan);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [fatalError, setFatalError] = useState<string>();

  const loadWorkspaceState = async () => {
    try {
      const [
        nextHistory,
        nextNormalizationHistory,
        nextTransactionSummary,
        nextDashboardData,
        nextReviewTransactions,
        nextGoals,
        nextSettings,
        nextBackups
      ] = await Promise.all([
        window.ledgerPilot.imports.history(),
        window.ledgerPilot.normalization.history(),
        window.ledgerPilot.transactions.summary(),
        window.ledgerPilot.dashboard.data(),
        window.ledgerPilot.transactions.review(),
        window.ledgerPilot.goals.get(),
        window.ledgerPilot.settings.get(),
        window.ledgerPilot.backup.history()
      ]);

      setHistory(nextHistory);
      setNormalizationHistory(nextNormalizationHistory);
      setTransactionSummary(nextTransactionSummary);
      setDashboardData(nextDashboardData);
      setReviewTransactions(nextReviewTransactions.transactions);
      setGoals(nextGoals);
      setSettings(nextSettings.settings);
      setBackups(nextBackups);
      setFatalError(undefined);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.stack ?? nextError.message : String(nextError);
      console.error('LedgerPilot loadWorkspaceState failed', nextError);
      setFatalError(message);
    }
  };

  useEffect(() => {
    void loadWorkspaceState();
  }, []);

  const mergeFiles = (incomingFiles: ImportFileDescriptor[]) => {
    const map = new Map<string, ImportFileDescriptor>();

    [...selectedFiles, ...incomingFiles].forEach((file) => {
      map.set(file.path, file);
    });

    return Array.from(map.values()).slice(0, maxImportFilesPerBatch);
  };

  const setFilesWithLimitCheck = (incomingFiles: ImportFileDescriptor[]) => {
    if (incomingFiles.length === 0) {
      return;
    }

    if (incomingFiles.length > maxImportFilesPerBatch) {
      setError(`You can import up to ${maxImportFilesPerBatch} CSV files at once.`);
    } else {
      setError(undefined);
    }

    setSelectedFiles(mergeFiles(incomingFiles));
  };

  const handleSelectFiles = async () => {
    const files = await window.ledgerPilot.imports.selectFiles();
    setFilesWithLimitCheck(files);
  };

  const handleImport = async () => {
    if (selectedFiles.length === 0) {
      setError('Choose at least one CSV file before importing.');
      return;
    }

    setIsImporting(true);
    setError(undefined);

    try {
      await window.ledgerPilot.imports.start(selectedFiles);
      setSelectedFiles([]);
      await loadWorkspaceState();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Import failed.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleResume = async (batchId: string) => {
    setIsImporting(true);
    setError(undefined);

    try {
      await window.ledgerPilot.imports.resume(batchId);
      await loadWorkspaceState();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Resume failed.');
    } finally {
      setIsImporting(false);
    }
  };

  const onDropFiles = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);

    const dropped = Array.from(event.dataTransfer.files)
      .map((file) => file as DroppedFile)
      .filter((file) => file.path?.toLowerCase().endsWith('.csv'))
      .map<ImportFileDescriptor>((file) => ({
        name: file.name,
        path: file.path ?? '',
        size: file.size,
        lastModifiedMs: file.lastModified
      }));

    setFilesWithLimitCheck(dropped);
  };

  const handleSuggestCategories = async () => {
    setIsWorking(true);
    setError(undefined);
    try {
      setCategorySuggestions(await window.ledgerPilot.categorization.suggest());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to suggest categories.');
    } finally {
      setIsWorking(false);
    }
  };

  const handleApplySuggestion = async (transactionId: string, suggestedCategory: ReviewTransaction['currentCategory']) => {
    const reviewTransaction = reviewTransactions.find((transaction) => transaction.id === transactionId);
    if (!reviewTransaction) {
      return;
    }

    setIsWorking(true);
    setError(undefined);
    try {
      await window.ledgerPilot.categorization.override({
        transactionId,
        merchantNormalized: reviewTransaction.merchantNormalized,
        category: suggestedCategory
      });
      await loadWorkspaceState();
      setCategorySuggestions({
        suggestions: categorySuggestions.suggestions.filter((suggestion) => suggestion.transactionId !== transactionId)
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to apply category override.');
    } finally {
      setIsWorking(false);
    }
  };

  const handleAskAdvisor = async () => {
    if (!advisorQuestion.trim()) {
      return;
    }

    setIsWorking(true);
    setError(undefined);
    try {
      setAdvisorResponse(await window.ledgerPilot.advisor.ask(advisorQuestion));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Advisor request failed.');
    } finally {
      setIsWorking(false);
    }
  };

  const handleGenerateSavingsPlan = async () => {
    setIsWorking(true);
    setError(undefined);
    try {
      setSavingsPlan(await window.ledgerPilot.advisor.savingsPlan());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Savings plan failed.');
    } finally {
      setIsWorking(false);
    }
  };

  const handleSaveSettings = async () => {
    setIsWorking(true);
    setError(undefined);
    try {
      const response = await window.ledgerPilot.settings.save({
        settings,
        apiKey: apiKeyInput.trim() || undefined
      });
      setSettings(response.settings);
      setApiKeyInput('');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Saving settings failed.');
    } finally {
      setIsWorking(false);
    }
  };

  const handleGoalChange = async (goal: Goal) => {
    setGoals(await window.ledgerPilot.goals.upsert({ ...goal, updatedAt: new Date().toISOString() }));
  };

  const handleAddGoal = async () => {
    setGoals(await window.ledgerPilot.goals.upsert(nextGoalDraft()));
  };

  const handleDeleteGoal = async (goalId: string) => {
    setGoals(await window.ledgerPilot.goals.delete(goalId));
  };

  const handleCreateBackup = async () => {
    setIsWorking(true);
    setError(undefined);
    try {
      await window.ledgerPilot.backup.create();
      setBackups(await window.ledgerPilot.backup.history());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Backup creation failed.');
    } finally {
      setIsWorking(false);
    }
  };

  const handleExport = async () => {
    setIsWorking(true);
    setError(undefined);
    try {
      setExportRecord((await window.ledgerPilot.exportData.generate()).record);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Export failed.');
    } finally {
      setIsWorking(false);
    }
  };

  const monthlyNetValues = dashboardData.monthlyTrend.map((point) => point.netCashFlow);
  const yearlyNetValues = dashboardData.yearlyTrend.map((point) => point.netCashFlow);
  const highestCategoryTotal = maxCategoryTotal(dashboardData.topExpenseCategories) || 1;
  const highestHeatmapTotal =
    dashboardData.spendingCalendar.reduce((current, point) => Math.max(current, point.expenseTotal), 0) || 1;

  if (fatalError) {
    return (
      <main className="min-h-screen bg-slate-950 px-8 py-10 text-slate-100">
        <div className="mx-auto max-w-5xl">
          <Card className="border-rose-400/20 bg-rose-400/10 p-8">
            <p className="text-sm uppercase tracking-[0.32em] text-rose-200">LedgerPilot startup error</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight">The app failed while loading local data</h1>
            <p className="mt-4 text-sm leading-7 text-rose-100">
              Copy the details below. This is now the exact renderer startup error instead of a blank screen.
            </p>
            <pre className="mt-6 overflow-auto rounded-3xl bg-slate-950/80 p-5 text-xs leading-6 text-slate-200">
              {fatalError}
            </pre>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-8 py-10 text-slate-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <section className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
          <Card className="border-sky-500/20 bg-slate-900/80 p-8">
            <p className="text-sm uppercase tracking-[0.32em] text-sky-300">LedgerPilot</p>
            <div className="mt-4 flex flex-wrap items-start justify-between gap-6">
              <div>
                <h1 className="text-5xl font-semibold tracking-tight">Local AI finance copilot</h1>
                <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-300">
                  Import, normalize, review, optimize, and back up your finances entirely on-device.
                </p>
                <p className="mt-4 text-sm text-slate-400">
                  Dashboard refreshed {dashboardData.generatedAt || 'after first normalization run'}
                </p>
              </div>
              <div className="grid min-w-[240px] gap-3">
                <Card className="bg-slate-950/80 p-4">
                  <p className="text-sm text-slate-400">Net cash flow</p>
                  <p className="mt-2 text-3xl font-semibold text-emerald-300">
                    {formatCurrency(dashboardData.kpis.netCashFlow)}
                  </p>
                </Card>
                <Card className="bg-slate-950/80 p-4">
                  <p className="text-sm text-slate-400">Savings rate</p>
                  <p className="mt-2 text-3xl font-semibold">{dashboardData.kpis.savingsRate.toFixed(1)}%</p>
                </Card>
              </div>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric) => (
                <Card key={metric.label} className="bg-slate-950/80 p-4">
                  <p className="text-sm text-slate-400">{metric.label}</p>
                  <p className="mt-2 text-2xl font-semibold">{metric.value}</p>
                </Card>
              ))}
            </div>
          </Card>

          <Card className="bg-slate-900/60 p-8">
            <p className="text-sm uppercase tracking-[0.3em] text-emerald-300">Health scorecard</p>
            <div className="mt-6 space-y-5">
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Budget health</span>
                  <span>{dashboardData.kpis.budgetHealth.toFixed(0)}/100</span>
                </div>
                <Meter className="mt-2" value={dashboardData.kpis.budgetHealth} />
              </div>
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Financial health score</span>
                  <span>{dashboardData.kpis.financialHealthScore.toFixed(0)}/100</span>
                </div>
                <Meter className="mt-2" value={dashboardData.kpis.financialHealthScore} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Card className="bg-slate-950/80 p-4">
                  <p className="text-sm text-slate-400">Interest paid</p>
                  <p className="mt-2 text-2xl font-semibold text-rose-300">
                    {formatCurrency(dashboardData.kpis.interestPaid)}
                  </p>
                </Card>
                <Card className="bg-slate-950/80 p-4">
                  <p className="text-sm text-slate-400">Debt payments</p>
                  <p className="mt-2 text-2xl font-semibold">
                    {formatCurrency(dashboardData.kpis.debtPayments)}
                  </p>
                </Card>
              </div>
              <Card className="bg-slate-950/80 p-4">
                <p className="text-sm text-slate-400">Review queue</p>
                <p className="mt-2 text-2xl font-semibold">{dashboardData.kpis.reviewCount}</p>
                <p className="mt-1 text-sm text-slate-500">
                  Ambiguous transactions waiting for AI suggestions or manual confirmation.
                </p>
              </Card>
            </div>
          </Card>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {[
            { label: 'Income', value: formatCurrency(dashboardData.kpis.income), tone: 'text-emerald-300' },
            { label: 'Expenses', value: formatCurrency(dashboardData.kpis.expenses), tone: 'text-rose-300' },
            { label: 'Internal transfers', value: dashboardData.kpis.internalTransfers.toString(), tone: 'text-slate-100' },
            { label: 'Monthly comparison', value: `${dashboardData.monthlyComparison.changePercentage.toFixed(1)}%`, tone: dashboardData.monthlyComparison.changeAmount >= 0 ? 'text-emerald-300' : 'text-rose-300' },
            { label: 'Yearly comparison', value: `${dashboardData.yearlyComparison.changePercentage.toFixed(1)}%`, tone: dashboardData.yearlyComparison.changeAmount >= 0 ? 'text-emerald-300' : 'text-rose-300' }
          ].map((item) => (
            <Card key={item.label} className="bg-slate-900/60 p-5">
              <p className="text-sm text-slate-400">{item.label}</p>
              <p className={`mt-3 text-2xl font-semibold ${item.tone}`}>{item.value}</p>
            </Card>
          ))}
        </section>

        <section className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <Card className="bg-slate-900/60 p-8">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-violet-300">Cash flow trend</p>
                <h2 className="mt-3 text-2xl font-semibold">Monthly and yearly reporting</h2>
              </div>
              <div className="text-right text-sm text-slate-400">
                <p>Current: {formatCurrency(dashboardData.monthlyComparison.currentPeriod)}</p>
                <p>Previous: {formatCurrency(dashboardData.monthlyComparison.previousPeriod)}</p>
              </div>
            </div>
            <div className="mt-6 rounded-3xl bg-slate-950/80 p-5">
              <Sparkline strokeClassName="text-sky-300" values={monthlyNetValues} />
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {dashboardData.monthlyTrend.slice(-3).map((point) => (
                  <div key={point.label} className="rounded-2xl bg-slate-900/80 px-4 py-3 text-sm">
                    <p className="text-slate-500">{point.label}</p>
                    <p className="mt-1 font-medium text-slate-100">{formatCurrency(point.netCashFlow)}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {formatCurrency(point.income)} in / {formatCurrency(point.expenses)} out
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 grid gap-4 xl:grid-cols-2">
              <Card className="bg-slate-950/80 p-5">
                <p className="text-sm text-slate-400">Yearly comparison</p>
                <Sparkline strokeClassName="text-emerald-300" values={yearlyNetValues} />
              </Card>
              <Card className="bg-slate-950/80 p-5">
                <p className="text-sm text-slate-400">Largest spending categories</p>
                <ul className="mt-4 space-y-3">
                  {dashboardData.topExpenseCategories.length === 0 ? (
                    <li className="text-sm text-slate-500">No category data yet.</li>
                  ) : (
                    dashboardData.topExpenseCategories.map((category) => (
                      <li key={category.category}>
                        <div className="flex items-center justify-between text-sm">
                          <span>{category.category.replaceAll('_', ' ')}</span>
                          <span>{formatCurrency(category.total)}</span>
                        </div>
                        <Meter className="mt-2" value={(category.total / highestCategoryTotal) * 100} />
                      </li>
                    ))
                  )}
                </ul>
              </Card>
            </div>
          </Card>

          <Card className="bg-slate-900/60 p-8">
            <p className="text-sm uppercase tracking-[0.3em] text-amber-300">Spending calendar</p>
            <div className="mt-6 grid grid-cols-6 gap-2">
              {dashboardData.spendingCalendar.length === 0 ? (
                <p className="col-span-6 text-sm text-slate-500">
                  Calendar heat map appears after the first normalized expenses land in SQLite.
                </p>
              ) : (
                dashboardData.spendingCalendar.map((point) => (
                  <div
                    key={point.date}
                    className="rounded-2xl p-3 text-xs"
                    style={{
                      backgroundColor: `rgba(56, 189, 248, ${Math.max(0.15, point.expenseTotal / highestHeatmapTotal)})`
                    }}
                    title={`${point.date}: ${formatCurrency(point.expenseTotal)}`}
                  >
                    <p className="font-medium text-slate-950">{point.date.slice(8)}</p>
                    <p className="mt-1 text-[11px] text-slate-950/80">{formatCurrency(point.expenseTotal)}</p>
                  </div>
                ))
              )}
            </div>

            <div className="mt-8">
              <p className="text-sm uppercase tracking-[0.3em] text-emerald-300">Sankey source flows</p>
              <ul className="mt-4 space-y-3">
                {dashboardData.sankeyFlows.length === 0 ? (
                  <li className="text-sm text-slate-500">No flow data yet.</li>
                ) : (
                  dashboardData.sankeyFlows.map((flow) => (
                    <li key={`${flow.source}-${flow.target}`} className="rounded-2xl bg-slate-950/80 px-4 py-3 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-400">{flow.source}</span>
                        <span className="text-slate-500">{'->'}</span>
                        <span className="font-medium text-slate-100">{flow.target.replaceAll('_', ' ')}</span>
                        <span className="text-sky-300">{formatCurrency(flow.value)}</span>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </Card>
        </section>

        <section className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="border-sky-500/20 bg-slate-900/80 p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.32em] text-sky-300">Import engine</p>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight">Local CSV ingestion</h2>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                  Drag and drop up to {maxImportFilesPerBatch} files, or use the file picker.
                  Files are copied into the local workspace, normalized, and stored in SQLite.
                </p>
              </div>
              <div className="flex gap-3">
                <Button className="bg-slate-800 text-slate-100 hover:bg-slate-700" onClick={handleSelectFiles}>
                  Choose CSV files
                </Button>
                <Button disabled={isImporting || selectedFiles.length === 0} onClick={handleImport}>
                  {isImporting ? 'Importing...' : 'Start import'}
                </Button>
              </div>
            </div>

            <div
              className={[
                'mt-8 rounded-3xl border border-dashed px-6 py-10 transition',
                isDragging ? 'border-sky-300 bg-sky-400/10' : 'border-slate-700 bg-slate-950/50'
              ].join(' ')}
              onDragEnter={() => setIsDragging(true)}
              onDragLeave={() => setIsDragging(false)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => void onDropFiles(event)}
            >
              <p className="text-lg font-medium">Drop CSV files here</p>
              <p className="mt-2 text-sm text-slate-400">
                Batch limit: {maxImportFilesPerBatch} files. Original CSVs stay untouched.
              </p>

              {selectedFiles.length > 0 ? (
                <ul className="mt-6 grid gap-3">
                  {selectedFiles.map((file) => (
                    <li
                      key={file.path}
                      className="flex items-center justify-between rounded-2xl bg-slate-900/80 px-4 py-3 text-sm"
                    >
                      <div>
                        <p className="font-medium text-slate-100">{file.name}</p>
                        <p className="text-slate-400">{file.path}</p>
                      </div>
                      <span className="text-slate-300">{formatBytes(file.size)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-6 text-sm text-slate-500">No files selected yet.</p>
              )}

              {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
            </div>
          </Card>

          <Card className="bg-slate-900/60 p-8">
            <p className="text-sm uppercase tracking-[0.3em] text-emerald-300">Import history</p>
            <div className="mt-6 space-y-4">
              {history.batches.length === 0 ? (
                <p className="text-sm text-slate-400">No imports yet.</p>
              ) : (
                history.batches.map((batch) => {
                  const hasRetryableFailures = batch.files.some(
                    (file) => file.status === 'failed' && file.errorCode !== 'DUPLICATE_FILE',
                  );

                  return (
                    <div key={batch.id} className="rounded-2xl bg-slate-950/80 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-slate-100">{summarizeBatch(batch)}</p>
                          <p className="mt-1 text-xs text-slate-500">{batch.createdAt}</p>
                        </div>
                        {hasRetryableFailures ? (
                          <Button
                            className="bg-slate-800 text-slate-100 hover:bg-slate-700"
                            disabled={isImporting}
                            onClick={() => void handleResume(batch.id)}
                          >
                            Resume failed
                          </Button>
                        ) : null}
                      </div>

                      <ul className="mt-4 space-y-2">
                        {batch.files.map((file) => (
                          <li key={file.id} className="rounded-2xl border border-white/5 bg-slate-900/70 px-3 py-3">
                            <div className="flex items-center justify-between gap-4 text-sm">
                              <span className="font-medium text-slate-100">{file.fileName}</span>
                              <span className={file.status === 'completed' ? 'text-emerald-300' : file.status === 'failed' ? 'text-rose-300' : 'text-slate-300'}>
                                {file.stage}
                              </span>
                            </div>
                            <Meter className="mt-3" value={file.progress} />
                            {file.errorMessage ? <p className="mt-2 text-xs text-rose-300">{file.errorMessage}</p> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </section>

        <section className="grid gap-8 lg:grid-cols-[1fr_1fr]">
          <Card className="bg-slate-900/60 p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-violet-300">AI categorization</p>
                <h2 className="mt-3 text-2xl font-semibold">Review queue and learned rules</h2>
              </div>
              <Button disabled={isWorking || reviewTransactions.length === 0} onClick={handleSuggestCategories}>
                Suggest categories
              </Button>
            </div>
            <div className="mt-6 space-y-4">
              {reviewTransactions.length === 0 ? (
                <p className="text-sm text-slate-400">No low-confidence transactions pending review.</p>
              ) : (
                reviewTransactions.map((transaction) => {
                  const suggestion = categorySuggestions.suggestions.find(
                    (entry) => entry.transactionId === transaction.id,
                  );

                  return (
                    <div key={transaction.id} className="rounded-2xl bg-slate-950/80 p-4 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="font-medium text-slate-100">{transaction.descriptionRaw}</p>
                          <p className="mt-1 text-slate-500">
                            {transaction.accountName} | {formatCurrency(transaction.amount)} | {transaction.currentCategory.replaceAll('_', ' ')}
                          </p>
                        </div>
                        <span className="text-slate-400">{(transaction.confidenceScore * 100).toFixed(0)}%</span>
                      </div>

                      {suggestion ? (
                        <div className="mt-4 rounded-2xl border border-sky-400/20 bg-slate-900/70 p-3">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <p className="font-medium text-sky-300">
                                {suggestion.suggestedCategory.replaceAll('_', ' ')}
                              </p>
                              <p className="mt-1 text-xs text-slate-400">{suggestion.rationale}</p>
                            </div>
                            <Button
                              className="bg-slate-800 text-slate-100 hover:bg-slate-700"
                              disabled={isWorking}
                              onClick={() => void handleApplySuggestion(transaction.id, suggestion.suggestedCategory)}
                            >
                              Apply
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          <Card className="bg-slate-900/60 p-8">
            <p className="text-sm uppercase tracking-[0.3em] text-amber-300">Normalization reports</p>
            <div className="mt-6 space-y-4">
              {normalizationHistory.reports.length === 0 ? (
                <p className="text-sm text-slate-400">Reports appear after imports are normalized.</p>
              ) : (
                normalizationHistory.reports.map((report) => (
                  <div key={report.id} className="rounded-2xl bg-slate-950/80 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-slate-100">
                          {report.summary.insertedTransactions} normalized transactions
                        </p>
                        <p className="mt-1 text-xs text-slate-500">{report.createdAt}</p>
                      </div>
                      <span className="rounded-full bg-slate-900 px-3 py-1 text-xs text-slate-300">
                        {report.summary.duplicateTransactions} duplicates
                      </span>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl bg-slate-900/70 p-3 text-sm">
                        <p className="text-slate-400">Accounts</p>
                        <p className="mt-1 text-slate-100">{report.summary.accounts.join(', ') || 'Unknown'}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-900/70 p-3 text-sm">
                        <p className="text-slate-400">Low confidence</p>
                        <p className="mt-1 text-slate-100">{report.summary.lowConfidenceTransactions}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </section>

        <section className="grid gap-8 lg:grid-cols-[1fr_1fr]">
          <Card className="bg-slate-900/60 p-8">
            <p className="text-sm uppercase tracking-[0.3em] text-emerald-300">AI advisor</p>
            <textarea
              className="mt-4 min-h-28 w-full rounded-3xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none"
              value={advisorQuestion}
              onChange={(event) => setAdvisorQuestion(event.target.value)}
            />
            <div className="mt-4 flex gap-3">
              <Button disabled={isWorking} onClick={handleAskAdvisor}>
                Ask advisor
              </Button>
              <Button
                className="bg-slate-800 text-slate-100 hover:bg-slate-700"
                disabled={isWorking}
                onClick={handleGenerateSavingsPlan}
              >
                Generate savings plan
              </Button>
            </div>

            {advisorResponse ? (
              <div className="mt-6 rounded-3xl bg-slate-950/80 p-5">
                <p className="text-sm uppercase tracking-[0.2em] text-sky-300">Advisor answer</p>
                <p className="mt-3 text-sm leading-7 text-slate-200">{advisorResponse.answer}</p>
                <ul className="mt-4 space-y-3">
                  {advisorResponse.insights.map((insight) => (
                    <li key={insight.title} className="rounded-2xl bg-slate-900/70 p-4 text-sm">
                      <p className="font-medium text-slate-100">{insight.title}</p>
                      <p className="mt-2 text-slate-300">{insight.detail}</p>
                      <p className="mt-2 text-xs text-slate-500">{insight.supportingData}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          <Card className="bg-slate-900/60 p-8">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-violet-300">Goals and optimizer</p>
                <h2 className="mt-3 text-2xl font-semibold">Unlimited savings goals</h2>
              </div>
              <Button className="bg-slate-800 text-slate-100 hover:bg-slate-700" onClick={handleAddGoal}>
                Add goal
              </Button>
            </div>

            <div className="mt-6 space-y-4">
              {goals.goals.length === 0 ? (
                <p className="text-sm text-slate-400">Create your first goal to unlock the optimizer forecast.</p>
              ) : (
                goals.goals.map((goal) => (
                  <div key={goal.id} className="rounded-2xl bg-slate-950/80 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <input
                          className="w-full rounded-2xl bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none"
                          value={goal.name}
                          onChange={(event) =>
                            void handleGoalChange({ ...goal, name: event.target.value })
                          }
                        />
                        <div className="mt-3 grid gap-3 sm:grid-cols-3">
                          {[
                            { label: 'Target', value: goal.targetAmount, key: 'targetAmount' as const },
                            { label: 'Current', value: goal.currentAmount, key: 'currentAmount' as const },
                            {
                              label: 'Monthly target',
                              value: goal.monthlyContributionTarget,
                              key: 'monthlyContributionTarget' as const
                            }
                          ].map((field) => (
                            <label key={field.key} className="text-xs text-slate-400">
                              {field.label}
                              <input
                                className="mt-1 w-full rounded-2xl bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none"
                                type="number"
                                value={field.value}
                                onChange={(event) =>
                                  void handleGoalChange({
                                    ...goal,
                                    [field.key]: Number(event.target.value)
                                  })
                                }
                              />
                            </label>
                          ))}
                        </div>
                        <label className="mt-3 block text-xs text-slate-400">
                          Deadline
                          <input
                            className="mt-1 w-full rounded-2xl bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none"
                            type="date"
                            value={goal.deadline}
                            onChange={(event) =>
                              void handleGoalChange({ ...goal, deadline: event.target.value })
                            }
                          />
                        </label>
                      </div>
                      <Button
                        className="bg-slate-800 text-slate-100 hover:bg-slate-700"
                        onClick={() => void handleDeleteGoal(goal.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {savingsPlan.recommendations.length > 0 ? (
              <div className="mt-6 rounded-3xl bg-slate-950/80 p-5">
                <p className="text-sm uppercase tracking-[0.2em] text-emerald-300">Savings optimizer</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-300">
                  {formatCurrency(savingsPlan.totalMonthlySavings)} / month
                </p>
                <ul className="mt-4 space-y-3">
                  {savingsPlan.recommendations.map((recommendation) => (
                    <li key={recommendation.title} className="rounded-2xl bg-slate-900/70 p-4 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <span className="font-medium text-slate-100">{recommendation.title}</span>
                        <span className="text-emerald-300">{formatCurrency(recommendation.monthlySavings)}</span>
                      </div>
                      <p className="mt-2 text-slate-300">{recommendation.rationale}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        Goal impact: about {recommendation.goalImpactDays} days faster
                      </p>
                    </li>
                  ))}
                </ul>
                {savingsPlan.goalForecasts.length > 0 ? (
                  <ul className="mt-4 space-y-2 text-sm text-slate-300">
                    {savingsPlan.goalForecasts.map((forecast) => (
                      <li key={forecast.goalId} className="flex items-center justify-between rounded-2xl bg-slate-900/70 px-4 py-3">
                        <span>{forecast.goalId}</span>
                        <span>{forecast.successProbability.toFixed(0)}% success</span>
                        <span>{forecast.projectedCompletionDate}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </Card>
        </section>

        <section className="grid gap-8 lg:grid-cols-[1fr_1fr]">
          <Card className="bg-slate-900/60 p-8">
            <p className="text-sm uppercase tracking-[0.3em] text-amber-300">Settings</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="text-sm text-slate-300">
                AI provider
                <select
                  className="mt-2 w-full rounded-2xl bg-slate-950/80 px-3 py-3 text-sm text-slate-100 outline-none"
                  value={settings.aiProvider}
                  onChange={(event) =>
                    setSettings({ ...settings, aiProvider: event.target.value as AppSettings['aiProvider'] })
                  }
                >
                  <option value="local-rules">Local rules</option>
                  <option value="ollama">Ollama</option>
                  <option value="openai-compatible">OpenAI-compatible</option>
                </select>
              </label>
              <label className="text-sm text-slate-300">
                API base URL
                <input
                  className="mt-2 w-full rounded-2xl bg-slate-950/80 px-3 py-3 text-sm text-slate-100 outline-none"
                  value={settings.providerSettings.apiBaseUrl ?? ''}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      providerSettings: {
                        ...settings.providerSettings,
                        apiBaseUrl: event.target.value
                      }
                    })
                  }
                />
              </label>
              <label className="text-sm text-slate-300">
                Ollama model
                <input
                  className="mt-2 w-full rounded-2xl bg-slate-950/80 px-3 py-3 text-sm text-slate-100 outline-none"
                  value={settings.providerSettings.ollamaModel ?? ''}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      providerSettings: {
                        ...settings.providerSettings,
                        ollamaModel: event.target.value
                      }
                    })
                  }
                />
              </label>
              <label className="text-sm text-slate-300">
                API key
                <input
                  className="mt-2 w-full rounded-2xl bg-slate-950/80 px-3 py-3 text-sm text-slate-100 outline-none"
                  placeholder={settings.providerSettings.apiKeyConfigured ? 'Stored in Keychain' : 'Enter API key'}
                  value={apiKeyInput}
                  onChange={(event) => setApiKeyInput(event.target.value)}
                />
              </label>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {[
                { label: 'Cloud AI', key: 'cloudAiEnabled' as const },
                { label: 'Notifications', key: 'notificationsEnabled' as const },
                { label: 'Telemetry', key: 'telemetryEnabled' as const }
              ].map((toggle) => (
                <label key={toggle.key} className="flex items-center gap-3 rounded-2xl bg-slate-950/80 px-4 py-3 text-sm text-slate-300">
                  <input
                    checked={settings[toggle.key]}
                    type="checkbox"
                    onChange={(event) =>
                      setSettings({ ...settings, [toggle.key]: event.target.checked })
                    }
                  />
                  {toggle.label}
                </label>
              ))}
            </div>
            <div className="mt-4 flex gap-3">
              <Button disabled={isWorking} onClick={handleSaveSettings}>
                Save settings
              </Button>
              <Button className="bg-slate-800 text-slate-100 hover:bg-slate-700" disabled={isWorking} onClick={handleCreateBackup}>
                Create encrypted backup
              </Button>
              <Button className="bg-slate-800 text-slate-100 hover:bg-slate-700" disabled={isWorking} onClick={handleExport}>
                Export local data
              </Button>
            </div>
          </Card>

          <Card className="bg-slate-900/60 p-8">
            <p className="text-sm uppercase tracking-[0.3em] text-violet-300">Backup and release readiness</p>
            <div className="mt-6 space-y-4 text-sm text-slate-300">
              <Card className="bg-slate-950/80 p-4">
                <p className="font-medium text-slate-100">Encrypted local backups</p>
                <p className="mt-2 text-slate-400">
                  Backup archives are encrypted before being written to disk. Encryption keys are stored in macOS Keychain.
                </p>
              </Card>
              <Card className="bg-slate-950/80 p-4">
                <p className="font-medium text-slate-100">Privacy by default</p>
                <p className="mt-2 text-slate-400">
                  Telemetry remains disabled unless you explicitly enable it. Cloud AI is opt-in and API keys are never hardcoded.
                </p>
              </Card>
              <Card className="bg-slate-950/80 p-4">
                <p className="font-medium text-slate-100">App Store readiness track</p>
                <p className="mt-2 text-slate-400">
                  Hardened runtime, DMG packaging, privacy controls, export, and local encryption are all now represented in the product surface.
                </p>
              </Card>
            </div>
            <div className="mt-6 rounded-3xl bg-slate-950/80 p-5">
              <p className="text-sm uppercase tracking-[0.2em] text-sky-300">Backup history</p>
              <ul className="mt-4 space-y-3">
                {backups.backups.length === 0 ? (
                  <li className="text-sm text-slate-500">No backups created yet.</li>
                ) : (
                  backups.backups.map((backup) => (
                    <li key={backup.id} className="rounded-2xl bg-slate-900/70 px-4 py-3 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <span>{backup.createdAt}</span>
                        <span>{formatBytes(backup.sizeBytes)}</span>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">{backup.archivePath}</p>
                    </li>
                  ))
                )}
              </ul>
              {exportRecord ? (
                <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-slate-900/70 p-4 text-sm">
                  <p className="font-medium text-emerald-300">Latest export</p>
                  <p className="mt-2 text-slate-300">{exportRecord.filePath}</p>
                  <p className="mt-1 text-xs text-slate-500">Generated {exportRecord.generatedAt}</p>
                </div>
              ) : null}
            </div>
          </Card>
        </section>

        {error ? (
          <Card className="border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">{error}</Card>
        ) : null}
      </div>
    </main>
  );
};
