import type Database from 'better-sqlite3';

import {
  DEBT_CATEGORIES,
  INCOME_CATEGORIES,
  TRANSFER_CATEGORIES,
  classifyAccountDebtType,
  groupForCategory,
  type CalendarHeatmapPoint,
  type CategoryMonthComparison,
  type CategoryTotal,
  type DashboardComparison,
  type DashboardData,
  type DashboardKpi,
  type DebtAccountSummary,
  type DebtBreakdown,
  type DebtSummary,
  type GroupTotal,
  type SankeyFlow,
  type TimeSeriesPoint
} from '@ledgerpilot/core';

type AggregateRow = {
  income: number | null;
  expenses: number | null;
  interestPaid: number | null;
  debtPayments: number | null;
  debtMortgage: number | null;
  debtCar: number | null;
  debtRent: number | null;
  debtCreditCard: number | null;
  debtLoc: number | null;
  internalTransfers: number | null;
  reviewCount: number | null;
};

const safeNumber = (value: number | null | undefined) => value ?? 0;

const roundCurrency = (value: number) => Number(value.toFixed(2));

// Derive SQL predicates from the shared core registry so income/expense/transfer stay symmetric
// and there is one source of truth for which categories count as spending. Single-quotes in
// category names are escaped so user-defined names can't break the SQL.
const sqlList = (categories: readonly string[]) => categories.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ');

// Custom categories registered at runtime extend the income/transfer buckets. Expense needs no
// registration: anything negative that is not income/transfer/unknown counts as expense.
let extraIncome: string[] = [];
let extraTransfer: string[] = [];
// Categories whose positive-amount transactions net against their own negative-amount
// transactions when computing spend aggregates (e.g. a remittance sent out, partly reimbursed
// back in — both legitimately belong to the same category, and only the net matters for
// "how much did this actually cost"). 'india_expenses' is a built-in default so existing users'
// dashboards keep behaving exactly as before; any custom category can opt in via nettingEnabled.
let nettingCategories: string[] = ['india_expenses'];

export const setCustomCategoryBuckets = (
  customs: ReadonlyArray<{ name: string; bucket: 'income' | 'expense' | 'transfer'; nettingEnabled?: boolean }>,
) => {
  extraIncome = customs.filter((c) => c.bucket === 'income').map((c) => c.name);
  extraTransfer = customs.filter((c) => c.bucket === 'transfer').map((c) => c.name);
  const customNetting = customs.filter((c) => c.nettingEnabled).map((c) => c.name);
  nettingCategories = [...new Set(['india_expenses', ...customNetting])];
};

const incomeCats = () => [...INCOME_CATEGORIES, ...extraIncome];
const transferCats = () => [...TRANSFER_CATEGORIES, ...extraTransfer];

// Income: positive money in an income-flagged category.
const incomePredicate = () =>
  `amount > 0 AND is_internal_transfer = 0 AND category IN (${sqlList(incomeCats())})`;

// Expense: negative money that is neither income nor a transfer/debt movement. Transfers between
// the user's own accounts and debt servicing are excluded so single-account imports don't inflate
// totals when transfer pairing can't fire. `unknown` is excluded too — those rows are pending
// review (surfaced via reviewCount), not confirmed spend, so they never inflate either side.
const debtCats = () => [...DEBT_CATEGORIES];

const expensePredicate = () =>
  `amount < 0 AND is_internal_transfer = 0 ` +
  `AND category NOT IN (${sqlList([...incomeCats(), ...transferCats(), ...debtCats(), 'unknown'])})`;

// Extends expensePredicate to include positive-amount transactions in any netting-enabled
// category (built-in: india_expenses; plus any custom category with nettingEnabled) so a partial
// reimbursement/return nets against the original outgoing amount rather than counting as separate
// income. Only used in aggregates/category totals — NOT the calendar heatmap (don't want credit
// days to look like spending days).
const netExpensePredicate = () =>
  `(${expensePredicate()} OR (category IN (${sqlList(nettingCategories)}) AND amount > 0 AND is_internal_transfer = 0))`;

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
      SUM(CASE WHEN ${incomePredicate()} THEN amount ELSE 0 END) as income,
      ABS(SUM(CASE WHEN ${netExpensePredicate()} THEN amount ELSE 0 END)) as expenses,
      ABS(SUM(CASE WHEN category = 'interest_charges' AND amount < 0 THEN amount ELSE 0 END)) as interestPaid,
      ABS(SUM(CASE WHEN category IN ('credit_card_payments', 'mortgage_payments', 'car_payments', 'line_of_credit_payments', 'rent') AND amount < 0 THEN amount ELSE 0 END)) as debtPayments,
      ABS(SUM(CASE WHEN category = 'mortgage_payments' AND amount < 0 THEN amount ELSE 0 END)) as debtMortgage,
      ABS(SUM(CASE WHEN category = 'car_payments' AND amount < 0 THEN amount ELSE 0 END)) as debtCar,
      ABS(SUM(CASE WHEN category = 'rent' AND amount < 0 THEN amount ELSE 0 END)) as debtRent,
      ABS(SUM(CASE WHEN category = 'credit_card_payments' AND amount < 0 THEN amount ELSE 0 END)) as debtCreditCard,
      ABS(SUM(CASE WHEN category = 'line_of_credit_payments' AND amount < 0 THEN amount ELSE 0 END)) as debtLoc,
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
       WHERE ${netExpensePredicate()}
       GROUP BY category
       ORDER BY total DESC
       LIMIT 12`,
    )
    .all() as Array<{ category: string; total: number }>;

  return rows.map((row) => ({ category: row.category, total: roundCurrency(row.total) }));
};

// Roll every expense category up into its parent group (Home, Car, Food, ...), sorted by size,
// with each group's category breakdown for drill-down on the dashboard.
const getExpenseGroups = (database: Database.Database): GroupTotal[] => {
  const rows = database
    .prepare(
      `SELECT category, ABS(SUM(amount)) as total
       FROM transactions
       WHERE ${netExpensePredicate()}
       GROUP BY category`,
    )
    .all() as Array<{ category: string; total: number }>;

  const groups = new Map<string, CategoryTotal[]>();
  for (const row of rows) {
    const group = groupForCategory(row.category);
    const bucket = groups.get(group) ?? [];
    bucket.push({ category: row.category, total: roundCurrency(row.total) });
    groups.set(group, bucket);
  }

  return [...groups.entries()]
    .map(([group, categories]) => ({
      group,
      total: roundCurrency(categories.reduce((sum, c) => sum + c.total, 0)),
      categories: categories.sort((a, b) => b.total - a.total)
    }))
    .sort((a, b) => b.total - a.total);
};

const getTimeSeries = (database: Database.Database, format: string, limit: number): TimeSeriesPoint[] => {
  const rows = database
    .prepare(
      `SELECT
         strftime('${format}', posted_date) as label,
         SUM(CASE WHEN ${incomePredicate()} THEN amount ELSE 0 END) as income,
         ABS(SUM(CASE WHEN ${netExpensePredicate()} THEN amount ELSE 0 END)) as expenses
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
       WHERE ${expensePredicate()}
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
       WHERE ${netExpensePredicate()}
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

const getCategoryComparisons = (database: Database.Database): CategoryMonthComparison[] => {
  const curr = getCurrentMonthKey();
  const prev = getPreviousMonthKey();
  const rows = database
    .prepare(
      `SELECT category,
         ABS(SUM(CASE WHEN strftime('%Y-%m', posted_date) = ? THEN amount ELSE 0 END)) as current_month,
         ABS(SUM(CASE WHEN strftime('%Y-%m', posted_date) = ? THEN amount ELSE 0 END)) as prev_month
       FROM transactions
       WHERE ${netExpensePredicate()}
       GROUP BY category
       HAVING current_month > 0 OR prev_month > 0
       ORDER BY current_month DESC
       LIMIT 8`,
    )
    .all(curr, prev) as Array<{ category: string; current_month: number; prev_month: number }>;
  return rows.map((row) => ({
    category: row.category,
    currentMonth: roundCurrency(row.current_month),
    previousMonth: roundCurrency(row.prev_month),
    changeAmount: roundCurrency(row.current_month - row.prev_month)
  }));
};

const getCurrentYearKey = () => new Date().getFullYear().toString();

const getPreviousYearKey = () => (new Date().getFullYear() - 1).toString();

const getPeriodNetCashFlow = (database: Database.Database, format: string, key: string) => {
  const row = database
    .prepare(
      `SELECT
         SUM(CASE WHEN ${incomePredicate()} THEN amount ELSE 0 END) as income,
         ABS(SUM(CASE WHEN ${netExpensePredicate()} THEN amount ELSE 0 END)) as expenses
       FROM transactions
       WHERE strftime('${format}', posted_date) = ?`,
    )
    .get(key) as { income: number | null; expenses: number | null };

  return roundCurrency(safeNumber(row.income) - safeNumber(row.expenses));
};

// Real outstanding debt — what you actually still owe, not just what flowed through payment
// categories this period. For every account that (a) looks like a credit card or line of credit
// by name and (b) has at least one row with a captured balance_after (only present when the
// source CSV had a running-balance column), takes that account's MOST RECENT balance as the
// current amount owed, and sums across every such account. Separately reports how much of that
// account's payment activity was interest vs. actual debt reduction, so a $200 LOC payment where
// $30 was interest_charges and $170 was line_of_credit_payments shows as "interest: $30, went
// toward the balance: $170" instead of one undifferentiated "$200 paid" figure.
const getDebtSummary = (database: Database.Database): DebtSummary => {
  const accountRows = database
    .prepare(
      `SELECT DISTINCT account_name as accountName
       FROM transactions
       WHERE balance_after IS NOT NULL`,
    )
    .all() as Array<{ accountName: string }>;

  const debtAccountNames = accountRows
    .map((row) => row.accountName)
    .filter((accountName) => {
      const type = classifyAccountDebtType(accountName);
      return type === 'credit_card' || type === 'line_of_credit';
    });

  if (debtAccountNames.length === 0) {
    return { accounts: [], totalOutstanding: 0, hasBalanceData: false };
  }

  const latestBalanceStmt = database.prepare(
    `SELECT balance_after as balanceAfter, posted_at as postedAt
     FROM transactions
     WHERE account_name = ? AND balance_after IS NOT NULL
     ORDER BY posted_at DESC, id DESC
     LIMIT 1`,
  );

  const interestPrincipalStmt = database.prepare(
    `SELECT
       ABS(SUM(CASE WHEN category = 'interest_charges' AND amount < 0 THEN amount ELSE 0 END)) as interestPortion,
       ABS(SUM(CASE WHEN category IN ('line_of_credit_payments', 'credit_card_payments') AND amount < 0 THEN amount ELSE 0 END)) as principalPortion
     FROM transactions
     WHERE account_name = ?`,
  );

  const accounts: DebtAccountSummary[] = debtAccountNames.map((accountName) => {
    const latest = latestBalanceStmt.get(accountName) as { balanceAfter: number; postedAt: string } | undefined;
    const split = interestPrincipalStmt.get(accountName) as { interestPortion: number | null; principalPortion: number | null };
    const accountType = classifyAccountDebtType(accountName);

    return {
      accountName,
      accountType: accountType === 'credit_card' || accountType === 'line_of_credit' ? accountType : 'other',
      // Outstanding balance is what's OWED, regardless of whether the bank's own statement
      // convention represents that as negative (a ledger of "spent minus paid") or positive —
      // ABS() normalizes both conventions to a plain "amount owed" figure for display.
      outstandingBalance: roundCurrency(Math.abs(safeNumber(latest?.balanceAfter))),
      asOfDate: latest?.postedAt ?? '',
      interestPortion: roundCurrency(safeNumber(split.interestPortion)),
      principalPortion: roundCurrency(safeNumber(split.principalPortion))
    };
  });

  return {
    accounts: accounts.sort((a, b) => b.outstandingBalance - a.outstandingBalance),
    totalOutstanding: roundCurrency(accounts.reduce((sum, account) => sum + account.outstandingBalance, 0)),
    hasBalanceData: true
  };
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

  const debtBreakdown: DebtBreakdown = {
    mortgage: roundCurrency(safeNumber(aggregate.debtMortgage)),
    carPayments: roundCurrency(safeNumber(aggregate.debtCar)),
    rent: roundCurrency(safeNumber(aggregate.debtRent)),
    creditCard: roundCurrency(safeNumber(aggregate.debtCreditCard)),
    lineOfCredit: roundCurrency(safeNumber(aggregate.debtLoc)),
    total: roundCurrency(safeNumber(aggregate.debtPayments))
  };

  const kpis: DashboardKpi = {
    netCashFlow,
    income,
    expenses,
    savingsRate,
    interestPaid: roundCurrency(safeNumber(aggregate.interestPaid)),
    debtPayments: roundCurrency(safeNumber(aggregate.debtPayments)),
    debtBreakdown,
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
    expenseGroups: getExpenseGroups(database),
    categoryComparisons: getCategoryComparisons(database),
    monthlyTrend: getTimeSeries(database, '%Y-%m', 12),
    yearlyTrend: getTimeSeries(database, '%Y', 5),
    spendingCalendar: getCalendarHeatmap(database),
    sankeyFlows: getSankeyFlows(database),
    monthlyComparison,
    yearlyComparison,
    debtSummary: getDebtSummary(database)
  };
};
