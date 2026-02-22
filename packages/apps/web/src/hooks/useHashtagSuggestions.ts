import { useQuery } from '@tanstack/react-query';
import { analytics } from '@/lib/api';

interface HashtagData {
  hashtag: string;
  uses: number;
  avgReach: number;
  avgEngagement: number;
  avgImpressions: number;
  bestPost: {
    contentId: string;
    engagementRate: number;
  } | null;
}

interface HashtagAnalyticsResponse {
  success: boolean;
  data: HashtagData[];
}

export function useHashtagSuggestions(brandId: string | undefined) {
  return useQuery({
    queryKey: ['hashtag-suggestions', brandId],
    queryFn: async () => {
      if (!brandId) {
        return [];
      }

      const response = (await analytics.getBrandHashtags(brandId)) as HashtagAnalyticsResponse;

      if (response.success) {
        return response.data;
      }

      return [];
    },
    enabled: !!brandId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

export type { HashtagData };
