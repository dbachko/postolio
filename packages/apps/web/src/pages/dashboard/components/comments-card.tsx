import { Link } from 'react-router-dom';
import { formatInUserTimezone } from '@/lib/timezone';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { CommentsInboxItem } from '../types';

type CommentsCardProps = {
  isLoading: boolean;
  items: CommentsInboxItem[];
  brandTimezone?: string;
};

export function CommentsCard({ isLoading, items, brandTimezone }: CommentsCardProps) {
  return (
    <Card className="lg:col-span-1">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Comments</CardTitle>
          <p className="text-muted-foreground text-sm">Reply to new activity quickly.</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/inbox">Open</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3 w-5/6" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-5 w-10 rounded-full" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground text-sm">No recent comment activity.</p>
        ) : (
          <div className="space-y-2">
            {items.slice(0, 5).map((item) => (
              <div
                key={item.postId}
                className="flex items-start justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    <span className="line-clamp-2">
                      {item.caption?.trim() ? item.caption.trim() : 'Post'}
                    </span>
                  </div>
                  {item.postedAt ? (
                    <div className="text-muted-foreground mt-1 text-xs">
                      Posted {formatInUserTimezone(item.postedAt, 'MMM d', brandTimezone)}
                    </div>
                  ) : null}
                  {item.permalink ? (
                    <a
                      className="text-muted-foreground hover:text-foreground mt-1 inline-flex items-center gap-1 text-xs underline"
                      href={item.permalink}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View on Instagram <span aria-hidden="true">↗</span>
                    </a>
                  ) : null}
                </div>
                <Badge variant={item.newCount > 0 ? 'info' : 'secondary'}>{item.newCount}</Badge>
              </div>
            ))}

            {items.length > 5 ? (
              <p className="text-muted-foreground text-xs">
                And {items.length - 5} more post{items.length - 5 === 1 ? '' : 's'}.
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
