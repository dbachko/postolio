import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function BrandHealthScoreSkeleton() {
  return (
    <Card className="relative overflow-hidden border-none bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-blue-950/50 dark:via-indigo-950/50 dark:to-purple-950/50">
      <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-gradient-to-br from-blue-400/20 to-purple-400/20 blur-3xl" />
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span>Brand Health Score</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
          <div className="flex justify-center">
            <Skeleton className="h-48 w-48 rounded-full" />
          </div>
          <div className="flex-1 space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-20 w-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
