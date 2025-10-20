import { useCallback } from 'react';

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

export interface StatusUpdateEventLike {
  type: string;
  data: any;
}

export function useWsCacheInvalidation(
  queryClient: any,
  queryKeys: any[],
  onStatusUpdate?: (event: StatusUpdateEventLike) => void
) {
  return useCallback(
    (event: StatusUpdateEventLike) => {
      // external handler first
      onStatusUpdate?.(event);

      // Invalidate relevant queries to refresh UI
      queryKeys.forEach((queryKey) => {
        queryClient.invalidateQueries({ queryKey });
      });

      // Invalidate campaign query if metadata provides campaignId
      if (event.type === 'status_update' && 'contentId' in event.data) {
        const metadata = (event.data as any).metadata as { campaignId?: string } | undefined;
        if (metadata?.campaignId) {
          queryClient.invalidateQueries({ queryKey: ['campaign', metadata.campaignId] });
        }
      }

      // Optimistic cache update for content status
      if (event.type === 'status_update' && 'contentId' in event.data) {
        const contentId = (event.data as any).contentId;
        const newStatus = (event.data as any).newStatus;

        queryClient.setQueriesData(
          { queryKey: ['content'] },
          (oldData: CacheData | ContentItem[] | undefined) => {
            if (!oldData) return oldData as any;

            if (Array.isArray(oldData)) {
              return oldData.map((item: ContentItem) =>
                item.id === contentId ? { ...item, status: newStatus } : item
              );
            }

            if ('content' in (oldData as any) && Array.isArray((oldData as any).content)) {
              return {
                ...(oldData as any),
                content: (oldData as any).content.map((item: ContentItem) =>
                  item.id === contentId ? { ...item, status: newStatus } : item
                ),
              } as any;
            }

            return oldData as any;
          }
        );

        queryClient.setQueryData(['post', contentId], (old: any) => {
          if (!old) return old;
          return {
            ...old,
            status: newStatus,
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
    },
    [queryClient, queryKeys, onStatusUpdate]
  );
}
