import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export const Skeleton = ({ className, ...props }) => {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-slate-200/60 dark:bg-slate-800", className)}
      {...props}
    />
  );
};

export const KpiSkeleton = () => (
  <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
    <div className="flex items-center justify-between">
      <Skeleton className="h-10 w-10 rounded-xl" />
      <Skeleton className="h-4 w-12 rounded-full" />
    </div>
    <div className="space-y-2">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-32" />
    </div>
    <Skeleton className="h-3 w-40" />
  </div>
);

export const TableSkeleton = ({ rows = 5 }) => (
  <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
    <div className="bg-slate-50 border-b border-slate-200 p-4 flex gap-4">
      <Skeleton className="h-4 w-1/4" />
      <Skeleton className="h-4 w-1/4" />
      <Skeleton className="h-4 w-1/4" />
      <Skeleton className="h-4 w-1/4" />
    </div>
    <div className="p-4 space-y-4">
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="flex gap-4 py-2">
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
      ))}
    </div>
  </div>
);

export const ChartSkeleton = () => (
  <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4 h-[350px] flex flex-col">
    <div className="flex items-center justify-between">
      <Skeleton className="h-6 w-48" />
      <div className="flex gap-2">
        <Skeleton className="h-8 w-20 rounded-lg" />
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>
    </div>
    <Skeleton className="flex-1 w-full rounded-2xl" />
  </div>
);
