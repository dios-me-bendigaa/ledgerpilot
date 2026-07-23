import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { EmptyState } from '@ledgerpilot/ui';

type CategoryDonutProps = {
  data: Array<{ category: string; total: number }>;
  formatCurrency: (value: number) => string;
};

const COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#22d3ee', '#f472b6', '#94a3b8', '#818cf8', '#4ade80'];

const DonutTooltip = ({
  active,
  payload,
  formatCurrency
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: { fill: string } }>;
  formatCurrency: (value: number) => string;
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  if (!entry) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/95 px-3.5 py-2.5 text-xs shadow-2xl backdrop-blur">
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.payload.fill }} />
        <span className="font-medium capitalize text-slate-200">{entry.name.replaceAll('_', ' ')}</span>
      </div>
      <p className="mt-1 font-semibold text-slate-100">{formatCurrency(entry.value)}</p>
    </div>
  );
};

export const CategoryDonut = ({ data, formatCurrency }: CategoryDonutProps) => {
  if (data.length === 0) {
    return <EmptyState className="h-60" title="No category data yet" description="Spending breakdown appears after your first import." />;
  }

  const top = data.slice(0, 8);
  const total = top.reduce((sum, entry) => sum + entry.total, 0);

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative h-48 w-48 shrink-0">
        <ResponsiveContainer width="100%" height="100%" debounce={150}>
          <PieChart>
            <Pie data={top} dataKey="total" nameKey="category" innerRadius={58} outerRadius={88} paddingAngle={2} strokeWidth={0}>
              {top.map((entry, index) => (
                <Cell key={entry.category} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<DonutTooltip formatCurrency={formatCurrency} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Total</p>
          <p className="text-sm font-semibold text-slate-100">{formatCurrency(total)}</p>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {top.map((entry, index) => (
          <li key={entry.category} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex min-w-0 items-center gap-2 text-slate-300">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
              <span className="truncate capitalize">{entry.category.replaceAll('_', ' ')}</span>
            </span>
            <span className="shrink-0 font-medium text-slate-100">{formatCurrency(entry.total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
