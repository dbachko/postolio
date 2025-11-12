import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send } from 'lucide-react';

export type DmMessage = { id: string; message?: string; from?: any; created_time?: string };

export function DMsMessagesPanel({
  selectedThreadId,
  messages,
  loading,
  beforeCursor,
  onLoadOlder,
  composer,
  setComposer,
  onSend,
  windowClosed,
}: {
  selectedThreadId: string | null;
  messages: DmMessage[];
  loading: boolean;
  beforeCursor: string | null;
  onLoadOlder: () => void;
  composer: string;
  setComposer: (v: string) => void;
  onSend: () => void;
  windowClosed: boolean;
}) {
  return (
    <div className="md:col-span-2">
      {selectedThreadId ? (
        <div className="flex h-full flex-col">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-medium">Thread {selectedThreadId}</div>
            {beforeCursor && (
              <Button size="sm" variant="outline" onClick={onLoadOlder}>
                Load older
              </Button>
            )}
          </div>
          <div className="bg-muted/20 flex-1 space-y-3 overflow-auto rounded-md border p-3">
            {loading ? (
              <div className="text-muted-foreground text-sm">Loading messages…</div>
            ) : messages.length ? (
              messages.map((m) => (
                <div key={m.id} className="bg-card rounded-md border p-2">
                  <div className="text-muted-foreground mb-1 text-xs">
                    {m.from?.name || m.from?.username || m.from?.id || 'User'} •{' '}
                    {m.created_time ? new Date(m.created_time).toLocaleString() : ''}
                  </div>
                  <div className="whitespace-pre-wrap text-sm">{m.message}</div>
                </div>
              ))
            ) : (
              <div className="text-muted-foreground text-sm">No messages yet.</div>
            )}
          </div>
          <div className="mt-3 flex items-end gap-2">
            <Textarea
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              placeholder={
                windowClosed ? 'Window closed. Reply on Instagram to re-open.' : 'Type a message…'
              }
              className="flex-1"
              disabled={windowClosed}
            />
            <Button onClick={onSend} disabled={!composer.trim() || windowClosed}>
              <Send className="mr-1 h-4 w-4" /> Send
            </Button>
          </div>
          {windowClosed && (
            <div className="text-muted-foreground mt-1 text-xs">
              24-hour messaging window has expired for this thread.
            </div>
          )}
        </div>
      ) : (
        <div className="text-muted-foreground text-sm">Select a thread to view messages.</div>
      )}
    </div>
  );
}
