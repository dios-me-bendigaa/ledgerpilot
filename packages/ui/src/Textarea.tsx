import type { TextareaHTMLAttributes } from 'react';

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
};

export const Textarea = ({ label, className = '', ...textareaProps }: TextareaProps) => {
  const field = (
    <textarea
      className={[
        'w-full rounded-2xl border border-white/5 bg-slate-950/80 px-4 py-3 text-sm text-slate-100',
        'outline-none placeholder:text-slate-500 transition-colors duration-150',
        'focus:border-sky-400/50 focus:ring-2 focus:ring-sky-400/20',
        className
      ].join(' ')}
      {...textareaProps}
    />
  );

  if (!label) return field;

  return (
    <label className="block text-sm text-slate-300">
      <span className="mb-1.5 block font-medium text-slate-300">{label}</span>
      {field}
    </label>
  );
};
