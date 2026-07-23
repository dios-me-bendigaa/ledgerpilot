import type { PropsWithChildren } from 'react';

type CardProps = PropsWithChildren<{
  className?: string;
  /** Adds a subtle hover elevation + border glow — for cards that represent a clickable/navigable item. */
  interactive?: boolean;
}>;

export const Card = ({ children, className = '', interactive = false }: CardProps) => {
  return (
    <section
      className={[
        'rounded-3xl border border-white/10 shadow-2xl shadow-slate-950/20 transition-all duration-200',
        interactive ? 'cursor-pointer hover:-translate-y-0.5 hover:border-white/20 hover:shadow-glow' : '',
        className
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </section>
  );
};
