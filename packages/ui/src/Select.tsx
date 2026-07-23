import type { PropsWithChildren, SelectHTMLAttributes } from 'react';

type SelectProps = PropsWithChildren<Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'>> & {
  label?: string;
  /** Visual density — deliberately not named `size` to avoid colliding with the native HTML
   * `<select size>` attribute (number of visible rows), which produced a `never` type when
   * intersected with a string-literal `size` prop of the same name. */
  compact?: boolean;
};

export const Select = ({ label, compact = false, className = '', children, ...selectProps }: SelectProps) => {
  const field = (
    <select
      className={[
        'w-full appearance-none rounded-xl border border-white/5 bg-slate-950/80 text-slate-100 outline-none',
        'transition-colors duration-150 focus:border-sky-400/50 focus:ring-2 focus:ring-sky-400/20',
        // Custom chevron so it matches Input's chrome (native select arrows vary wildly by platform).
        "bg-[url('data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%2394a3b8%22%3E%3Cpath%20d%3D%22M5.25%207.5L10%2012.25%2014.75%207.5H5.25Z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1rem] bg-[right_0.75rem_center] bg-no-repeat pr-9",
        compact ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2.5 text-sm',
        className
      ].join(' ')}
      {...selectProps}
    >
      {children}
    </select>
  );

  if (!label) return field;

  return (
    <label className="block text-sm text-slate-300">
      <span className="mb-1.5 block font-medium text-slate-300">{label}</span>
      {field}
    </label>
  );
};
