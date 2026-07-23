import type { InputHTMLAttributes, ReactNode } from 'react';

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  icon?: ReactNode;
  containerClassName?: string;
};

// Single source of truth for text-input chrome — previously every <input> in the app hand-typed
// its own Tailwind string, producing four subtly different visual variants of the same control.
export const Input = ({ label, hint, icon, containerClassName = '', className = '', ...inputProps }: InputProps) => {
  const field = (
    <div className="relative">
      {icon ? (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 [&>svg]:h-4 [&>svg]:w-4">
          {icon}
        </span>
      ) : null}
      <input
        className={[
          'w-full rounded-xl border border-white/5 bg-slate-950/80 px-3.5 py-2.5 text-sm text-slate-100',
          'outline-none placeholder:text-slate-500 transition-colors duration-150',
          'focus:border-sky-400/50 focus:ring-2 focus:ring-sky-400/20',
          icon ? 'pl-9' : '',
          className
        ]
          .filter(Boolean)
          .join(' ')}
        {...inputProps}
      />
    </div>
  );

  if (!label && !hint) return field;

  return (
    <label className={`block text-sm text-slate-300 ${containerClassName}`}>
      {label ? <span className="mb-1.5 block font-medium text-slate-300">{label}</span> : null}
      {field}
      {hint ? <span className="mt-1.5 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
};
