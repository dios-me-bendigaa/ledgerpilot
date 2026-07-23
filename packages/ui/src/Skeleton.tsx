type SkeletonProps = {
  className?: string;
};

// Loading placeholder — previously the app had NO loading feedback anywhere beyond a button label
// swap; every other async action gave zero visual signal while in flight.
export const Skeleton = ({ className = '' }: SkeletonProps) => (
  <div className={`animate-pulse rounded-2xl bg-slate-800/60 ${className}`} />
);

export const SkeletonText = ({ lines = 3, className = '' }: { lines?: number; className?: string }) => (
  <div className={`space-y-2 ${className}`}>
    {Array.from({ length: lines }).map((_, index) => (
      <Skeleton key={index} className={`h-3 ${index === lines - 1 ? 'w-2/3' : 'w-full'}`} />
    ))}
  </div>
);
