export interface PostMetrics {
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  engagement: number;
  engagementRate: number;
}

export interface Post {
  publicationId: string;
  contentId: string;
  platform: string;
  caption: string;
  thumbnailUrl?: string;
  permalink?: string;
  publishedAt?: string;
  metrics: PostMetrics;
}

export interface PostsPerformanceTableProps {
  posts: Post[];
  loading?: boolean;
  pagination?: { total: number; limit: number; offset: number; hasMore: boolean };
  onPageChange?: (offset: number) => void;
  onPostClick?: (contentId: string) => void;
}

export type SortMetric = 'publishedAt' | 'engagement' | 'reach' | 'engagementRate';
export type SortOrder = 'asc' | 'desc';

export function formatDate(value?: string) {
  if (!value) {
    return 'N/A';
  }
  return new Date(value).toLocaleDateString();
}

function getSortValue(post: Post, sortBy: SortMetric): number {
  if (sortBy === 'publishedAt') {
    return post.publishedAt ? new Date(post.publishedAt).getTime() : 0;
  }
  return post.metrics[sortBy] || 0;
}

export function sortPosts(posts: Post[], sortBy: SortMetric, sortOrder: SortOrder) {
  return [...posts].sort((left, right) => {
    const leftValue = getSortValue(left, sortBy);
    const rightValue = getSortValue(right, sortBy);
    return sortOrder === 'desc' ? rightValue - leftValue : leftValue - rightValue;
  });
}
