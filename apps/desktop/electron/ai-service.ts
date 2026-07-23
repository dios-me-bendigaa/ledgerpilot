import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import type {
  AdvisorResponse,
  AppSettings,
  CategorySuggestion,
  CategorySuggestionPayload,
  DashboardData,
  Goal,
  ReviewTransaction,
  SavingsPlan
} from '@ledgerpilot/core';

const aiServicePort = 8877;
const aiServiceUrl = `http://127.0.0.1:${aiServicePort}`;
let aiProcess: ChildProcess | undefined;
// Rolling buffer of the sidecar's stderr so a failed-to-start error can surface *why* (Python
// traceback, missing dependency, port bind failure) instead of just "AI service failed to start
// locally." Capped so a crash-looping process can't grow this unbounded.
let recentStderr: string[] = [];
const MAX_STDERR_LINES = 40;
const recordStderrChunk = (chunk: Buffer | string) => {
  const lines = chunk.toString('utf8').split(/\r?\n/).filter((line) => line.length > 0);
  recentStderr.push(...lines);
  if (recentStderr.length > MAX_STDERR_LINES) {
    recentStderr = recentStderr.slice(-MAX_STDERR_LINES);
  }
};

const postJson = async <T>(endpoint: string, payload: unknown): Promise<T> => {
  const response = await fetch(`${aiServiceUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`AI service request failed: ${response.status}`);
  }

  return (await response.json()) as T;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const ensureAiService = async (
  desktopAppPath: string,
  isPackaged: boolean,
  resourcesPath: string,
) => {
  try {
    const response = await fetch(`${aiServiceUrl}/health`);
    if (response.ok) {
      return;
    }
  } catch (error) {
    // continue to spawn below
  }

  if (!aiProcess) {
    recentStderr = [];
    if (isPackaged) {
      const binaryPath = path.join(resourcesPath, 'ai-service', 'ledgerpilot-ai');
      aiProcess = spawn(binaryPath, [], {
        env: { ...process.env, LEDGER_AI_PORT: String(aiServicePort) },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } else {
      const repoRoot = path.resolve(desktopAppPath, '..', '..');
      const servicePath = path.join(repoRoot, 'apps', 'ai-service');
      // Prefer venv python so dependencies are always available without system-wide install
      const venvPython = path.join(servicePath, '.venv', 'bin', 'python3');
      const python = existsSync(venvPython) ? venvPython : 'python3';
      aiProcess = spawn(
        python,
        ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(aiServicePort)],
        {
          cwd: servicePath,
          env: process.env,
          stdio: ['ignore', 'ignore', 'pipe'],
        },
      );
    }

    aiProcess.stderr?.on('data', recordStderrChunk);

    // Without these listeners, a crashed/killed sidecar leaves `aiProcess` as a stale non-null
    // reference. The `if (!aiProcess)` guard above would then skip respawning forever (it would
    // burn the retry budget below against a dead port and throw) until a full Electron restart.
    // Clearing the reference on exit/error lets the next ensureAiService() call respawn cleanly.
    aiProcess.on('exit', () => {
      aiProcess = undefined;
    });
    aiProcess.on('error', () => {
      aiProcess = undefined;
    });
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(`${aiServiceUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      // keep retrying
    }
    await delay(250);
  }

  const diagnostic = recentStderr.length > 0 ? `\n\nLast output from AI service:\n${recentStderr.join('\n')}` : '';
  throw new Error(`AI service failed to start locally.${diagnostic}`);
};

export const shutdownAiService = () => {
  aiProcess?.kill();
  aiProcess = undefined;
};

const defaultModelFor = (settings: AppSettings): string => {
  if (settings.aiProvider === 'ollama') return settings.providerSettings.ollamaModel ?? 'llama3.1';
  if (settings.aiProvider === 'claude') return settings.providerSettings.cloudModel || 'claude-3-5-sonnet-20241022';
  if (settings.aiProvider === 'openai-compatible') return settings.providerSettings.cloudModel || 'gpt-4o-mini';
  return 'llama3.1';
};

const defaultBaseUrlFor = (settings: AppSettings): string => {
  if (settings.aiProvider === 'claude') return settings.providerSettings.apiBaseUrl || 'https://api.anthropic.com';
  return settings.providerSettings.apiBaseUrl || 'http://127.0.0.1:11434';
};

const providerFields = (settings: AppSettings, apiKey?: string) => ({
  provider: settings.aiProvider,
  model: defaultModelFor(settings),
  base_url: defaultBaseUrlFor(settings),
  // Only attach the real API key for providers that actually need one — previously this was sent
  // unconditionally, meaning a configured OpenAI/Claude key was transmitted to the sidecar even
  // for plain local-rules/ollama requests where it's never used.
  api_key: settings.aiProvider === 'openai-compatible' || settings.aiProvider === 'claude' ? apiKey ?? null : null,
});

export const testProviderConnection = async (payload: {
  provider: AppSettings['aiProvider'];
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}): Promise<{ success: boolean; message: string; sampleReply?: string }> => {
  const raw = await postJson<{ success: boolean; message: string; sample_reply?: string }>('/provider/test', {
    provider: payload.provider,
    model: payload.model || null,
    base_url: payload.baseUrl || null,
    api_key: payload.apiKey || null
  });
  return { success: raw.success, message: raw.message, sampleReply: raw.sample_reply };
};

export const requestAdvisorResponse = async (payload: {
  settings: AppSettings;
  dashboard: DashboardData;
  goals: Goal[];
  transactions: ReviewTransaction[];
  question: string;
  apiKey?: string;
}) => {
  return postJson<AdvisorResponse>('/advisor/respond', {
    ...providerFields(payload.settings, payload.apiKey),
    question: payload.question,
    dashboard: {
      generated_at: payload.dashboard.generatedAt,
      kpis: {
        net_cash_flow: payload.dashboard.kpis.netCashFlow,
        income: payload.dashboard.kpis.income,
        expenses: payload.dashboard.kpis.expenses,
        savings_rate: payload.dashboard.kpis.savingsRate,
        interest_paid: payload.dashboard.kpis.interestPaid,
        debt_payments: payload.dashboard.kpis.debtPayments,
        budget_health: payload.dashboard.kpis.budgetHealth,
        financial_health_score: payload.dashboard.kpis.financialHealthScore,
        internal_transfers: payload.dashboard.kpis.internalTransfers,
        review_count: payload.dashboard.kpis.reviewCount
      },
      top_expense_categories: payload.dashboard.topExpenseCategories.map((entry) => ({
        category: entry.category,
        total: entry.total
      })),
      monthly_trend: payload.dashboard.monthlyTrend.map((entry) => ({
        label: entry.label,
        income: entry.income,
        expenses: entry.expenses,
        net_cash_flow: entry.netCashFlow
      })),
      yearly_trend: payload.dashboard.yearlyTrend.map((entry) => ({
        label: entry.label,
        income: entry.income,
        expenses: entry.expenses,
        net_cash_flow: entry.netCashFlow
      })),
      spending_calendar: payload.dashboard.spendingCalendar.map((entry) => ({
        date: entry.date,
        expense_total: entry.expenseTotal
      }))
    },
    transactions: payload.transactions.map((transaction) => ({
      id: transaction.id,
      account_name: transaction.accountName,
      posted_at: transaction.postedAt,
      amount: transaction.amount,
      category: transaction.currentCategory,
      description_raw: transaction.descriptionRaw,
      merchant_normalized: transaction.merchantNormalized,
      confidence_score: transaction.confidenceScore,
      is_internal_transfer: false
    })),
    goals: payload.goals.map((goal) => ({
      id: goal.id,
      name: goal.name,
      target_amount: goal.targetAmount,
      current_amount: goal.currentAmount,
      deadline: goal.deadline,
      monthly_contribution_target: goal.monthlyContributionTarget
    }))
  });
};

export const requestSavingsPlan = async (payload: {
  settings: AppSettings;
  dashboard: DashboardData;
  goals: Goal[];
  transactions: ReviewTransaction[];
  apiKey?: string;
}) => {
  const raw = await postJson<{
    recommendations: Array<{ category: string; title: string; rationale: string; monthly_savings: number; goal_impact_days: number }>;
    total_monthly_savings: number;
    goal_forecasts: Array<{
      goal_id: string; goal_name: string; required_monthly_savings: number; projected_completion_date: string;
      success_probability: number; verdict: string; shortfall_per_month: number; max_reachable_by_deadline: number; message: string;
    }>;
    financial_summary: Array<{ title: string; metric: string; recommendation: string; severity: string }>;
  }>('/advisor/savings-plan', {
    ...providerFields(payload.settings, payload.apiKey),
    question: 'Savings optimizer request',
    dashboard: {
      generated_at: payload.dashboard.generatedAt,
      kpis: {
        net_cash_flow: payload.dashboard.kpis.netCashFlow,
        income: payload.dashboard.kpis.income,
        expenses: payload.dashboard.kpis.expenses,
        savings_rate: payload.dashboard.kpis.savingsRate,
        interest_paid: payload.dashboard.kpis.interestPaid,
        debt_payments: payload.dashboard.kpis.debtPayments,
        budget_health: payload.dashboard.kpis.budgetHealth,
        financial_health_score: payload.dashboard.kpis.financialHealthScore,
        internal_transfers: payload.dashboard.kpis.internalTransfers,
        review_count: payload.dashboard.kpis.reviewCount
      },
      top_expense_categories: payload.dashboard.topExpenseCategories.map((entry) => ({
        category: entry.category,
        total: entry.total
      })),
      monthly_trend: payload.dashboard.monthlyTrend.map((entry) => ({
        label: entry.label,
        income: entry.income,
        expenses: entry.expenses,
        net_cash_flow: entry.netCashFlow
      })),
      yearly_trend: payload.dashboard.yearlyTrend.map((entry) => ({
        label: entry.label,
        income: entry.income,
        expenses: entry.expenses,
        net_cash_flow: entry.netCashFlow
      })),
      spending_calendar: []
    },
    transactions: payload.transactions.map((transaction) => ({
      id: transaction.id,
      account_name: transaction.accountName,
      posted_at: transaction.postedAt,
      amount: transaction.amount,
      category: transaction.currentCategory,
      description_raw: transaction.descriptionRaw,
      merchant_normalized: transaction.merchantNormalized,
      confidence_score: transaction.confidenceScore,
      is_internal_transfer: false
    })),
    goals: payload.goals.map((goal) => ({
      id: goal.id,
      name: goal.name,
      target_amount: goal.targetAmount,
      current_amount: goal.currentAmount,
      deadline: goal.deadline,
      monthly_contribution_target: goal.monthlyContributionTarget
    }))
  });

  return {
    recommendations: (raw.recommendations ?? []).map((r) => ({
      category: r.category,
      title: r.title,
      rationale: r.rationale,
      monthlySavings: r.monthly_savings,
      goalImpactDays: r.goal_impact_days
    })),
    totalMonthlySavings: raw.total_monthly_savings ?? 0,
    goalForecasts: (raw.goal_forecasts ?? []).map((f) => ({
      goalId: f.goal_id,
      goalName: f.goal_name,
      requiredMonthlySavings: f.required_monthly_savings,
      projectedCompletionDate: f.projected_completion_date,
      successProbability: f.success_probability,
      verdict: f.verdict as 'on_track' | 'achievable_with_cuts' | 'shortfall' | 'needs_income_boost',
      shortfallPerMonth: f.shortfall_per_month,
      maxReachableByDeadline: f.max_reachable_by_deadline,
      message: f.message,
    })),
    financialSummary: (raw.financial_summary ?? []).map((s) => ({
      title: s.title,
      metric: s.metric,
      recommendation: s.recommendation,
      severity: s.severity as 'good' | 'warning' | 'alert',
    })),
  } satisfies SavingsPlan;
};

export const requestCategorySuggestions = async (payload: {
  settings: AppSettings;
  transactions: ReviewTransaction[];
  apiKey?: string;
}) => {
  return postJson<{ provider: string; suggestions: Array<{
    transaction_id: string;
    category: CategorySuggestion['suggestedCategory'];
    confidence_score: number;
    rationale: string;
  }> }>('/categorization/suggest', {
    ...providerFields(payload.settings, payload.apiKey),
    transactions: payload.transactions.map((transaction) => ({
      id: transaction.id,
      account_name: transaction.accountName,
      posted_at: transaction.postedAt,
      amount: transaction.amount,
      category: transaction.currentCategory,
      description_raw: transaction.descriptionRaw,
      merchant_normalized: transaction.merchantNormalized,
      confidence_score: transaction.confidenceScore,
      is_internal_transfer: false
    }))
  }).then((response) => ({
    suggestions: response.suggestions.map((suggestion) => ({
      transactionId: suggestion.transaction_id,
      suggestedCategory: suggestion.category,
      confidenceScore: suggestion.confidence_score,
      rationale: suggestion.rationale
    }))
  }));
};
