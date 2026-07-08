import type { PropsWithChildren } from 'react';

type CardProps = PropsWithChildren<{ className?: string }>;

export const Card = ({ children, className = '' }: CardProps) => {
  return (
    <section
      className={`rounded-3xl border border-white/10 shadow-2xl shadow-slate-950/20 ${className}`.trim()}
    >
      {children}
    </section>
  );
};
