import { useEffect } from 'react';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useState } from 'react';

export default function NotificationsPage() {
  const { items, fetchLatest, markRead, markAllRead, fetchMore, nextCursor } =
    useNotificationsStore();
  const [view, setView] = useState<'all' | 'unread'>('all');

  useEffect(() => {
    void fetchLatest();
  }, [fetchLatest]);

  const filtered = view === 'unread' ? items.filter((n) => !n.readAt) : items;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as 'all' | 'unread')}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="unread">Unread</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" onClick={() => fetchLatest()}>
            Refresh
          </Button>
          <Button onClick={() => markAllRead()}>Mark all as read</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="text-muted-foreground py-10 text-center text-sm">No notifications</div>
          ) : (
            <div className="pt-6 pb-6">
              <ul className="divide-border divide-y">
                {filtered.map((n) => (
                  <li key={n.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">{n.title}</div>
                        {n.body && (
                          <div className="text-muted-foreground mt-0.5 text-sm">{n.body}</div>
                        )}
                        <div className="text-muted-foreground mt-1 text-xs">
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
              {nextCursor && (
                <div className="flex justify-center border-t px-4 py-3">
                  <Button variant="ghost" size="sm" onClick={() => fetchMore()}>
                    Load more
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
