import { Link } from 'react-router-dom';
import { Megaphone } from 'lucide-react';

import type { PostDetailData } from '@/hooks/usePostDetail';
import { Card } from '@/components/ui/card';
import { formatInUserTimezone } from '@/lib/timezone';

type PostInformationCardProps = {
  post: PostDetailData;
  brandTimezone: string;
};

export function PostInformationCard({ post, brandTimezone }: PostInformationCardProps) {
  return (
    <Card className="p-4 md:p-6">
      <h3 className="mb-3 flex items-center gap-2 text-base font-semibold md:mb-4 md:text-lg">
        Information
      </h3>
      <div className="space-y-2 text-xs md:space-y-3 md:text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">Brand</span>
          <span className="font-medium">{post.brand?.name || '—'}</span>
        </div>

        {post.campaign?.id ? (
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground flex items-center gap-1">
              <Megaphone className="h-3.5 w-3.5" />
              Campaign
            </span>
            <Link
              to={`/campaigns/${post.campaign.id}`}
              className="text-foreground font-medium hover:underline"
              title={`View campaign: ${post.campaign.name}`}
            >
              {post.campaign.name}
            </Link>
          </div>
        ) : null}

        {post.scheduledAt ? (
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Scheduled</span>
            <span className="font-medium">
              {formatInUserTimezone(post.scheduledAt, 'MMM d, h:mm a', brandTimezone)}
            </span>
          </div>
        ) : null}

        {post.postedAt ? (
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Published</span>
            <span className="font-medium">
              {formatInUserTimezone(post.postedAt, 'MMM d, h:mm a', brandTimezone)}
            </span>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
