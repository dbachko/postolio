import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { X, RefreshCcw, Bell as BellIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';

export function NotificationsSidebar() {
  const { close } = useRightSidebarRouter();
  const { items, loading, fetchLatest, markRead, markAllRead } = useNotificationsStore();

  useEffect(() => {
    // Ensure we have fresh data when the sidebar opens
    void fetchLatest();
  }, [fetchLatest]);

  const unreadItems = items.filter((n) => !n.readAt);

  return (
    <div className="flex h-full flex-col">
      <div className="bg-card sticky top-0 z-30 flex h-14 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <Breadcrumb aria-label="right-sidebar-title">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/notifications">Notifications</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => fetchLatest()} aria-label="Refresh">
            <RefreshCcw className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => markAllRead()}>
            Mark all read
          </Button>
          <Button variant="ghost" size="icon" onClick={close} aria-label="Close sidebar">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <Separator />
      <ScrollArea className="flex-1 px-4 py-4">
        {loading ? (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            Loading...
          </div>
        ) : unreadItems.length === 0 ? (
          <div className="flex h-full min-h-full items-center justify-center">
            <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
              <span className="text-muted-foreground/70">
                <BellIcon className="h-8 w-8" />
              </span>
              <div>
                <p className="text-foreground text-base font-semibold">Nothing to see here</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  You’re all caught up. New notifications will appear here.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => fetchLatest()}>
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  Refresh
                </Button>
                <Button asChild size="sm" variant="secondary">
                  <Link to="/notifications">Open all</Link>
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <ul className="space-y-1">
            {unreadItems.map((n) => (
              <li key={n.id} className="hover:bg-accent bg-accent/40 rounded-md p-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{n.title}</div>
                    {n.body && <div className="text-muted-foreground mt-0.5 text-xs">{n.body}</div>}
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => markRead(n.id)}>
                    Mark read
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
