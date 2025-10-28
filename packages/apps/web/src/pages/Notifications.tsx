import { useEffect } from 'react';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function NotificationsPage() {
  const { items, fetchLatest, markRead, markAllRead } = useNotificationsStore();

  useEffect(() => {
    void fetchLatest();
  }, [fetchLatest]);

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Notifications</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => fetchLatest()}>
            Refresh
          </Button>
          <Button onClick={() => markAllRead()}>Mark all as read</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Notifications</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center text-sm">No notifications</div>
          ) : (
            <ul className="space-y-2">
              {items.map((n) => (
                <li key={n.id} className="rounded-md border p-3">
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
