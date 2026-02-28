import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function SkillCardSkeleton({ showToggle = false }: { showToggle?: boolean }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded-sm" />
            <Skeleton className="h-5 w-28" />
          </div>
          <div className="flex items-center gap-1">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        </div>
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-8/12" />
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {showToggle ? <Skeleton className="h-6 w-11 rounded-full" /> : null}
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-9 w-20 rounded-md" />
      </CardContent>
    </Card>
  );
}
