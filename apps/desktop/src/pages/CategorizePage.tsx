import { Sparkles } from 'lucide-react';

import { Badge, Button, Card, EmptyState, Input, Select } from '@ledgerpilot/ui';

import { PageHeader } from '../components/PageHeader';
import { useWorkspace } from '../context/WorkspaceContext';
import { formatCurrencyWithCode } from '../lib/format';
import type { ReviewTransaction } from '@ledgerpilot/core';

export const CategorizePage = () => {
  const {
    reviewTransactions,
    categorySuggestions,
    setCategorySuggestions,
    isWorking,
    handleSuggestCategories,
    handleAcceptAllSuggestions,
    handleApplySuggestion,
    customCategories,
    newCategoryName,
    setNewCategoryName,
    newCategoryBucket,
    setNewCategoryBucket,
    newCategoryNetting,
    setNewCategoryNetting,
    handleAddCategory,
    normalizationHistory,
    settings
  } = useWorkspace();
  const formatCurrency = (value: number) => formatCurrencyWithCode(value, settings.homeCurrency || 'CAD');

  const acceptableCount = categorySuggestions.suggestions.filter((s) => s.suggestedCategory !== 'unknown').length;

  return (
    <div>
      <PageHeader
        eyebrow="Categorize"
        title="Review &amp; teach the AI"
        description="Ambiguous transactions land here. Correcting one applies to every transaction from the same merchant, now and in future imports."
        actions={
          <>
            <Button variant="secondary" disabled={isWorking || reviewTransactions.length === 0} onClick={() => void handleSuggestCategories()} icon={<Sparkles />}>
              Suggest categories
            </Button>
            {acceptableCount > 0 ? (
              <Button variant="success" disabled={isWorking} onClick={() => void handleAcceptAllSuggestions()}>
                Accept all ({acceptableCount})
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card className="bg-slate-900/70 p-7">
          <div className="flex items-center justify-between">
            <p className="text-sm uppercase tracking-[0.2em] text-violet-300">Review queue</p>
            <Badge tone={reviewTransactions.length > 0 ? 'warning' : 'success'}>{reviewTransactions.length} pending</Badge>
          </div>

          <div className="mt-5 rounded-2xl bg-slate-950/60 p-4">
            <p className="text-xs uppercase tracking-[0.15em] text-slate-500">Add custom category</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input
                className="min-w-0 flex-1"
                placeholder="e.g. daycare, pet care, side hustle"
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleAddCategory();
                }}
              />
              <Select compact className="w-36" value={newCategoryBucket} onChange={(event) => setNewCategoryBucket(event.target.value as 'income' | 'expense' | 'transfer')}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                <option value="transfer">Transfer (ignore)</option>
              </Select>
              <label
                className="flex items-center gap-1.5 text-[11px] text-slate-400"
                title="Positive amounts in this category will be netted against negative amounts (e.g. remittances that get partly reimbursed) instead of counting as separate income."
              >
                <input type="checkbox" checked={newCategoryNetting} onChange={(event) => setNewCategoryNetting(event.target.checked)} />
                Net reimbursements
              </label>
              <Button size="sm" variant="primary" disabled={isWorking || !newCategoryName.trim()} onClick={() => void handleAddCategory()}>
                Add
              </Button>
            </div>
            {customCategories.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {customCategories.map((category) => (
                  <Badge key={category.name} tone="neutral">
                    {category.name.replaceAll('_', ' ')} · {category.bucket}
                    {category.nettingEnabled ? ' · nets' : ''}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>

          <div className="mt-5 space-y-3">
            {reviewTransactions.length === 0 ? (
              <EmptyState title="Nothing to review" description="Low-confidence transactions will show up here after an import." />
            ) : (
              reviewTransactions.map((transaction) => (
                <ReviewRow
                  key={transaction.id}
                  transaction={transaction}
                  formatCurrency={formatCurrency}
                  isWorking={isWorking}
                />
              ))
            )}
          </div>
        </Card>

        <Card className="bg-slate-900/70 p-7">
          <p className="text-sm uppercase tracking-[0.2em] text-amber-300">Normalization reports</p>
          <div className="mt-5 space-y-3">
            {normalizationHistory.reports.length === 0 ? (
              <EmptyState title="No reports yet" description="Reports appear after imports are normalized." />
            ) : (
              normalizationHistory.reports.map((report) => (
                <div key={report.id} className="rounded-2xl bg-slate-950/70 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-slate-100">{report.summary.insertedTransactions} normalized transactions</p>
                      <p className="mt-1 text-xs text-slate-500">{new Date(report.createdAt).toLocaleString()}</p>
                    </div>
                    <Badge tone="neutral">{report.summary.duplicateTransactions} duplicates</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <Stat label="Accounts" value={report.summary.accounts.length.toString()} />
                    <Stat label="Low confidence" value={report.summary.lowConfidenceTransactions.toString()} />
                    <Stat label="Transfers" value={report.summary.internalTransfers.toString()} />
                    <Stat
                      label="Flagged rows"
                      value={(report.summary.malformedRowCount ?? 0).toString()}
                      tone={(report.summary.malformedRowCount ?? 0) > 0 ? 'text-amber-300' : undefined}
                    />
                  </div>
                  {report.summary.malformedRowSamples && report.summary.malformedRowSamples.length > 0 ? (
                    <div className="mt-3 rounded-xl bg-amber-500/5 p-3">
                      <p className="text-[11px] font-medium text-amber-300">
                        {report.summary.malformedRowCount} row(s) had formatting issues — recovered where possible, flagged for review.
                      </p>
                      <ul className="mt-1.5 space-y-1">
                        {report.summary.malformedRowSamples.slice(0, 3).map((sample, index) => (
                          <li key={index} className="truncate text-[10px] text-slate-500">
                            {sample}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};

const Stat = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
  <div className="rounded-xl bg-slate-900/70 p-2.5">
    <p className="text-slate-500">{label}</p>
    <p className={`mt-1 font-medium ${tone ?? 'text-slate-100'}`}>{value}</p>
  </div>
);

const ReviewRow = ({
  transaction,
  formatCurrency,
  isWorking
}: {
  transaction: ReviewTransaction;
  formatCurrency: (value: number) => string;
  isWorking: boolean;
}) => {
  const { categorySuggestions, setCategorySuggestions, categoryOptions, handleApplySuggestion } = useWorkspace();
  const suggestion = categorySuggestions.suggestions.find((entry) => entry.transactionId === transaction.id);

  return (
    <div className="rounded-2xl bg-slate-950/70 p-4 text-sm transition-colors hover:bg-slate-950/90">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-slate-100">{transaction.descriptionRaw}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {transaction.accountName} · {formatCurrency(transaction.amount)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Select
            compact
            className="w-36"
            value={suggestion?.suggestedCategory ?? transaction.currentCategory}
            onChange={(event) => {
              const category = event.target.value as ReviewTransaction['currentCategory'];
              const existing = categorySuggestions.suggestions.filter((entry) => entry.transactionId !== transaction.id);
              setCategorySuggestions({
                suggestions: [...existing, { transactionId: transaction.id, suggestedCategory: category, confidenceScore: 1, rationale: 'Manually selected.' }]
              });
            }}
          >
            {categoryOptions.map((category) => (
              <option key={category} value={category}>
                {category.replaceAll('_', ' ')}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="secondary"
            disabled={isWorking}
            onClick={() => void handleApplySuggestion(transaction.id, suggestion?.suggestedCategory ?? transaction.currentCategory)}
          >
            Apply
          </Button>
        </div>
      </div>
      {suggestion && suggestion.suggestedCategory !== 'unknown' ? <p className="mt-2 text-xs text-sky-400">{suggestion.rationale}</p> : null}
    </div>
  );
};
