import { useEffect, useRef } from 'react';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Loader2 } from 'lucide-react';

export function NotificationsDropdown() {
  const { items, loading, fetchLatest, markRead, markAllRead, setOpen } = useNotificationsStore();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [setOpen]);

  return (
    <div
      ref={ref}
      className="bg-popover text-popover-foreground absolute right-0 z-50 mt-2 w-[380px] rounded-md border shadow-md"
    >
      <div className="flex items-center justify-between p-2">
        <div className="text-sm font-medium">Notifications</div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => fetchLatest()}>
            Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={() => markAllRead()}>
            Mark all as read
          </Button>
        </div>
      </div>
      <Separator />
      <div className="max-h-[420px] overflow-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center text-sm">
            You're all caught up.
          </div>
        ) : (
          <ul className="space-y-1">
            {items.map((n) => (
              <li
                key={n.id}
                className={`hover:bg-accent rounded-md p-2 ${!n.readAt ? 'bg-accent/40' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{n.title}</div>
                    {n.body && <div className="text-muted-foreground mt-0.5 text-xs">{n.body}</div>}
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </div>
                  {!n.readAt && (
                    <Button size="sm" variant="secondary" onClick={() => markRead(n.id)}>
                      Mark read
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Separator />
      <div className="p-2 text-right">
        <a href="/notifications" className="text-primary text-sm hover:underline">
          View all
        </a>
      </div>
    </div>
  );
}
