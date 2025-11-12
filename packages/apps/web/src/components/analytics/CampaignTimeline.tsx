import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertCircle } from 'lucide-react';
import { formatNumber, formatPercent } from '@/utils/formatNumber';

interface TimelinePost {
  contentId: string;
  publishedAt: string | null;
  engagement: number;
  reach: number;
  impressions: number;
  engagementRate: number;
  caption?: string;
}

interface CampaignTimelineProps {
  posts: TimelinePost[];
  startDate?: string;
  endDate?: string;
  loading?: boolean;
  onPostClick?: (contentId: string) => void;
}

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export function CampaignTimeline({
  posts,
  startDate,
  endDate,
  loading,
  onPostClick,
}: CampaignTimelineProps) {
  if (loading) {
    return (
      <Card className="p-6">
        <Skeleton className="mb-4 h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </Card>
    );
  }

  if (!posts || posts.length === 0) {
    return (
      <Card className="p-6">
        <h3 className="mb-4 text-lg font-semibold">Campaign Timeline</h3>
        <div className="text-muted-foreground flex flex-col items-center justify-center py-12">
          <AlertCircle className="mb-2 h-12 w-12" />
          <p>No published posts in this campaign yet</p>
        </div>
      </Card>
    );
  }

  // Filter out posts without publishedAt
  const publishedPosts = posts.filter((p) => p.publishedAt !== null);

  if (publishedPosts.length === 0) {
    return (
      <Card className="p-6">
        <h3 className="mb-4 text-lg font-semibold">Campaign Timeline</h3>
        <div className="text-muted-foreground flex flex-col items-center justify-center py-12">
          <AlertCircle className="mb-2 h-12 w-12" />
          <p>No published posts with dates available</p>
        </div>
      </Card>
    );
  }

  // Calculate date range
  const dates = publishedPosts.map((p) => new Date(p.publishedAt!).getTime());
  const minDate = startDate ? new Date(startDate).getTime() : Math.min(...dates);
  const maxDate = endDate ? new Date(endDate).getTime() : Math.max(...dates);
  const range = maxDate - minDate;

  // Calculate max engagement for marker sizing
  const maxEngagement = Math.max(...publishedPosts.map((p) => p.engagement));

  // Identify gaps (more than 7 days between posts)
  const sortedPosts = [...publishedPosts].sort(
    (a, b) => new Date(a.publishedAt!).getTime() - new Date(b.publishedAt!).getTime()
  );

  const gaps: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < sortedPosts.length - 1; i++) {
    const current = new Date(sortedPosts[i].publishedAt!).getTime();
    const next = new Date(sortedPosts[i + 1].publishedAt!).getTime();
    const daysDiff = (next - current) / (1000 * 60 * 60 * 24);

    if (daysDiff > 7) {
      gaps.push({
        start: ((current - minDate) / range) * 100,
        end: ((next - minDate) / range) * 100,
      });
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Campaign Timeline</h3>
        <div className="text-muted-foreground text-sm">
          {formatDate(new Date(minDate).toISOString())} -{' '}
          {formatDate(new Date(maxDate).toISOString())}
        </div>
      </div>

      {/* Timeline Container */}
      <div className="relative">
        {/* Timeline Bar */}
        <div className="bg-border relative h-2 w-full rounded-full">
          {/* Gap Indicators */}
          {gaps.map((gap, index) => (
            <div
              key={index}
              className="absolute h-2 rounded-full bg-amber-200"
              style={{
                left: `${gap.start}%`,
                width: `${gap.end - gap.start}%`,
              }}
            />
          ))}
        </div>

        {/* Posts Markers */}
        <div className="relative mt-2 h-24">
          <TooltipProvider>
            {publishedPosts.map((post) => {
              const position = ((new Date(post.publishedAt!).getTime() - minDate) / range) * 100;
              const size = 8 + (post.engagement / maxEngagement) * 24; // 8-32px based on engagement

              return (
                <Tooltip key={post.contentId}>
                  <TooltipTrigger asChild>
                    <button
                      className="bg-primary hover:ring-primary absolute -translate-x-1/2 transform rounded-full transition-all hover:scale-110 hover:ring-2 hover:ring-offset-2"
                      style={{
                        left: `${position}%`,
                        width: `${size}px`,
                        height: `${size}px`,
                        top: '50%',
                        transform: `translate(-50%, -50%)`,
                      }}
                      onClick={() => onPostClick?.(post.contentId)}
                    />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <div className="space-y-2">
                      <div className="text-sm font-semibold">{formatDate(post.publishedAt!)}</div>
                      {post.caption && <p className="line-clamp-2 text-xs">{post.caption}</p>}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <span className="text-muted-foreground">Impressions:</span>
                        <span className="font-medium">{formatNumber(post.impressions)}</span>
                        <span className="text-muted-foreground">Reach:</span>
                        <span className="font-medium">{formatNumber(post.reach)}</span>
                        <span className="text-muted-foreground">Engagement:</span>
                        <span className="font-medium">{formatNumber(post.engagement)}</span>
                        <span className="text-muted-foreground">Rate:</span>
                        <span className="font-medium">{formatPercent(post.engagementRate)}</span>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </TooltipProvider>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-6 flex items-center justify-between border-t pt-4">
        <div className="text-muted-foreground flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <div className="bg-primary h-3 w-3 rounded-full" />
            <span>Published Post</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-8 rounded-full bg-amber-200" />
            <span>Publishing Gap (&gt;7 days)</span>
          </div>
        </div>
        <div className="text-muted-foreground text-xs">
          {publishedPosts.length} {publishedPosts.length === 1 ? 'post' : 'posts'} published
        </div>
      </div>
    </Card>
  );
}
