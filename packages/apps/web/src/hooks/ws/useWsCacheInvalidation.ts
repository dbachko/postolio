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

type StatusEvent = {
  contentId: string;
  newStatus: string;
  metadata?: Record<string, unknown> | null;
};

function getQueryKeyIdentity(queryKey: unknown): string {
  if (typeof queryKey === 'string') {
    return queryKey;
  }
  if (Array.isArray(queryKey)) {
    return JSON.stringify(queryKey);
  }
  return JSON.stringify([queryKey]);
}

function getStatusEvents(event: StatusUpdateEventLike): StatusEvent[] {
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
      .filter((item) => item && typeof item === 'object' && 'contentId' in item)
      .map((item) => ({
        contentId: String((item as any).contentId),
        newStatus: String((item as any).newStatus),
        metadata:
          (item as any)?.metadata && typeof (item as any).metadata === 'object'
            ? ((item as any).metadata as Record<string, unknown>)
            : null,
      }));
  }

  return [];
}

function getScheduledAt(metadata?: Record<string, unknown> | null): string | null {
  return metadata && typeof metadata.scheduledAt === 'string'
    ? (metadata.scheduledAt as string)
    : null;
}

function toContentStatus(value: string): ContentStatus | null {
  if (value === 'draft' || value === 'scheduled' || value === 'published' || value === 'failed') {
    return value;
  }
  return null;
}

function updateContentListItems(
  items: ContentItem[],
  contentId: string,
  newStatus: ContentStatus,
  scheduledAt: string | null
): ContentItem[] {
  return items.map((item) =>
    item.id === contentId
      ? { ...item, status: newStatus, ...(scheduledAt ? { scheduledAt } : {}) }
      : item
  );
}

function updateContentQueryCache(
  queryClient: any,
  contentId: string,
  newStatus: ContentStatus,
  scheduledAt: string | null
): void {
  queryClient.setQueriesData(
    { queryKey: ['content'] },
    (oldData: CacheData | ContentItem[] | undefined) => {
      if (!oldData) {
        return oldData as any;
      }
      if (Array.isArray(oldData)) {
        return updateContentListItems(oldData, contentId, newStatus, scheduledAt);
      }
      if ('content' in (oldData as any) && Array.isArray((oldData as any).content)) {
        return {
          ...(oldData as any),
          content: updateContentListItems(
            (oldData as any).content,
            contentId,
            newStatus,
            scheduledAt
          ),
        } as any;
      }
      return oldData as any;
    }
  );
}

function updatePostCache(
  queryClient: any,
  contentId: string,
  newStatus: string,
  scheduledAt: string | null
): void {
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
}

function updateCalendarCache(
  queryClient: any,
  contentId: string,
  newStatus: string,
  scheduledAt: string | null
): void {
  if (!scheduledAt) {
    return;
  }

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

export function useWsCacheInvalidation(
  queryClient: any,
  queryKeys: any[],
  onStatusUpdate?: (event: StatusUpdateEventLike) => void
) {
  const pendingInvalidationsRef = useRef<Map<string, any>>(new Map());
  const invalidationTimerRef = useRef<number | null>(null);
  const clearPendingInvalidations = useCallback(() => {
    pendingInvalidationsRef.current.clear();
  }, []);

  const flushInvalidations = useCallback(() => {
    if (pendingInvalidationsRef.current.size === 0) {
      return;
    }
    const entries = Array.from(pendingInvalidationsRef.current.values());
    clearPendingInvalidations();
    invalidationTimerRef.current = null;

    for (const queryKey of entries) {
      // Mark stale but avoid immediate refetch storms (which can cause visible flicker).
      queryClient.invalidateQueries({ queryKey, refetchType: 'none' });
    }
  }, [clearPendingInvalidations, queryClient]);

  const scheduleInvalidations = useCallback(
    (keys: any[]) => {
      for (const queryKey of keys) {
        const key = getQueryKeyIdentity(queryKey);
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
      clearPendingInvalidations();
    };
  }, [clearPendingInvalidations]);

  return useCallback(
    (event: StatusUpdateEventLike) => {
      onStatusUpdate?.(event);

      scheduleInvalidations(queryKeys);

      const statusEvents = getStatusEvents(event);

      for (const { contentId, newStatus, metadata } of statusEvents) {
        if (!contentId) {
          continue;
        }
        const normalizedStatus = toContentStatus(newStatus);
        if (!normalizedStatus) {
          continue;
        }
        const scheduledAt = getScheduledAt(metadata);
        updateContentQueryCache(queryClient, contentId, normalizedStatus, scheduledAt);
        updatePostCache(queryClient, contentId, newStatus, scheduledAt);
        updateCalendarCache(queryClient, contentId, newStatus, scheduledAt);
      }
    },
    [onStatusUpdate, queryClient, queryKeys, scheduleInvalidations]
  );
}
