import type { PropsWithChildren, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md';

type ButtonProps = PropsWithChildren<{
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  title?: string;
}>;

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-brand-gradient text-white hover:brightness-110 active:brightness-95 shadow-glow',
  secondary: 'bg-slate-800 text-slate-100 hover:bg-slate-700 active:bg-slate-600',
  ghost: 'bg-transparent text-slate-300 hover:bg-white/5 active:bg-white/10',
  danger: 'bg-rose-600 text-white hover:bg-rose-500 active:bg-rose-700',
  success: 'bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700'
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2.5 text-sm gap-2'
};

export const Button = ({
  children,
  className = '',
  disabled = false,
  onClick,
  type = 'button',
  variant = 'primary',
  size = 'md',
  icon,
  title
}: ButtonProps) => {
  return (
    <button
      className={[
        'inline-flex active:scale-[0.98] items-center justify-center rounded-xl font-medium',
        'transition-all duration-150 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50',
        sizeClasses[size],
        disabled ? 'cursor-not-allowed bg-slate-800/60 text-slate-600 active:scale-100' : variantClasses[variant],
        className
      ].join(' ')}
      disabled={disabled}
      onClick={onClick}
      type={type}
      title={title}
    >
      {icon ? <span className="shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icon}</span> : null}
      {children}
    </button>
  );
};
