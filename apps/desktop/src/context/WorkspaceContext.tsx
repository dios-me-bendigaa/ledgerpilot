import {
  ALL_CATEGORIES,
  maxImportFilesPerBatch,
  type AdvisorResponse,
  type CustomCategory,
  type AppSettings,
  type BackupHistory,
  type CategorySuggestionPayload,
  type DashboardData,
  type ExportPayload,
  type Goal,
  type GoalsPayload,
  type ImportFileDescriptor,
  type ImportHistory,
  type NormalizationHistory,
  type ReviewTransaction,
  type SavingsPlan,
  type WorkspaceRegistryEntry
} from '@ledgerpilot/core';
import { useToast } from '@ledgerpilot/ui';
import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';

import type { NewGoalInput } from '../lib/format';

export const emptyDashboardData: DashboardData = {
  generatedAt: '',
  kpis: {
    netCashFlow: 0,
    income: 0,
    expenses: 0,
    savingsRate: 0,
    interestPaid: 0,
    debtPayments: 0,
    debtBreakdown: { mortgage: 0, carPayments: 0, rent: 0, creditCard: 0, lineOfCredit: 0, total: 0 },
    budgetHealth: 0,
    financialHealthScore: 0,
    internalTransfers: 0,
    reviewCount: 0
  },
  topExpenseCategories: [],
  expenseGroups: [],
  categoryComparisons: [],
  monthlyTrend: [],
  yearlyTrend: [],
  spendingCalendar: [],
  sankeyFlows: [],
  monthlyComparison: { currentPeriod: 0, previousPeriod: 0, changeAmount: 0, changePercentage: 0 },
  yearlyComparison: { currentPeriod: 0, previousPeriod: 0, changeAmount: 0, changePercentage: 0 },
  debtSummary: { accounts: [], totalOutstanding: 0, hasBalanceData: false }
};

export const emptySettings: AppSettings = {
  aiProvider: 'local-rules',
  providerSettings: {
    localModel: 'rule-engine',
    ollamaModel: 'llama3.1',
    cloudModel: '',
    apiBaseUrl: 'http://127.0.0.1:11434',
    apiKeyConfigured: false
  },
  theme: 'dark',
  notificationsEnabled: true,
  cloudAiEnabled: false,
  telemetryEnabled: false,
  importHistoryRetentionDays: 365,
  homeCurrency: 'CAD',
  aiSetupCompleted: false
};

export const emptySavingsPlan: SavingsPlan = {
  recommendations: [],
  totalMonthlySavings: 0,
  goalForecasts: [],
  financialSummary: []
};

export type TransactionSummary = {
  totalTransactions: number;
  income: number;
  expenses: number;
  reviewCount: number;
  internalTransfers: number;
  topCategories: Array<{ category: string; total: number }>;
};

export type ViewKey = 'overview' | 'transactions' | 'categorize' | 'import' | 'goals' | 'advisor' | 'settings';

type WorkspaceContextValue = {
  // navigation
  activeView: ViewKey;
  setActiveView: (view: ViewKey) => void;

  // multi-workspace: which workspace (if any) is active this session, and the full list to choose
  // from. Deliberately never auto-resumes the last-used workspace — isLoadingWorkspaces gates the
  // picker screen itself, separate from isLoadingWorkspace (singular), which gates the big
  // per-workspace data load that only starts once a workspace has actually been selected.
  workspaces: WorkspaceRegistryEntry[];
  activeWorkspaceId: string | undefined;
  isLoadingWorkspaces: boolean;

  // loading
  isLoadingWorkspace: boolean;
  isImporting: boolean;
  isWorking: boolean;
  fatalError?: string;

  // data
  selectedFiles: ImportFileDescriptor[];
  history: ImportHistory;
  normalizationHistory: NormalizationHistory;
  dashboardData: DashboardData;
  transactionSummary: TransactionSummary;
  reviewTransactions: ReviewTransaction[];
  allTransactions: ReviewTransaction[];
  txnFilter: string;
  setTxnFilter: (value: string) => void;
  categorySuggestions: CategorySuggestionPayload;
  setCategorySuggestions: (value: CategorySuggestionPayload) => void;
  customCategories: CustomCategory[];
  goals: GoalsPayload;
  settings: AppSettings;
  setSettings: (value: AppSettings) => void;
  backups: BackupHistory;
  exportRecord: ExportPayload['record'] | undefined;
  advisorQuestion: string;
  setAdvisorQuestion: (value: string) => void;
  advisorResponse: AdvisorResponse | undefined;
  savingsPlan: SavingsPlan;
  savingsPlanStale: boolean;
  apiKeyInput: string;
  setApiKeyInput: (value: string) => void;
  clearConfirm: boolean;
  restoreConfirmId: string | undefined;
  deleteGoalConfirmId: string | undefined;
  categoryOptions: string[];

  // drag/drop + file selection UX state
  isDragging: boolean;
  setIsDragging: (value: boolean) => void;

  // new-category form state
  newCategoryName: string;
  setNewCategoryName: (value: string) => void;
  newCategoryBucket: 'income' | 'expense' | 'transfer';
  setNewCategoryBucket: (value: 'income' | 'expense' | 'transfer') => void;
  newCategoryNetting: boolean;
  setNewCategoryNetting: (value: boolean) => void;

  // actions
  loadWorkspaceState: () => Promise<void>;
  handleSelectWorkspace: (workspaceId: string) => Promise<void>;
  handleCreateWorkspace: (name: string) => Promise<void>;
  setFilesWithLimitCheck: (files: ImportFileDescriptor[]) => void;
  handleSelectFiles: () => Promise<void>;
  handleImport: () => Promise<void>;
  handleResume: (batchId: string) => Promise<void>;
  handleRerunNormalization: (batchId: string) => Promise<void>;
  onDropFiles: (event: React.DragEvent<HTMLDivElement>) => Promise<void>;
  handleSuggestCategories: () => Promise<void>;
  handleAcceptAllSuggestions: () => Promise<void>;
  handleApplySuggestion: (transactionId: string, suggestedCategory: ReviewTransaction['currentCategory']) => Promise<void>;
  handleAddCategory: () => Promise<void>;
  handleReassignCategory: (transaction: ReviewTransaction, category: string) => Promise<void>;
  handleAskAdvisor: () => Promise<void>;
  handleGenerateSavingsPlan: () => Promise<void>;
  handleSaveSettings: () => Promise<void>;
  handleGoalChange: (goal: Goal) => Promise<void>;
  handleCreateGoal: (draft: NewGoalInput) => Promise<void>;
  handleDeleteGoal: (goalId: string) => Promise<void>;
  handleCreateBackup: () => Promise<void>;
  handleRestoreBackup: (backupId: string) => Promise<void>;
  handleClearAllData: () => Promise<void>;
  handleExport: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

export const WorkspaceProvider = ({ children }: PropsWithChildren) => {
  const toast = useToast();

  const [activeView, setActiveView] = useState<ViewKey>('overview');
  const [workspaces, setWorkspaces] = useState<WorkspaceRegistryEntry[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>();
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(true);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(true);
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
  const [allTransactions, setAllTransactions] = useState<ReviewTransaction[]>([]);
  const [txnFilter, setTxnFilter] = useState('');
  const [categorySuggestions, setCategorySuggestions] = useState<CategorySuggestionPayload>({ suggestions: [] });
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryBucket, setNewCategoryBucket] = useState<'income' | 'expense' | 'transfer'>('expense');
  const [newCategoryNetting, setNewCategoryNetting] = useState(false);
  const [goals, setGoals] = useState<GoalsPayload>({ goals: [] });
  const [settings, setSettings] = useState<AppSettings>(emptySettings);
  const [backups, setBackups] = useState<BackupHistory>({ backups: [] });
  const [exportRecord, setExportRecord] = useState<ExportPayload['record']>();
  const [advisorQuestion, setAdvisorQuestion] = useState('Where am I overspending?');
  const [advisorResponse, setAdvisorResponse] = useState<AdvisorResponse>();
  const [savingsPlan, setSavingsPlan] = useState<SavingsPlan>(emptySavingsPlan);
  const [savingsPlanStale, setSavingsPlanStale] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [restoreConfirmId, setRestoreConfirmId] = useState<string>();
  const [deleteGoalConfirmId, setDeleteGoalConfirmId] = useState<string>();
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
        nextBackups,
        nextCustomCategories,
        nextAllTransactions
      ] = await Promise.all([
        window.ledgerPilot.imports.history(),
        window.ledgerPilot.normalization.history(),
        window.ledgerPilot.transactions.summary(),
        window.ledgerPilot.dashboard.data(),
        window.ledgerPilot.transactions.review(),
        window.ledgerPilot.goals.get(),
        window.ledgerPilot.settings.get(),
        window.ledgerPilot.backup.history(),
        window.ledgerPilot.categories.list(),
        window.ledgerPilot.transactions.all()
      ]);

      setHistory(nextHistory);
      setNormalizationHistory(nextNormalizationHistory);
      setTransactionSummary(nextTransactionSummary);
      setDashboardData(nextDashboardData);
      setReviewTransactions(nextReviewTransactions.transactions);
      setGoals(nextGoals);
      setSettings(nextSettings.settings);
      setBackups(nextBackups);
      setCustomCategories(nextCustomCategories.categories);
      setAllTransactions(nextAllTransactions.transactions);
      setFatalError(undefined);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.stack ?? nextError.message : String(nextError);
      console.error('LedgerPilot loadWorkspaceState failed', nextError);
      setFatalError(message);
    } finally {
      setIsLoadingWorkspace(false);
    }
  };

  // Fetches the workspace list only — does NOT load per-workspace data (that only happens once a
  // workspace is actually selected, via handleSelectWorkspace below). Runs on every launch, since
  // the picker is deliberately never skipped in favour of auto-resuming the last workspace.
  useEffect(() => {
    (async () => {
      try {
        setWorkspaces((await window.ledgerPilot.workspace.list()).workspaces);
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.stack ?? nextError.message : String(nextError);
        console.error('LedgerPilot workspace.list failed', nextError);
        setFatalError(message);
      } finally {
        setIsLoadingWorkspaces(false);
      }
    })();
  }, []);

  const handleSelectWorkspace = async (workspaceId: string) => {
    setIsLoadingWorkspace(true);
    try {
      await window.ledgerPilot.workspace.select(workspaceId);
      setActiveWorkspaceId(workspaceId);
      await loadWorkspaceState();
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.stack ?? nextError.message : String(nextError);
      console.error('LedgerPilot workspace.select failed', nextError);
      setFatalError(message);
      setIsLoadingWorkspace(false);
    }
  };

  const handleCreateWorkspace = async (name: string) => {
    try {
      const entry = await window.ledgerPilot.workspace.create(name);
      setWorkspaces((await window.ledgerPilot.workspace.list()).workspaces);
      await handleSelectWorkspace(entry.id);
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : 'Failed to create workspace.');
    }
  };

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
      toast.error(`You can import up to ${maxImportFilesPerBatch} CSV files at once.`);
    }

    setSelectedFiles(mergeFiles(incomingFiles));
  };

  const handleSelectFiles = async () => {
    try {
      const files = await window.ledgerPilot.imports.selectFiles();
      setFilesWithLimitCheck(files);
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : 'Failed to open file picker.');
    }
  };

  const handleImport = async () => {
    if (selectedFiles.length === 0) {
      toast.error('Choose at least one CSV file before importing.');
      return;
    }

    setIsImporting(true);

    try {
      const result = await window.ledgerPilot.imports.start(selectedFiles);
      setSelectedFiles([]);
      await loadWorkspaceState();
      const inserted = result.normalizationReport?.summary.insertedTransactions ?? 0;
      const malformed = result.normalizationReport?.summary.malformedRowCount ?? 0;
      toast.success(
        malformed > 0
          ? `Imported ${inserted} transactions — ${malformed} row(s) flagged for review due to formatting issues.`
          : `Imported ${inserted} transactions.`,
      );
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : 'Import failed.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleResume = async (batchId: string) => {
    setIsImporting(true);
    try {
      await window.ledgerPilot.imports.resume(batchId);
      await loadWorkspaceState();
      toast.success('Resumed failed files.');
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : 'Resume failed.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleRerunNormalization = async (batchId: string) => {
    setIsImporting(true);
    try {
      await window.ledgerPilot.normalization.rerunBatch(batchId);
      await loadWorkspaceState();
      toast.success('Batch re-processed.');
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : 'Re-processing failed.');
    } finally {
      setIsImporting(false);
    }
  };

  const onDropFiles = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);

    type DroppedFile = File & { path?: string };
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
    try {
      setCategorySuggestions(await window.ledgerPilot.categorization.suggest());
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : 'Failed to suggest categories.');
    } finally {
      setIsWorking(false);
    }
  };

  const handleAcceptAllSuggestions = async () => {
    const nonUnknown = categorySuggestions.suggestions.filter((s) => s.suggestedCategory !== 'unknown');
    if (nonUnknown.length === 0) return;
    setIsWorking(true);
    try {
      await Promise.all(
        nonUnknown.map((suggestion) => {
          const tx = reviewTransactions.find((t) => t.id === suggestion.transactionId);
          if (!tx) return Promise.resolve();
          return window.ledgerPilot.categorization.override({
            transactionId: suggestion.transactionId,
            merchantNormalized: tx.merchantNormalized,
            category: suggestion.suggestedCategory
          });
        }),
      );
      await loadWorkspaceState();
      setCategorySuggestions({ suggestions: [] });
      toast.success(`Applied ${nonUnknown.length} categor${nonUnknown.length === 1 ? 'y' : 'ies'}.`);
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : 'Bulk accept failed.');
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
      toast.error(nextError instanceof Error ? nextError.message : 'Failed to apply category override.');
    } finally {
      setIsWorking(false);
    }
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) {
      return;
    }
    setIsWorking(true);
    try {
      const next = await window.ledgerPilot.categories.add({
        name: newCategoryName,
        bucket: newCategoryBucket,
        nettingEnabled: newCategoryNetting
      });
      setCustomCategories(next.categories);
      setNewCategoryName('');
      setNewCategoryNetting(false);
      toast.success('Category added.');
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : 'Failed to add category.');
    } finally {
      setIsWorking(false);
    }
  };

  const handleReassignCategory = async (transaction: ReviewTransaction, category: string) => {
    setIsWorking(true);
    try {
      await window.ledgerPilot.categorization.override({
        transactionId: transaction.id,
        merchantNormalized: transaction.merchantNormalized,
        category
      });
      await loadWorkspaceState();
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : 'Failed to reassign category.');
    } finally {
      setIsWorking(false);
    }
  };

  // Built-in categories plus any user-defined ones (kept before the trailing "unknown" entry).
  const categoryOptions = [
    ...ALL_CATEGORIES.filter((c) => c !== 'unknown'),
    ...customCategories.map((c) => c.name),
    'unknown'
  ];

  const handleAskAdvisor = async () => {
    if (!advisorQuestion.trim()) {
      return;
    }

    setIsWorking(true);
    try {
      setAdvisorResponse(await window.ledgerPilot.advisor.ask(advisorQuestion));
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : 'Advisor request failed.');
    } finally {
      setIsWorking(false);
    }
  };

  const handleGenerateSavingsPlan = async () => {
    setIsWorking(true);
    try {
      setSavingsPlan(await window.ledgerPilot.advisor.savingsPlan());
      setSavingsPlanStale(false);
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : 'Savings plan failed.');
    } finally {
      setIsWorking(false);
    }
  };

  const handleSaveSettings = async () => {
    setClearConfirm(false);
    setIsWorking(true);
    try {
      const response = await window.ledgerPilot.settings.save({
        settings,
        apiKey: apiKeyInput.trim() || undefined
      });
      setSettings(response.settings);
      setApiKeyInput('');
      toast.success('Settings saved.');
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : 'Saving settings failed.');
    } finally {
      setIsWorking(false);
    }
  };

  // Full round-trip on every save (not per-keystroke — GoalsPage holds its own local draft state
  // while editing and only calls this once, on explicit Save), so toggling isWorking here is safe
  // and gives real feedback instead of a silent background write.
  const handleGoalChange = async (goal: Goal) => {
    setIsWorking(true);
    try {
      setGoals(await window.ledgerPilot.goals.upsert({ ...goal, updatedAt: new Date().toISOString() }));
      setSavingsPlanStale(true);
      toast.success('Goal updated.');
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : 'Failed to save goal.');
    } finally {
      setIsWorking(false);
    }
  };

  const handleCreateGoal = async (draft: NewGoalInput) => {
    setIsWorking(true);
    try {
      const now = new Date().toISOString();
      setGoals(
        await window.ledgerPilot.goals.upsert({
          id: crypto.randomUUID(),
          name: draft.name.trim() || 'New goal',
          targetAmount: draft.targetAmount,
          currentAmount: draft.currentAmount,
          deadline: draft.deadline,
          monthlyContributionTarget: draft.monthlyContributionTarget,
          createdAt: now,
          updatedAt: now
        }),
      );
      setSavingsPlanStale(true);
      toast.success('Goal created.');
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : 'Failed to create goal.');
    } finally {
      setIsWorking(false);
    }
  };

  // Two-step confirm (click once to arm, click again to actually delete) — matches the same
  // pattern used for restore-backup/clear-all-data below; deleting a goal has no undo.
  const handleDeleteGoal = async (goalId: string) => {
    if (deleteGoalConfirmId !== goalId) {
      setDeleteGoalConfirmId(goalId);
      return;
    }
    setIsWorking(true);
    setDeleteGoalConfirmId(undefined);
    try {
      setGoals(await window.ledgerPilot.goals.delete(goalId));
      setSavingsPlanStale(true);
      toast.success('Goal removed.');
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : 'Failed to delete goal.');
    } finally {
      setIsWorking(false);
    }
  };

  const handleCreateBackup = async () => {
    setIsWorking(true);
    try {
      await window.ledgerPilot.backup.create();
      setBackups(await window.ledgerPilot.backup.history());
      toast.success('Encrypted backup created.');
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : 'Backup creation failed.');
    } finally {
      setIsWorking(false);
    }
  };

  // Two-step confirm (click once to arm, click again to actually restore) — restoring overwrites
  // the entire current workspace, so it shouldn't be a single accidental click.
  const handleRestoreBackup = async (backupId: string) => {
    if (restoreConfirmId !== backupId) {
      setRestoreConfirmId(backupId);
      return;
    }

    setIsWorking(true);
    setRestoreConfirmId(undefined);
    try {
      await window.ledgerPilot.backup.restore(backupId);
      await loadWorkspaceState();
      setBackups(await window.ledgerPilot.backup.history());
      setSavingsPlan(emptySavingsPlan);
      setSavingsPlanStale(false);
      setAdvisorResponse(undefined);
      setCategorySuggestions({ suggestions: [] });
      setExportRecord(undefined);
      toast.success('Workspace restored from backup.');
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : 'Restore failed.');
    } finally {
      setIsWorking(false);
    }
  };

  const handleClearAllData = async () => {
    if (!clearConfirm) {
      setClearConfirm(true);
      return;
    }
    setIsWorking(true);
    setClearConfirm(false);
    try {
      await window.ledgerPilot.workspace.clear();
      await loadWorkspaceState();
      setSavingsPlan(emptySavingsPlan);
      setSavingsPlanStale(false);
      setAdvisorResponse(undefined);
      setCategorySuggestions({ suggestions: [] });
      setExportRecord(undefined);
      toast.success('All local data cleared.');
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : 'Clear failed.');
    } finally {
      setIsWorking(false);
    }
  };

  const handleExport = async () => {
    setIsWorking(true);
    try {
      setExportRecord((await window.ledgerPilot.exportData.generate()).record);
      toast.success('Data exported.');
    } catch (nextError) {
      toast.error(nextError instanceof Error ? nextError.message : 'Export failed.');
    } finally {
      setIsWorking(false);
    }
  };

  // Wires the native application menu (main process) to this renderer's state. This is the only
  // main -> renderer push channel in the app; menu clicks call mainWindow.webContents.send(...),
  // and these listeners translate that into the same state updates a normal button click would
  // produce, so "View > Transactions" (Cmd+2) behaves identically to clicking the sidebar.
  //
  // The listeners are registered exactly once (mount-only, IPC subscriptions shouldn't be
  // torn down/re-added on every render), but handleExport/handleCreateBackup/
  // setFilesWithLimitCheck are plain function values recreated every render and close over
  // current state (e.g. selectedFiles). Capturing them directly in a []-deps effect would call a
  // permanently-stale first-render closure forever. Routing through a ref that's updated every
  // render (cheap, no subscription churn) gets both: a one-time subscription that always invokes
  // the current logic.
  const latestHandlers = useRef({ setFilesWithLimitCheck, handleExport, handleCreateBackup });
  latestHandlers.current = { setFilesWithLimitCheck, handleExport, handleCreateBackup };

  useEffect(() => {
    const offNavigate = window.ledgerPilot.menuEvents.onNavigate((view) => setActiveView(view as ViewKey));
    const offFiles = window.ledgerPilot.menuEvents.onFilesSelected((files) => latestHandlers.current.setFilesWithLimitCheck(files));
    const offExport = window.ledgerPilot.menuEvents.onRequestExport(() => void latestHandlers.current.handleExport());
    const offBackup = window.ledgerPilot.menuEvents.onRequestBackup(() => void latestHandlers.current.handleCreateBackup());
    return () => {
      offNavigate();
      offFiles();
      offExport();
      offBackup();
    };
  }, []);

  const value: WorkspaceContextValue = {
    activeView,
    setActiveView,
    workspaces,
    activeWorkspaceId,
    isLoadingWorkspaces,
    isLoadingWorkspace,
    isImporting,
    isWorking,
    fatalError,
    selectedFiles,
    history,
    normalizationHistory,
    dashboardData,
    transactionSummary,
    reviewTransactions,
    allTransactions,
    txnFilter,
    setTxnFilter,
    categorySuggestions,
    setCategorySuggestions,
    customCategories,
    goals,
    settings,
    setSettings,
    backups,
    exportRecord,
    advisorQuestion,
    setAdvisorQuestion,
    advisorResponse,
    savingsPlan,
    savingsPlanStale,
    apiKeyInput,
    setApiKeyInput,
    clearConfirm,
    restoreConfirmId,
    deleteGoalConfirmId,
    categoryOptions,
    isDragging,
    setIsDragging,
    newCategoryName,
    setNewCategoryName,
    newCategoryBucket,
    setNewCategoryBucket,
    newCategoryNetting,
    setNewCategoryNetting,
    loadWorkspaceState,
    handleSelectWorkspace,
    handleCreateWorkspace,
    setFilesWithLimitCheck,
    handleSelectFiles,
    handleImport,
    handleResume,
    handleRerunNormalization,
    onDropFiles,
    handleSuggestCategories,
    handleAcceptAllSuggestions,
    handleApplySuggestion,
    handleAddCategory,
    handleReassignCategory,
    handleAskAdvisor,
    handleGenerateSavingsPlan,
    handleSaveSettings,
    handleGoalChange,
    handleCreateGoal,
    handleDeleteGoal,
    handleCreateBackup,
    handleRestoreBackup,
    handleClearAllData,
    handleExport
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export const useWorkspace = (): WorkspaceContextValue => {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
};
