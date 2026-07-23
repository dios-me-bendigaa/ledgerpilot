import type { ReactNode } from 'react';

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export const EmptyState = ({ icon, title, description, action, className = '' }: EmptyStateProps) => (
  <div className={`flex flex-col items-center justify-center rounded-2xl bg-slate-950/60 px-6 py-10 text-center ${className}`}>
    {icon ? (
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-slate-500 [&>svg]:h-6 [&>svg]:w-6">
        {icon}
      </div>
    ) : null}
    <p className="text-sm font-medium text-slate-300">{title}</p>
    {description ? <p className="mt-1.5 max-w-xs text-xs leading-5 text-slate-500">{description}</p> : null}
    {action ? <div className="mt-4">{action}</div> : null}
  </div>
);
