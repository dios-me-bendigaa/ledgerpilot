import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { EmptyState } from '@ledgerpilot/ui';

type TrendPoint = { label: string; income: number; expenses: number; netCashFlow: number };

type TrendChartProps = {
  data: TrendPoint[];
  formatCurrency: (value: number) => string;
  emptyMessage?: string;
};

const ChartTooltip = ({
  active,
  payload,
  label,
  formatCurrency
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
  formatCurrency: (value: number) => string;
}) => {
  if (!active || !payload || payload.length === 0) return null;

  const names: Record<string, string> = { income: 'Income', expenses: 'Expenses', netCashFlow: 'Net cash flow' };

  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/95 px-3.5 py-2.5 text-xs shadow-2xl backdrop-blur">
      <p className="mb-1.5 font-medium text-slate-300">{label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
            {names[entry.dataKey] ?? entry.dataKey}
          </span>
          <span className="font-medium text-slate-100">{formatCurrency(entry.value)}</span>
        </div>
      ))}
    </div>
  );
};

// Replaces two previous hand-rolled visualizations (an SVG polyline "sparkline" and a separate
// inline-IIFE SVG bar chart) with one real, interactive, responsive chart component shared by both
// the monthly and yearly trend views.
export const TrendChart = ({ data, formatCurrency, emptyMessage }: TrendChartProps) => {
  if (data.length === 0) {
    return (
      <EmptyState
        className="h-64"
        title="No trend data yet"
        description={emptyMessage ?? 'Import and normalize a CSV to see income vs. expenses over time.'}
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280} debounce={150}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
        <YAxis
          stroke="#64748b"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={64}
          tickFormatter={(value: number) => formatCurrency(value)}
        />
        <Tooltip content={<ChartTooltip formatCurrency={formatCurrency} />} cursor={{ fill: 'rgba(148,163,184,0.06)' }} />
        <Bar dataKey="income" fill="#34d399" radius={[4, 4, 0, 0]} maxBarSize={20} fillOpacity={0.85} />
        <Bar dataKey="expenses" fill="#fb7185" radius={[4, 4, 0, 0]} maxBarSize={20} fillOpacity={0.85} />
        <Line type="monotone" dataKey="netCashFlow" stroke="#38bdf8" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
};
