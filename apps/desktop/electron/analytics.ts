import type Database from 'better-sqlite3';

import type {
  CalendarHeatmapPoint,
  CategoryTotal,
  DashboardComparison,
  DashboardData,
  DashboardKpi,
  SankeyFlow,
  TimeSeriesPoint
} from '@ledgerpilot/core';

type AggregateRow = {
  income: number | null;
  expenses: number | null;
  interestPaid: number | null;
  debtPayments: number | null;
  internalTransfers: number | null;
  reviewCount: number | null;
};

const safeNumber = (value: number | null | undefined) => value ?? 0;

const roundCurrency = (value: number) => Number(value.toFixed(2));

const makeComparison = (currentPeriod: number, previousPeriod: number): DashboardComparison => {
  const changeAmount = roundCurrency(currentPeriod - previousPeriod);
  const changePercentage =
    previousPeriod === 0 ? (currentPeriod === 0 ? 0 : 100) : roundCurrency((changeAmount / previousPeriod) * 100);

  return {
    currentPeriod: roundCurrency(currentPeriod),
    previousPeriod: roundCurrency(previousPeriod),
    changeAmount,
    changePercentage
  };
};

const getAggregateRow = (database: Database.Database, whereClause?: string) => {
  const query = `
    SELECT
      SUM(CASE WHEN amount > 0 AND is_internal_transfer = 0 THEN amount ELSE 0 END) as income,
      ABS(SUM(CASE WHEN amount < 0 AND is_internal_transfer = 0 THEN amount ELSE 0 END)) as expenses,
      ABS(SUM(CASE WHEN category = 'interest_charges' THEN amount ELSE 0 END)) as interestPaid,
      ABS(SUM(CASE WHEN category IN ('credit_card_payments', 'mortgage_payments', 'line_of_credit_payments') THEN amount ELSE 0 END)) as debtPayments,
      SUM(CASE WHEN is_internal_transfer = 1 THEN 1 ELSE 0 END) as internalTransfers,
      SUM(CASE WHEN requires_review = 1 THEN 1 ELSE 0 END) as reviewCount
    FROM transactions
    ${whereClause ? `WHERE ${whereClause}` : ''}
  `;

  return database.prepare(query).get() as AggregateRow;
};

const getTopExpenseCategories = (database: Database.Database): CategoryTotal[] => {
  const rows = database
    .prepare(
      `SELECT category, ABS(SUM(amount)) as total
       FROM transactions
       WHERE amount < 0 AND is_internal_transfer = 0
       GROUP BY category
       ORDER BY total DESC
       LIMIT 6`,
    )
    .all() as Array<{ category: string; total: number }>;

  return rows.map((row) => ({ category: row.category, total: roundCurrency(row.total) }));
};

const getTimeSeries = (database: Database.Database, format: string, limit: number): TimeSeriesPoint[] => {
  const rows = database
    .prepare(
      `SELECT
         strftime('${format}', posted_date) as label,
         SUM(CASE WHEN amount > 0 AND is_internal_transfer = 0 THEN amount ELSE 0 END) as income,
         ABS(SUM(CASE WHEN amount < 0 AND is_internal_transfer = 0 THEN amount ELSE 0 END)) as expenses
       FROM transactions
       GROUP BY label
       ORDER BY label DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{ label: string; income: number | null; expenses: number | null }>;

  return rows
    .reverse()
    .map((row) => {
      const income = roundCurrency(safeNumber(row.income));
      const expenses = roundCurrency(safeNumber(row.expenses));
      return {
        label: row.label,
        income,
        expenses,
        netCashFlow: roundCurrency(income - expenses)
      };
    });
};

const getCalendarHeatmap = (database: Database.Database): CalendarHeatmapPoint[] => {
  const rows = database
    .prepare(
      `SELECT posted_date as date, ABS(SUM(amount)) as expenseTotal
       FROM transactions
       WHERE amount < 0 AND is_internal_transfer = 0
       GROUP BY posted_date
       ORDER BY posted_date DESC
       LIMIT 90`,
    )
    .all() as Array<{ date: string; expenseTotal: number }>;

  return rows.reverse().map((row) => ({ date: row.date, expenseTotal: roundCurrency(row.expenseTotal) }));
};

const getSankeyFlows = (database: Database.Database): SankeyFlow[] => {
  const rows = database
    .prepare(
      `SELECT account_name as source, category as target, ABS(SUM(amount)) as value
       FROM transactions
       WHERE amount < 0 AND is_internal_transfer = 0
       GROUP BY account_name, category
       ORDER BY value DESC
       LIMIT 12`,
    )
    .all() as Array<{ source: string; target: string; value: number }>;

  return rows.map((row) => ({
    source: row.source,
    target: row.target,
    value: roundCurrency(row.value)
  }));
};

const getCurrentMonthKey = () => new Date().toISOString().slice(0, 7);

const getPreviousMonthKey = () => {
  const now = new Date();
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
};

const getCurrentYearKey = () => new Date().getFullYear().toString();

const getPreviousYearKey = () => (new Date().getFullYear() - 1).toString();

const getPeriodNetCashFlow = (database: Database.Database, format: string, key: string) => {
  const row = database
    .prepare(
      `SELECT
         SUM(CASE WHEN amount > 0 AND is_internal_transfer = 0 THEN amount ELSE 0 END) as income,
         ABS(SUM(CASE WHEN amount < 0 AND is_internal_transfer = 0 THEN amount ELSE 0 END)) as expenses
       FROM transactions
       WHERE strftime('${format}', posted_date) = ?`,
    )
    .get(key) as { income: number | null; expenses: number | null };

  return roundCurrency(safeNumber(row.income) - safeNumber(row.expenses));
};

export const getDashboardData = (database: Database.Database): DashboardData => {
  const aggregate = getAggregateRow(database);
  const income = roundCurrency(safeNumber(aggregate.income));
  const expenses = roundCurrency(safeNumber(aggregate.expenses));
  const netCashFlow = roundCurrency(income - expenses);
  const savingsRate = income === 0 ? 0 : roundCurrency((netCashFlow / income) * 100);
  const budgetHealth = roundCurrency(Math.max(0, Math.min(100, 100 - (expenses / Math.max(income, 1)) * 100 + 50)));
  const financialHealthScore = roundCurrency(
    Math.max(0, Math.min(100, 50 + savingsRate * 0.4 - safeNumber(aggregate.reviewCount) * 1.5 + safeNumber(aggregate.internalTransfers) * 0.2)),
  );

  const kpis: DashboardKpi = {
    netCashFlow,
    income,
    expenses,
    savingsRate,
    interestPaid: roundCurrency(safeNumber(aggregate.interestPaid)),
    debtPayments: roundCurrency(safeNumber(aggregate.debtPayments)),
    budgetHealth,
    financialHealthScore,
    internalTransfers: safeNumber(aggregate.internalTransfers),
    reviewCount: safeNumber(aggregate.reviewCount)
  };

  const monthlyComparison = makeComparison(
    getPeriodNetCashFlow(database, '%Y-%m', getCurrentMonthKey()),
    getPeriodNetCashFlow(database, '%Y-%m', getPreviousMonthKey()),
  );

  const yearlyComparison = makeComparison(
    getPeriodNetCashFlow(database, '%Y', getCurrentYearKey()),
    getPeriodNetCashFlow(database, '%Y', getPreviousYearKey()),
  );

  return {
    generatedAt: new Date().toISOString(),
    kpis,
    topExpenseCategories: getTopExpenseCategories(database),
    monthlyTrend: getTimeSeries(database, '%Y-%m', 12),
    yearlyTrend: getTimeSeries(database, '%Y', 5),
    spendingCalendar: getCalendarHeatmap(database),
    sankeyFlows: getSankeyFlows(database),
    monthlyComparison,
    yearlyComparison
  };
};
