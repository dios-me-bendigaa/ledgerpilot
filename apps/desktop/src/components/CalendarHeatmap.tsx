import { EmptyState } from '@ledgerpilot/ui';

type CalendarHeatmapProps = {
  points: Array<{ date: string; expenseTotal: number }>;
  formatCurrency: (value: number) => string;
};

const WEEKDAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

// The dashboard has computed a 90-day spending calendar since Phase 4 of the original build, but
// no UI ever rendered `dashboardData.spendingCalendar` — it only ever appeared in the empty-state
// default object. This is a real, working GitHub-contribution-style heatmap over that same data.
export const CalendarHeatmap = ({ points, formatCurrency }: CalendarHeatmapProps) => {
  if (points.length === 0) {
    return <EmptyState className="h-40" title="No spending calendar yet" description="Appears after your first 90 days of imported activity." />;
  }

  const byDate = new Map(points.map((point) => [point.date, point.expenseTotal]));
  const max = Math.max(...points.map((point) => point.expenseTotal), 1);

  const parsedDates = points.map((point) => new Date(`${point.date}T00:00:00`));
  const startBound = new Date(Math.min(...parsedDates.map((d) => d.getTime())));
  const endBound = new Date(Math.max(...parsedDates.map((d) => d.getTime())));

  const alignedStart = new Date(startBound);
  alignedStart.setDate(startBound.getDate() - startBound.getDay());

  const weeks: Date[][] = [];
  const cursor = new Date(alignedStart);
  while (cursor <= endBound) {
    const week: Date[] = [];
    for (let day = 0; day < 7; day += 1) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  const intensityClass = (value: number) => {
    if (value <= 0) return 'bg-slate-900';
    const ratio = value / max;
    if (ratio < 0.15) return 'bg-indigo-950';
    if (ratio < 0.35) return 'bg-indigo-800/70';
    if (ratio < 0.6) return 'bg-indigo-600/80';
    if (ratio < 0.85) return 'bg-indigo-500';
    return 'bg-indigo-400';
  };

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        <div className="mr-1 flex flex-col gap-1 pt-[18px]">
          {WEEKDAY_LABELS.map((label, index) => (
            <span key={index} className="h-3 text-[9px] leading-3 text-slate-600">
              {label}
            </span>
          ))}
        </div>
        {weeks.map((week, weekIndex) => {
          const firstDay = week[0];
          const showMonthLabel = weekIndex === 0 || (firstDay !== undefined && firstDay.getDate() <= 7);
          return (
            <div key={weekIndex} className="flex flex-col gap-1">
              <span className="block h-[14px] text-[9px] leading-[14px] text-slate-600">
                {showMonthLabel && firstDay ? firstDay.toLocaleDateString('en-US', { month: 'short' }) : ''}
              </span>
              {week.map((day, dayIndex) => {
                const iso = day.toISOString().slice(0, 10);
                const value = byDate.get(iso) ?? 0;
                const isFuture = day.getTime() > Date.now();
                return (
                  <div
                    key={dayIndex}
                    title={isFuture ? undefined : `${iso}: ${formatCurrency(value)} spent`}
                    className={`h-3 w-3 rounded-[3px] transition-transform hover:scale-125 ${isFuture ? 'bg-transparent' : intensityClass(value)}`}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-500">
        <span>Less</span>
        {['bg-slate-900', 'bg-indigo-950', 'bg-indigo-800/70', 'bg-indigo-600/80', 'bg-indigo-400'].map((cls) => (
          <span key={cls} className={`h-3 w-3 rounded-[3px] ${cls}`} />
        ))}
        <span>More spending</span>
      </div>
    </div>
  );
};
