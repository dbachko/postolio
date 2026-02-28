import type { PostDetailData } from '@/hooks/usePostDetail';

type QueryClient = {
  invalidateQueries: (args: { queryKey: unknown[] }) => unknown;
};

export function resolveMutationBrandId(
  post: PostDetailData | undefined,
  selectedBrandId: string | null
): string | null {
  return post?.brand?.id ?? selectedBrandId ?? null;
}

export function invalidateCalendarAndDrafts(
  queryClient: QueryClient,
  brandId: string | null
): void {
  if (!brandId) {
    return;
  }
  queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
  queryClient.invalidateQueries({ queryKey: ['drafts', brandId] });
}

export function invalidatePublishingQueues(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ['publishing-queue-slot-instances-calendar'] });
  queryClient.invalidateQueries({ queryKey: ['publishing-queue-items-calendar'] });
  queryClient.invalidateQueries({ queryKey: ['publishing-queue-slot-instances'] });
  queryClient.invalidateQueries({ queryKey: ['publishing-queue-items'] });
}
