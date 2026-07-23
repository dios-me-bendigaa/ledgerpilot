import type { ReactNode } from 'react';

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
};

export const PageHeader = ({ eyebrow, title, description, actions }: PageHeaderProps) => (
  <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-sky-400">{eyebrow}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">{title}</h1>
      {description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{description}</p> : null}
    </div>
    {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div> : null}
  </div>
);
