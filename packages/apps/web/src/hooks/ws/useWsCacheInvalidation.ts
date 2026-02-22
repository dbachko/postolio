import { useCallback, useEffect, useRef } from 'react';

type ContentStatus = 'draft' | 'scheduled' | 'published' | 'failed';

interface ContentItem {
  id: string;
  status: ContentStatus;
  [key: string]: unknown;
}

interface CacheData {
  content?: ContentItem[];
  [key: string]: unknown;
}

type CalendarQueryData =
  | {
      success?: boolean;
      data?: {
        content?: any[];
        placeholders?: any[];
      };
    }
  | undefined;

export interface StatusUpdateEventLike {
  type: string;
  data: any;
}

export function useWsCacheInvalidation(
  queryClient: any,
  queryKeys: any[],
  onStatusUpdate?: (event: StatusUpdateEventLike) => void
) {
  const pendingInvalidationsRef = useRef<Map<string, any>>(new Map());
  const invalidationTimerRef = useRef<number | null>(null);

  const flushInvalidations = useCallback(() => {
    if (pendingInvalidationsRef.current.size === 0) {
      return;
    }
    const entries = Array.from(pendingInvalidationsRef.current.values());
    pendingInvalidationsRef.current.clear();
    invalidationTimerRef.current = null;

    for (const queryKey of entries) {
      // Mark stale but avoid immediate refetch storms (which can cause visible flicker).
      queryClient.invalidateQueries({ queryKey, refetchType: 'none' });
    }
  }, [queryClient]);

  const scheduleInvalidations = useCallback(
    (keys: any[]) => {
      for (const queryKey of keys) {
        const key =
          typeof queryKey === 'string'
            ? queryKey
            : Array.isArray(queryKey)
              ? JSON.stringify(queryKey)
              : JSON.stringify([queryKey]);
        pendingInvalidationsRef.current.set(key, queryKey);
      }

      if (invalidationTimerRef.current !== null) {
        return;
      }
      // Debounce/merge WS bursts so we don't thrash the UI.
      invalidationTimerRef.current = window.setTimeout(() => flushInvalidations(), 1000);
    },
    [flushInvalidations]
  );

  useEffect(() => {
    return () => {
      if (invalidationTimerRef.current !== null) {
        window.clearTimeout(invalidationTimerRef.current);
        invalidationTimerRef.current = null;
      }
      pendingInvalidationsRef.current.clear();
    };
  }, []);

  return useCallback(
    (event: StatusUpdateEventLike) => {
      // external handler first
      onStatusUpdate?.(event);

      // Invalidate relevant queries to refresh UI.
      // Coalesce multiple WS events into a single invalidation pass to avoid UI flicker.
      scheduleInvalidations(queryKeys);

      // Optimistic cache update for content status
      const statusEvents: Array<{
        contentId: string;
        newStatus: string;
        metadata?: Record<string, unknown> | null;
      }> = (() => {
        if (event.type === 'status_update' && 'contentId' in event.data) {
          return [
            {
              contentId: String((event.data as any).contentId),
              newStatus: String((event.data as any).newStatus),
              metadata:
                (event.data as any)?.metadata && typeof (event.data as any).metadata === 'object'
                  ? ((event.data as any).metadata as Record<string, unknown>)
                  : null,
            },
          ];
        }
        if (event.type === 'batch_status_update' && Array.isArray((event as any).data)) {
          return ((event as any).data as any[])
            .filter((e) => e && typeof e === 'object' && 'contentId' in e)
            .map((e) => ({
              contentId: String((e as any).contentId),
              newStatus: String((e as any).newStatus),
              metadata:
                (e as any)?.metadata && typeof (e as any).metadata === 'object'
                  ? ((e as any).metadata as Record<string, unknown>)
                  : null,
            }));
        }
        return [];
      })();

      for (const { contentId, newStatus, metadata } of statusEvents) {
        if (!contentId) {
          continue;
        }

        const scheduledAt =
          metadata && typeof metadata.scheduledAt === 'string'
            ? (metadata.scheduledAt as string)
            : null;

        queryClient.setQueriesData(
          { queryKey: ['content'] },
          (oldData: CacheData | ContentItem[] | undefined) => {
            if (!oldData) {
              return oldData as any;
            }

            if (Array.isArray(oldData)) {
              return oldData.map((item: ContentItem) =>
                item.id === contentId
                  ? { ...item, status: newStatus, ...(scheduledAt ? { scheduledAt } : {}) }
                  : item
              );
            }

            if ('content' in (oldData as any) && Array.isArray((oldData as any).content)) {
              return {
                ...(oldData as any),
                content: (oldData as any).content.map((item: ContentItem) =>
                  item.id === contentId
                    ? { ...item, status: newStatus, ...(scheduledAt ? { scheduledAt } : {}) }
                    : item
                ),
              } as any;
            }

            return oldData as any;
          }
        );

        queryClient.setQueryData(['post', contentId], (old: any) => {
          if (!old) {
            return old;
          }
          return {
            ...old,
            status: newStatus,
            ...(scheduledAt ? { scheduledAt } : {}),
            generationParams: {
              ...(old.generationParams || {}),
              processing: {
                ...(old.generationParams?.processing || {}),
                active: false,
              },
            },
          };
        });

        // Best-effort: update any cached calendar month payloads that already include this content item.
        // Avoids full refetches (and the visible "flashing" that can come with them).
        if (scheduledAt) {
          queryClient.setQueriesData({ queryKey: ['calendar'] }, (oldData: CalendarQueryData) => {
            const content = (oldData as any)?.data?.content;
            if (!Array.isArray(content)) {
              return oldData;
            }
            const nextContent = content.map((item: any) => {
              if (!item || String(item.id) !== contentId) {
                return item;
              }
              return { ...item, status: newStatus, scheduledAt };
            });
            return {
              ...(oldData as any),
              data: {
                ...(oldData as any).data,
                content: nextContent,
              },
            };
          });
        }
      }
    },
    [onStatusUpdate, queryClient, queryKeys, scheduleInvalidations]
  );
}
