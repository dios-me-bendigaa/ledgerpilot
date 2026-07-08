import type { PropsWithChildren } from 'react';

type CardProps = PropsWithChildren<{ className?: string }>;
type ButtonProps = PropsWithChildren<{
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
}>;
type MeterProps = {
  className?: string;
  value: number;
};

export const Card = ({ children, className = '' }: CardProps) => {
  return (
    <section
      className={`rounded-3xl border border-white/10 shadow-2xl shadow-slate-950/20 ${className}`.trim()}
    >
      {children}
    </section>
  );
};

export const Button = ({
  children,
  className = '',
  disabled = false,
  onClick,
  type = 'button'
}: ButtonProps) => {
  return (
    <button
      className={[
        'inline-flex items-center justify-center rounded-2xl px-4 py-3 text-sm font-medium transition',
        disabled
          ? 'cursor-not-allowed bg-slate-800 text-slate-500'
          : 'bg-sky-400 text-slate-950 hover:bg-sky-300',
        className
      ].join(' ')}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
};

export const Meter = ({ className = '', value }: MeterProps) => {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className={["h-2 rounded-full bg-slate-800", className].join(' ')}>
      <div
        className="h-2 rounded-full bg-sky-400 transition-all"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
};
