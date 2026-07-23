import { useMemo } from 'react';
import { Search } from 'lucide-react';

import { Card, EmptyState, Input, Select } from '@ledgerpilot/ui';

import { PageHeader } from '../components/PageHeader';
import { useWorkspace } from '../context/WorkspaceContext';
import { formatCurrencyWithCode } from '../lib/format';

export const TransactionsPage = () => {
  const { allTransactions, txnFilter, setTxnFilter, categoryOptions, isWorking, handleReassignCategory, settings } = useWorkspace();
  const formatCurrency = (value: number) => formatCurrencyWithCode(value, settings.homeCurrency || 'CAD');

  const filtered = useMemo(() => {
    const q = txnFilter.trim().toLowerCase();
    if (!q) return allTransactions;
    return allTransactions.filter(
      (t) => t.descriptionRaw.toLowerCase().includes(q) || t.currentCategory.toLowerCase().includes(q) || t.accountName.toLowerCase().includes(q),
    );
  }, [allTransactions, txnFilter]);

  return (
    <div>
      <PageHeader
        eyebrow="Transactions"
        title="All transactions"
        description="Every transaction, newest first. Reassigning a category applies to every transaction from the same merchant."
        actions={
          <Input
            icon={<Search />}
            placeholder="Search description, category, account..."
            value={txnFilter}
            onChange={(event) => setTxnFilter(event.target.value)}
            className="w-72"
          />
        }
      />

      <Card className="bg-slate-900/70 p-0">
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <p className="text-sm text-slate-400">
            <span className="font-semibold text-slate-100">{filtered.length}</span> of {allTransactions.length} transactions
          </p>
        </div>

        {filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={allTransactions.length === 0 ? 'No transactions yet' : 'No matches'}
              description={allTransactions.length === 0 ? 'Import a CSV to see your transactions here.' : 'Try a different search term.'}
            />
          </div>
        ) : (
          <div className="max-h-[36rem] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Description</th>
                  <th className="px-6 py-3 font-medium">Account</th>
                  <th className="px-6 py-3 text-right font-medium">Amount</th>
                  <th className="px-6 py-3 font-medium">Category</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filtered.map((transaction) => (
                  <tr key={transaction.id} className="transition-colors hover:bg-white/[0.02]">
                    <td className="whitespace-nowrap px-6 py-3 text-xs text-slate-500">{transaction.postedAt.slice(0, 10)}</td>
                    <td className="max-w-[24rem] truncate px-6 py-3 text-slate-100">{transaction.descriptionRaw}</td>
                    <td className="whitespace-nowrap px-6 py-3 text-xs text-slate-500">{transaction.accountName}</td>
                    <td className={`whitespace-nowrap px-6 py-3 text-right font-medium ${transaction.amount < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                      {formatCurrency(transaction.amount)}
                    </td>
                    <td className="px-6 py-3">
                      <Select
                        compact
                        className="w-40"
                        value={transaction.currentCategory}
                        disabled={isWorking}
                        onChange={(event) => void handleReassignCategory(transaction, event.target.value)}
                      >
                        {categoryOptions.map((category) => (
                          <option key={category} value={category}>
                            {category.replaceAll('_', ' ')}
                          </option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
