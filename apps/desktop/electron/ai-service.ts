import { spawn, type ChildProcess } from 'node:child_process';
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
    if (isPackaged) {
      const binaryPath = path.join(resourcesPath, 'ai-service', 'ledgerpilot-ai');
      aiProcess = spawn(binaryPath, [], {
        env: { ...process.env, LEDGER_AI_PORT: String(aiServicePort) },
        stdio: 'ignore',
      });
    } else {
      const repoRoot = path.resolve(desktopAppPath, '..', '..');
      const servicePath = path.join(repoRoot, 'apps', 'ai-service');
      aiProcess = spawn(
        'python3',
        ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(aiServicePort)],
        {
          cwd: servicePath,
          env: process.env,
          stdio: 'ignore',
        },
      );
    }
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

  throw new Error('AI service failed to start locally.');
};

export const shutdownAiService = () => {
  aiProcess?.kill();
  aiProcess = undefined;
};

const providerFields = (settings: AppSettings, apiKey?: string) => ({
  provider: settings.aiProvider,
  model: settings.providerSettings.ollamaModel ?? 'llama3.1',
  base_url: settings.providerSettings.apiBaseUrl ?? 'http://127.0.0.1:11434',
  api_key: apiKey ?? null,
});

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
    goal_forecasts: Array<{ goal_id: string; required_monthly_savings: number; projected_completion_date: string; success_probability: number }>;
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
      monthly_trend: [],
      yearly_trend: [],
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
      requiredMonthlySavings: f.required_monthly_savings,
      projectedCompletionDate: f.projected_completion_date,
      successProbability: f.success_probability
    }))
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
