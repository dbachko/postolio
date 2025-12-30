import { Skeleton } from '@/components/ui/skeleton';

export function LoadingGrid() {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: 10 }).map((_, idx) => (
        <div key={idx} className="space-y-2">
          <Skeleton className="aspect-square rounded-lg" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}
