import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, CreditCard, HeartPulse, PiggyBank, TrendingUp } from 'lucide-react';

import { Badge, Card, Meter } from '@ledgerpilot/ui';

import { PageHeader } from '../components/PageHeader';
import { TrendChart } from '../components/TrendChart';
import { useWorkspace } from '../context/WorkspaceContext';
import { formatCurrencyWithCode } from '../lib/format';

export const OverviewPage = () => {
  const { dashboardData, settings } = useWorkspace();
  const [trendRange, setTrendRange] = useState<'monthly' | 'yearly'>('monthly');
  const formatCurrency = (value: number) => formatCurrencyWithCode(value, settings.homeCurrency || 'CAD');

  const kpis = dashboardData.kpis;
  const comparison = trendRange === 'monthly' ? dashboardData.monthlyComparison : dashboardData.yearlyComparison;
  const trendData = trendRange === 'monthly' ? dashboardData.monthlyTrend : dashboardData.yearlyTrend;

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title="Your financial picture"
        description={
          dashboardData.generatedAt
            ? `Last synced ${new Date(dashboardData.generatedAt).toLocaleString()}`
            : 'Import your first CSV to populate this dashboard.'
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card className="border-sky-500/10 bg-slate-900/70 p-7">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-sm text-slate-400">Net cash flow</p>
              <p className={`mt-2 text-4xl font-semibold tracking-tight ${kpis.netCashFlow >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {formatCurrency(kpis.netCashFlow)}
              </p>
              <div className="mt-3 flex items-center gap-2">
                {comparison.changeAmount >= 0 ? (
                  <Badge tone="success" dot>
                    <ArrowUpRight className="h-3 w-3" /> {comparison.changePercentage.toFixed(0)}%
                  </Badge>
                ) : (
                  <Badge tone="danger" dot>
                    <ArrowDownRight className="h-3 w-3" /> {comparison.changePercentage.toFixed(0)}%
                  </Badge>
                )}
                <span className="text-xs text-slate-500">vs. previous {trendRange === 'monthly' ? 'month' : 'year'}</span>
              </div>
            </div>
            <div className="grid gap-3 text-right">
              <div>
                <p className="text-xs text-slate-500">Savings rate</p>
                <p className="mt-1 text-xl font-semibold text-slate-100">{kpis.savingsRate.toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Review queue</p>
                <p className="mt-1 text-xl font-semibold text-slate-100">{kpis.reviewCount}</p>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-4">
            {[
              { label: 'Income', value: kpis.income, tone: 'text-emerald-300' },
              { label: 'Expenses', value: kpis.expenses, tone: 'text-rose-300' },
              { label: 'Debt payments', value: kpis.debtBreakdown.total, tone: 'text-amber-300' },
              { label: 'Interest paid', value: kpis.interestPaid, tone: 'text-orange-300' }
            ].map((item) => (
              <div key={item.label} className="rounded-2xl bg-slate-950/70 p-4">
                <p className="text-xs text-slate-500">{item.label}</p>
                <p className={`mt-1.5 text-lg font-semibold ${item.tone}`}>{formatCurrency(item.value)}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="bg-slate-900/70 p-7">
          <div className="flex items-center gap-2">
            <HeartPulse className="h-4 w-4 text-emerald-400" />
            <p className="text-sm uppercase tracking-[0.2em] text-emerald-300">Your next best move</p>
          </div>
          <div className="mt-5 space-y-5">
            <div>
              <p className="text-sm leading-6 text-slate-200">
                {kpis.reviewCount > 0 ? `First, review ${kpis.reviewCount} AI proposals so your reports use categories you trust.` : kpis.netCashFlow >= 0 ? 'You are spending less than you bring in. Choose one goal and move part of what is left over toward it.' : 'Your spending is higher than your income. Review the largest spending area and set one realistic reduction for next month.'}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-500">This replaces a vague score with a concrete next step based on your actual imported data.</p>
            </div>
            <div className="grid grid-cols-5 gap-2 pt-1">
              {[
                { label: 'Mortgage', value: kpis.debtBreakdown.mortgage },
                { label: 'Car', value: kpis.debtBreakdown.carPayments },
                { label: 'Rent', value: kpis.debtBreakdown.rent },
                { label: 'CC', value: kpis.debtBreakdown.creditCard },
                { label: 'LOC', value: kpis.debtBreakdown.lineOfCredit }
              ].map((debt) => (
                <div key={debt.label} className="rounded-xl bg-slate-950/70 p-2.5 text-center">
                  <p className="text-[10px] text-slate-500">{debt.label}</p>
                  <p className={`mt-1 truncate text-xs font-medium ${debt.value > 0 ? 'text-amber-200' : 'text-slate-600'}`}>
                    {formatCurrency(debt.value)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-5 border-sky-500/10 bg-slate-900/70 p-6">
        <p className="text-sm uppercase tracking-[0.2em] text-sky-300">Start here</p>
        <p className="mt-3 text-lg font-medium text-slate-100">
          {kpis.reviewCount > 0
            ? `${kpis.reviewCount} transactions still need a category review. Approve the AI proposals first; your spending picture becomes clearer as you review.`
            : kpis.netCashFlow >= 0
              ? `You brought in ${formatCurrency(kpis.income)} and spent ${formatCurrency(kpis.expenses)}. You kept ${formatCurrency(kpis.netCashFlow)} after spending.`
              : `You spent ${formatCurrency(Math.abs(kpis.netCashFlow))} more than came in. Start with the largest spending areas below and choose one practical cut.`}
        </p>
        <p className="mt-2 text-sm text-slate-400">Income is money in. Expenses are money out. Net cash flow is what remains for savings, debt payoff, and goals.</p>
      </Card>

      <div className="mt-5">
        <Card className="border-amber-500/10 bg-slate-900/70 p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-amber-400" />
              <p className="text-sm uppercase tracking-[0.2em] text-amber-300">Real outstanding debt</p>
            </div>
            {dashboardData.debtSummary.hasBalanceData ? (
              <p className="text-2xl font-semibold text-amber-200">{formatCurrency(dashboardData.debtSummary.totalOutstanding)}</p>
            ) : null}
          </div>

          {!dashboardData.debtSummary.hasBalanceData ? (
            <p className="mt-4 text-sm leading-6 text-slate-400">
              None of your imported files include a running balance column, so LedgerPilot can't compute what you actually
              still owe — only payment amounts (shown above) are available. Files with a "Balance" column (most credit card
              and line of credit statements) will unlock this automatically on your next import.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-slate-500">
                Sum of the latest statement balance across every credit card and line of credit account — what you actually
                owe today, not just what you paid this period.
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {dashboardData.debtSummary.accounts.map((account) => (
                  <div key={account.accountName} className="rounded-2xl bg-slate-950/70 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-medium text-slate-200">{account.accountName}</p>
                      <Badge tone={account.accountType === 'credit_card' ? 'info' : 'warning'}>
                        {account.accountType === 'credit_card' ? 'Credit card' : 'Line of credit'}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xl font-semibold text-amber-200">{formatCurrency(account.outstandingBalance)}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      as of {account.asOfDate ? new Date(account.asOfDate).toLocaleDateString() : 'unknown'}
                    </p>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                      <span>Interest paid: <span className="text-rose-300">{formatCurrency(account.interestPortion)}</span></span>
                      <span>Toward balance: <span className="text-emerald-300">{formatCurrency(account.principalPortion)}</span></span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card className="bg-slate-900/70 p-7">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <TrendUpIcon />
              <p className="text-sm uppercase tracking-[0.2em] text-violet-300">Cash in &amp; cash out</p>
            </div>
            <div className="flex rounded-lg bg-slate-950/70 p-1 text-xs">
              {(['monthly', 'yearly'] as const).map((range) => (
                <button
                  key={range}
                  onClick={() => setTrendRange(range)}
                  className={`rounded-md px-3 py-1.5 font-medium capitalize transition-colors ${
                    trendRange === range ? 'bg-slate-800 text-slate-100' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-5">
            <TrendChart data={trendData} formatCurrency={formatCurrency} />
          </div>
        </Card>

        <Card className="bg-slate-900/70 p-7">
          <p className="text-sm uppercase tracking-[0.2em] text-sky-300">Largest spending areas</p>
          {dashboardData.topExpenseCategories.length === 0 ? <p className="mt-5 text-sm text-slate-500">Review categories to see where your money is going.</p> : (
            <ol className="mt-5 space-y-3">
              {dashboardData.topExpenseCategories.slice(0, 4).map((entry, index) => (
                <li key={entry.category} className="flex items-center justify-between rounded-xl bg-slate-950/70 px-3.5 py-3 text-sm">
                  <span className="text-slate-300">{index + 1}. {entry.category.replaceAll('_', ' ')}</span>
                  <span className="font-medium text-slate-100">{formatCurrency(entry.total)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card className="bg-slate-900/70 p-7">
          <p className="text-sm uppercase tracking-[0.2em] text-amber-300">Month-over-month</p>
          {dashboardData.categoryComparisons.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No data yet — import transactions first.</p>
          ) : (
            <table className="mt-4 w-full text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="pb-2 text-left font-medium">Category</th>
                  <th className="pb-2 text-right font-medium">This month</th>
                  <th className="pb-2 text-right font-medium">Last month</th>
                  <th className="pb-2 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {dashboardData.categoryComparisons.map((entry) => (
                  <tr key={entry.category}>
                    <td className="py-2 capitalize text-slate-300">{entry.category.replaceAll('_', ' ')}</td>
                    <td className="py-2 text-right text-slate-100">{formatCurrency(entry.currentMonth)}</td>
                    <td className="py-2 text-right text-slate-500">{formatCurrency(entry.previousMonth)}</td>
                    <td className={`py-2 text-right ${entry.changeAmount > 0 ? 'text-rose-300' : entry.changeAmount < 0 ? 'text-emerald-300' : 'text-slate-500'}`}>
                      {entry.changeAmount > 0 ? '+' : ''}
                      {formatCurrency(entry.changeAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="bg-slate-900/70 p-7">
          <p className="text-sm uppercase tracking-[0.2em] text-emerald-300">Expenses by group</p>
          <div className="mt-4 space-y-4">
            {dashboardData.expenseGroups.length === 0 ? (
              <p className="text-sm text-slate-500">No expense data yet.</p>
            ) : (
              dashboardData.expenseGroups.slice(0, 5).map((group) => {
                const topGroupTotal = dashboardData.expenseGroups[0]?.total || 1;
                return (
                  <div key={group.group}>
                    <div className="flex items-center justify-between text-sm font-medium text-slate-100">
                      <span>{group.group}</span>
                      <span>{formatCurrency(group.total)}</span>
                    </div>
                    <Meter className="mt-2" value={(group.total / topGroupTotal) * 100} />
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card className="bg-slate-900/70 p-7">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-indigo-400" />
            <p className="text-sm uppercase tracking-[0.2em] text-indigo-300">Spending snapshot</p>
          </div>
          {dashboardData.topExpenseCategories.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">Import transactions, then review Uncategorized items to see a useful spending summary.</p>
          ) : (
            <div className="mt-4 space-y-3">
              <p className="text-sm leading-6 text-slate-300">Your biggest reviewed spending area is <span className="font-medium text-slate-100">{dashboardData.topExpenseCategories[0].category.replaceAll('_', ' ')}</span> at {formatCurrency(dashboardData.topExpenseCategories[0].total)}.</p>
              <p className="text-xs leading-5 text-slate-500">Use Categorize to name Uncategorized transactions; this keeps the summary focused on choices you have reviewed.</p>
            </div>
          )}
        </Card>

        <Card className="bg-slate-900/70 p-7">
          <div className="flex items-center gap-2">
            <PiggyBank className="h-4 w-4 text-sky-400" />
            <p className="text-sm uppercase tracking-[0.2em] text-sky-300">Account → category flow</p>
          </div>
          <ul className="mt-4 space-y-2.5">
            {dashboardData.sankeyFlows.length === 0 ? (
              <li className="text-sm text-slate-500">No flow data yet.</li>
            ) : (
              dashboardData.sankeyFlows.slice(0, 8).map((flow) => (
                <li key={`${flow.source}-${flow.target}`} className="flex items-center justify-between gap-3 rounded-xl bg-slate-950/70 px-3.5 py-2.5 text-sm">
                  <span className="min-w-0 truncate text-slate-400">{flow.source}</span>
                  <span className="shrink-0 text-slate-600">→</span>
                  <span className="min-w-0 flex-1 truncate font-medium capitalize text-slate-100">{flow.target.replaceAll('_', ' ')}</span>
                  <span className="shrink-0 text-sky-300">{formatCurrency(flow.value)}</span>
                </li>
              ))
            )}
          </ul>
        </Card>
      </div>
    </div>
  );
};

const TrendUpIcon = () => <TrendingUp className="h-4 w-4 text-violet-400" />;
