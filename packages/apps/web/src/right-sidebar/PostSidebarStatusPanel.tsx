import { Button } from '@/components/ui/button';
import type { PostStatus } from '@/components/PostStatusCard';
import { InstagramIcon } from '@/components/icons/BrandIcons';
import { PostStatusBadge } from '@/components/PostStatusBadge';

interface PostSidebarStatusPanelProps {
  status: PostStatus;
  processing?: boolean;
  schedulingError?: string | null;
  instagramPermalink?: string;
  brandTimezone: string;
  scheduledAt?: string;
}

export function PostSidebarStatusPanel({
  status,
  processing = false,
  schedulingError,
  instagramPermalink,
  scheduledAt,
}: PostSidebarStatusPanelProps) {
  return (
    <div className="bg-card border-border flex flex-col gap-1.5 rounded-md border px-3 py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <PostStatusBadge
            status={status}
            generationParams={
              processing
                ? {
                    processing: {
                      active: true,
                      operation: 'scheduling',
                      startedAt: new Date().toISOString(),
                    },
                  }
                : undefined
            }
            schedulingError={schedulingError}
            scheduledAt={scheduledAt}
          />
        </div>
        {status === 'published' && instagramPermalink && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => window.open(instagramPermalink, '_blank')}
          >
            <InstagramIcon className="mr-1 h-4 w-4" aria-hidden="true" />
            <span>View on Instagram</span>
          </Button>
        )}
      </div>
      {status === 'failed' && schedulingError && (
        <p className="text-destructive text-xs leading-snug">{schedulingError}</p>
      )}
    </div>
  );
}
