import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { X, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';

export function NotificationsSidebar() {
  const navigate = useNavigate();
  const { close } = useRightSidebarRouter();
  const { items, loading, fetchLatest, markRead, markAllRead } = useNotificationsStore();

  useEffect(() => {
    // Ensure we have fresh data when the sidebar opens
    void fetchLatest();
  }, [fetchLatest]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <h2 id="right-sidebar-title" className="text-sm font-semibold">
            Notifications
          </h2>
          <Button variant="ghost" size="sm" onClick={() => fetchLatest()} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => markAllRead()}>
            Mark all read
          </Button>
          <Button variant="secondary" size="sm" onClick={() => navigate('/notifications')}>
            Open full page
          </Button>
          <Button variant="ghost" size="icon" onClick={close} aria-label="Close sidebar">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <Separator />
      <ScrollArea className="flex-1 p-2">
        {loading ? (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            Loading...
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
      </ScrollArea>
    </div>
  );
}
