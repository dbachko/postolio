import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Hash, ExternalLink } from 'lucide-react';
import { formatNumber, formatPercent } from '@/utils/formatNumber';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useState } from 'react';

interface HashtagData {
  hashtag: string;
  uses: number;
  avgReach: number;
  avgEngagement: number;
  avgImpressions: number;
  bestPost?: {
    contentId: string;
    engagementRate: number;
  };
}

interface HashtagAnalysisProps {
  hashtags: HashtagData[];
  loading?: boolean;
}

type HashtagSort = 'engagement' | 'reach' | 'uses';

function HashtagAnalysisHeader({
  sortBy,
  onSortChange,
}: {
  sortBy: HashtagSort;
  onSortChange: (value: HashtagSort) => void;
}) {
  return (
    <CardHeader>
      <div className="flex items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Hash className="h-5 w-5" />
          <span>Hashtag Performance</span>
        </CardTitle>
        <Select value={sortBy} onValueChange={(value: HashtagSort) => onSortChange(value)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="engagement">By Engagement</SelectItem>
            <SelectItem value="reach">By Reach</SelectItem>
            <SelectItem value="uses">By Usage</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </CardHeader>
  );
}

function LoadingState() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Hash className="h-5 w-5" />
          <span>Hashtag Performance</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Hash className="h-5 w-5" />
          <span>Hashtag Performance</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-muted-foreground py-8 text-center">
          <Hash className="mx-auto mb-3 h-12 w-12 opacity-30" />
          <p className="text-sm">No hashtag data available</p>
          <p className="text-xs">Start using hashtags in your posts to see performance</p>
        </div>
      </CardContent>
    </Card>
  );
}

function sortHashtags(hashtags: HashtagData[], sortBy: HashtagSort) {
  return [...hashtags].sort((a, b) => {
    switch (sortBy) {
      case 'engagement':
        return b.avgEngagement - a.avgEngagement;
      case 'reach':
        return b.avgReach - a.avgReach;
      case 'uses':
        return b.uses - a.uses;
      default:
        return 0;
    }
  });
}

function HashtagTable({ hashtags }: { hashtags: HashtagData[] }) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground grid grid-cols-12 gap-2 border-b pb-2 text-xs font-medium">
        <div className="col-span-4">Hashtag</div>
        <div className="col-span-2 text-right">Uses</div>
        <div className="col-span-2 text-right">Avg Reach</div>
        <div className="col-span-2 text-right">Avg Engagement</div>
        <div className="col-span-2 text-right">Best Post</div>
      </div>

      <div className="space-y-2">
        {hashtags.slice(0, 20).map((tag, index) => (
          <div
            key={tag.hashtag}
            className="hover:bg-muted/50 grid grid-cols-12 gap-2 rounded-lg p-2 transition-colors"
          >
            <div className="col-span-4 flex items-center gap-2">
              <span className="text-muted-foreground text-xs font-medium">#{index + 1}</span>
              <span className="font-mono text-sm font-medium">#{tag.hashtag}</span>
            </div>
            <div className="col-span-2 flex items-center justify-end">
              <span className="text-sm">{tag.uses}</span>
            </div>
            <div className="col-span-2 flex items-center justify-end">
              <span className="text-sm">{formatNumber(tag.avgReach)}</span>
            </div>
            <div className="col-span-2 flex items-center justify-end">
              <span className="text-sm font-medium">{formatNumber(tag.avgEngagement)}</span>
            </div>
            <div className="col-span-2 flex items-center justify-end">
              {tag.bestPost ? (
                <a
                  href={`/posts/${tag.bestPost.contentId}`}
                  className="text-primary flex items-center gap-1 text-sm hover:underline"
                >
                  {formatPercent(tag.bestPost.engagementRate)}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <span className="text-muted-foreground text-sm">—</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {hashtags.length > 20 ? (
        <div className="text-muted-foreground pt-3 text-center text-xs">
          Showing top 20 of {hashtags.length} hashtags
        </div>
      ) : null}
    </div>
  );
}

export function HashtagAnalysis({ hashtags, loading }: HashtagAnalysisProps) {
  const [sortBy, setSortBy] = useState<HashtagSort>('engagement');

  if (loading) {
    return <LoadingState />;
  }

  if (!hashtags || hashtags.length === 0) {
    return <EmptyState />;
  }

  const sortedHashtags = sortHashtags(hashtags, sortBy);

  return (
    <Card>
      <HashtagAnalysisHeader sortBy={sortBy} onSortChange={setSortBy} />
      <CardContent>
        <HashtagTable hashtags={sortedHashtags} />
      </CardContent>
    </Card>
  );
}
