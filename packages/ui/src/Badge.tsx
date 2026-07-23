import type { PropsWithChildren } from 'react';

type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

type BadgeProps = PropsWithChildren<{
  className?: string;
  tone?: BadgeTone;
  /** Renders a small leading status dot instead of/alongside an icon. */
  dot?: boolean;
}>;

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'bg-slate-800 text-slate-300',
  brand: 'bg-sky-500/15 text-sky-300',
  success: 'bg-emerald-500/15 text-emerald-300',
  warning: 'bg-amber-500/15 text-amber-300',
  danger: 'bg-rose-500/15 text-rose-300',
  info: 'bg-violet-500/15 text-violet-300'
};

const dotClasses: Record<BadgeTone, string> = {
  neutral: 'bg-slate-400',
  brand: 'bg-sky-400',
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  danger: 'bg-rose-400',
  info: 'bg-violet-400'
};

export const Badge = ({ children, className = '', tone = 'neutral', dot = false }: BadgeProps) => {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        toneClasses[tone],
        className
      ].join(' ')}
    >
      {dot ? <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClasses[tone]}`} /> : null}
      {children}
    </span>
  );
};
