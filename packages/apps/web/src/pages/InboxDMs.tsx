import { useEffect, useState } from 'react';
import { useBrandStore } from '@/stores/brandStore';
import { brand as brandApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
// removed icon in title
import { DMsThreadsList } from '@/components/inbox/DMsThreadsList';
import { DMsMessagesPanel } from '@/components/inbox/DMsMessagesPanel';

export default function InboxDMs() {
  const brand = useBrandStore((s) => s.selectedBrand);
  const brandId = brand?.id;
  const [threads, setThreads] = useState<
    Array<{ id: string; updated_time?: string; participants?: any[] }>
  >([]);
  const [threadsAfter, setThreadsAfter] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<
    Array<{ id: string; message?: string; from?: any; created_time?: string }>
  >([]);
  const [messagesBefore, setMessagesBefore] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [composer, setComposer] = useState('');
  const [windowClosed, setWindowClosed] = useState(false);
  const [supported, setSupported] = useState(true);

  const loadThreads = async (after?: string | null) => {
    if (!brandId) return;
    const res = (await brandApi.getDmThreads(brandId, {
      limit: 25,
      after: after || undefined,
    })) as any;
    if (res?.supported === false) {
      setSupported(false);
      return;
    }
    setSupported(true);
    const list = Array.isArray(res?.threads) ? res.threads : [];
    setThreads((prev) => (after ? [...prev, ...list] : list));
    const nextAfter = res?.paging?.cursors?.after || null;
    setThreadsAfter(nextAfter);
    if (!after && list.length && !selectedThreadId) setSelectedThreadId(list[0].id);
  };

  const loadMessages = async (threadId: string, before?: string | null) => {
    if (!brandId) return;
    setLoadingMessages(true);
    try {
      const res = (await brandApi.getDmMessages(brandId, threadId, {
        limit: 25,
        before: before || undefined,
      })) as any;
      if (res?.supported === false) {
        setSupported(false);
        setMessages([]);
        return;
      }
      setSupported(true);
      const rows = Array.isArray(res?.messages) ? res.messages : [];
      rows.sort(
        (a: any, b: any) =>
          new Date(a.created_time || 0).getTime() - new Date(b.created_time || 0).getTime()
      );
      setMessages((prev) => (before ? [...rows, ...prev] : rows));
      const nextBefore = res?.paging?.cursors?.before || null;
      setMessagesBefore(nextBefore);
      setWindowClosed(false);
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    if (brandId) {
      setThreads([]);
      setThreadsAfter(null);
      setSelectedThreadId(null);
      loadThreads(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId]);

  useEffect(() => {
    if (selectedThreadId) {
      setMessages([]);
      setMessagesBefore(null);
      loadMessages(selectedThreadId, null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedThreadId]);

  const onSend = async () => {
    if (!brandId || !selectedThreadId || !composer.trim()) return;
    try {
      const res = (await brandApi.sendDmMessage(brandId, selectedThreadId, composer.trim())) as any;
      if (res?.supported === false) {
        toast.info('Instagram messaging not supported for this account/app');
        return;
      }
      if (res?.error === 'WINDOW_CLOSED') {
        setWindowClosed(true);
        toast.info('24-hour window closed. Unable to send.');
        return;
      }
      setComposer('');
      await loadMessages(selectedThreadId, null);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to send');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">Direct Messages</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="md:col-span-1">
            <div className="mb-2 text-sm font-medium">Conversations</div>
            {brandId ? (
              supported ? (
                <DMsThreadsList
                  threads={threads}
                  selectedThreadId={selectedThreadId}
                  onSelect={(id) => setSelectedThreadId(id)}
                  onLoadMore={threadsAfter ? () => loadThreads(threadsAfter) : undefined}
                  afterCursor={threadsAfter}
                />
              ) : (
                <div className="text-muted-foreground text-sm">
                  Instagram messaging not enabled for this brand/app.
                </div>
              )
            ) : (
              <div className="text-muted-foreground text-sm">Select a brand to view DMs.</div>
            )}
          </div>
          <div className="md:col-span-2">
            <DMsMessagesPanel
              selectedThreadId={selectedThreadId}
              messages={messages}
              loading={loadingMessages}
              beforeCursor={messagesBefore}
              onLoadOlder={() =>
                selectedThreadId && messagesBefore && loadMessages(selectedThreadId, messagesBefore)
              }
              composer={composer}
              setComposer={setComposer}
              onSend={onSend}
              windowClosed={windowClosed}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
