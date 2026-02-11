import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { content as contentApi } from '@/lib/api';

export interface PostDetailData {
  id: string;
  caption: string;
  contentType?: string;
  status: string; // 'draft' | 'scheduled' | 'published' | ...
  scheduledAt?: string | null;
  postedAt?: string | null;
  contentGroupId?: string | null;
  targetSocialAccountId?: string | null;
  brandId?: string;
  brand: { id: string; name: string };
  mediaAssets?: Array<{
    assetId: string;
    displayOrder: number;
  }>;
  primaryAssetId?: string | null;
  mediaAssetCount?: number | null;
  shareToFeed?: boolean | null;
  firstComment?: string | null;
  firstCommentStatus?: 'pending' | 'posted' | 'failed' | 'retrying' | null;
  firstCommentPostedAt?: string | null;
  firstCommentError?: string | null;
  schedulingError?: string | null;
  createdAt?: string;
  updatedAt?: string;
  instagramPermalink?: string | null;
  generationParams?: {
    processing?: {
      active: boolean;
      operation: 'scheduling';
      startedAt: string;
      operationId?: string;
    };
  };
}

export function usePostDetail(postId: string | undefined): UseQueryResult<PostDetailData> {
  return useQuery<PostDetailData>({
    queryKey: ['post', postId],
    queryFn: async () => {
      const response = await contentApi.getPostDetail(postId!);
      return {
        ...(response.data as PostDetailData),
        brandId: (response.data as any).brandId || (response.data as any).brand?.id,
      };
    },
    enabled: Boolean(postId),
    staleTime: 10000,
  });
}
