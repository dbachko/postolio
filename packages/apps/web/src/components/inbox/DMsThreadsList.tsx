import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';

export type DmThread = { id: string; updated_time?: string; participants?: any[] };

export function DMsThreadsList({
  threads,
  selectedThreadId,
  onSelect,
  onLoadMore,
  afterCursor,
}: {
  threads: DmThread[];
  selectedThreadId: string | null;
  onSelect: (threadId: string) => void;
  onLoadMore?: () => void;
  afterCursor?: string | null;
}) {
  return (
    <div className="space-y-2">
      {threads.map((t) => {
        const first = (t.participants || [])[0] || {};
        const avatarUrl =
          first.profile_pic ||
          first.profile_picture_url ||
          first.profilePic ||
          first.picture?.data?.url ||
          null;
        const displayName =
          (t.participants || [])
            .map((p: any) => p?.name || p?.username || p?.id)
            .filter(Boolean)
            .slice(0, 3)
            .join(', ') || 'Conversation';
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className={`hover:bg-accent w-full rounded-md border p-2 text-left ${
              t.id === selectedThreadId ? 'border-primary' : 'border-border'
            }`}
          >
            <div className="flex items-center gap-3">
              <Avatar src={avatarUrl} name={displayName} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-1 text-sm">{displayName}</div>
                <div className="text-muted-foreground mt-1 text-xs">
                  {t.updated_time ? new Date(t.updated_time).toLocaleString() : ''}
                </div>
              </div>
            </div>
          </button>
        );
      })}
      {afterCursor && onLoadMore && (
        <Button variant="outline" onClick={onLoadMore}>
          Load more threads
        </Button>
      )}
      {!threads.length && <div className="text-muted-foreground text-sm">No threads found.</div>}
    </div>
  );
}
