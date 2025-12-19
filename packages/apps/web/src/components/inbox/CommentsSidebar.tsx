import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export type InboxPostItem = {
  postId: string;
  caption: string | null;
  previewUrl: string | null;
  postedAt: string | null;
  newCount: number;
};

export function CommentsSidebar({
  items,
  selectedPostId,
  onSelect,
}: {
  items: InboxPostItem[];
  selectedPostId: string | null;
  onSelect: (postId: string) => void;
}) {
  if (!items.length) {
    return <div className="text-muted-foreground text-sm">No unread comment activity.</div>;
  }
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <Button
          key={item.postId}
          onClick={() => onSelect(item.postId)}
          type="button"
          variant="ghost"
          className={`hover:bg-accent flex w-full items-center gap-3 rounded-md border p-2 text-left transition-colors ${
            item.postId === selectedPostId ? 'border-primary' : 'border-border'
          }`}
        >
          {item.previewUrl ? (
            <img
              src={item.previewUrl}
              alt=""
              className="h-12 w-12 rounded object-cover"
              loading="lazy"
            />
          ) : (
            <div className="bg-muted h-12 w-12 rounded" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-foreground line-clamp-2 text-sm">{item.caption || '—'}</div>
            <div className="text-muted-foreground mt-1 text-xs">
              {item.postedAt ? new Date(item.postedAt).toLocaleString() : ''}
            </div>
          </div>
          <Badge>{item.newCount} new</Badge>
        </Button>
      ))}
    </div>
  );
}
