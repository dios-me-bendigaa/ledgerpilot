type MeterProps = {
  className?: string;
  value: number;
  /** Optional semantic tone override; defaults to a neutral brand color. */
  tone?: 'brand' | 'success' | 'warning' | 'danger';
};

const toneClasses: Record<NonNullable<MeterProps['tone']>, string> = {
  brand: 'bg-sky-400',
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  danger: 'bg-rose-400'
};

export const Meter = ({ className = '', value, tone = 'brand' }: MeterProps) => {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className={['h-2 rounded-full bg-slate-800', className].join(' ')}>
      <div
        className={`h-2 rounded-full transition-all duration-500 ease-out ${toneClasses[tone]}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
};
