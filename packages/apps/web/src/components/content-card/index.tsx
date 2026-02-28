import { useState, useEffect } from 'react';
// react-query not needed here after removing actions
import { useNavigate } from 'react-router-dom';
import type { Content } from '@/lib/api';
import { OptimizedImage } from '../optimized-image';
import { formatInUserTimezone } from '@/lib/timezone';
import { useTimezone } from '@/contexts/TimezoneContext';
// import { useSchedulingWebSocket } from '../hooks/useSchedulingWebSocket'
import { StatusBadge } from '../status-badge';
import { AlertTriangle } from 'lucide-react';
import { getMediaBadgeType } from '@/utils/media-type';
import { MediaTypeBadge } from '@/components/media-type-badge';
import type { AssetType } from '@/features/assets/api/client';

interface ContentCardProps {
  content: Content;
  brandId: string;
  isOptimistic?: boolean;
  primaryAsset?: AssetType | null;
}

function useResolvedBrandTimezone({
  brandId,
  timezone,
  getBrandTimezone,
}: {
  brandId: string;
  timezone: string;
  getBrandTimezone: (brandId: string) => Promise<string>;
}) {
  const [brandTimezone, setBrandTimezone] = useState<string>(timezone);

  useEffect(() => {
    let mounted = true;
    const resolveBrandTimezone = async () => {
      try {
        const resolvedTimezone = await getBrandTimezone(brandId);
        if (mounted && resolvedTimezone) {
          setBrandTimezone(resolvedTimezone);
        }
      } catch {
        if (mounted) {
          setBrandTimezone(timezone);
        }
      }
    };

    void resolveBrandTimezone();
    return () => {
      mounted = false;
    };
  }, [brandId, getBrandTimezone, timezone]);

  return brandTimezone;
}

function useLocalStatus(status: Content['status']) {
  const [localStatus, setLocalStatus] = useState(status);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    if (status === localStatus) {
      return;
    }
    setIsTransitioning(true);
    setLocalStatus(status);
    const timer = setTimeout(() => {
      setIsTransitioning(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [status, localStatus]);

  return { isTransitioning, localStatus };
}

function ContentCardPreview({
  previewUrl,
  mediaBadgeType,
}: {
  previewUrl: string | null;
  mediaBadgeType: ReturnType<typeof getMediaBadgeType>;
}) {
  return (
    <div className="aspect-w-16 aspect-h-9 bg-muted relative">
      {previewUrl ? (
        <OptimizedImage
          src={previewUrl}
          cdnUrl={previewUrl}
          fallbackUrl={undefined}
          alt="Post preview"
          className="h-48 w-full object-cover"
          aspectRatio="landscape"
        />
      ) : (
        <div className="h-48 w-full" />
      )}
      <MediaTypeBadge type={mediaBadgeType} className="absolute top-2 right-2" />
    </div>
  );
}

function StaleStatusNotice() {
  return (
    <div className="bg-muted text-muted-foreground mb-2 flex items-center gap-2 rounded p-2 text-xs">
      <AlertTriangle className="h-4 w-4" />
      <span>Status may not be current - connection lost</span>
    </div>
  );
}

function PublishedPermalink({ permalink }: { permalink: string }) {
  return (
    <div className="flex space-x-2">
      <a
        href={permalink}
        target="_blank"
        rel="noopener noreferrer"
        className="bg-muted hover:bg-accent flex items-center gap-1 rounded px-3 py-1 text-sm"
      >
        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
        View on Instagram
      </a>
    </div>
  );
}

function StatusArea({
  localStatus,
  isOptimistic,
  isTransitioning,
  content,
}: {
  localStatus: Content['status'];
  isOptimistic: boolean;
  isTransitioning: boolean;
  content: Content;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <StatusBadge
          status={localStatus}
          isLoading={isOptimistic}
          retryCount={0}
          className={`transition-all duration-500 ${
            isTransitioning ? 'ring-ring scale-110 ring-2 ring-offset-2' : ''
          }`}
        />

        {isOptimistic ? (
          <div className="text-muted-foreground flex items-center gap-1 text-xs">
            <span>Updating...</span>
          </div>
        ) : null}

        {isTransitioning && !isOptimistic ? (
          <span className="text-foreground animate-pulse text-xs font-medium">Updated</span>
        ) : null}
      </div>

      {content.status === 'published' && content.permalink ? (
        <PublishedPermalink permalink={content.permalink as string} />
      ) : null}
    </div>
  );
}

function resolveContentPreviewUrl(primaryAsset: AssetType | null): string | null {
  if (!primaryAsset) {
    return null;
  }
  if (primaryAsset.fileType === 'video') {
    return primaryAsset.thumbnailUrl || null;
  }
  return primaryAsset.thumbnailUrl || primaryAsset.url || null;
}

function getContentCardClassName(isConnected: boolean): string {
  return `bg-card cursor-pointer overflow-hidden rounded-lg shadow-md transition-all hover:shadow-lg ${
    !isConnected ? 'opacity-75' : ''
  }`;
}

export function ContentCard({
  content,
  brandId,
  isOptimistic = false,
  primaryAsset = null,
}: ContentCardProps) {
  const { timezone, getBrandTimezone } = useTimezone();
  const navigate = useNavigate();
  const { localStatus, isTransitioning } = useLocalStatus(content.status);
  const brandTimezone = useResolvedBrandTimezone({ brandId, timezone, getBrandTimezone });
  const connectionStatus = 'connected'; // Default to connected for now

  const isConnected = connectionStatus === 'connected';
  const mediaBadgeType = getMediaBadgeType({
    contentType: content.contentType,
    mediaAssets: content.mediaAssets,
    mediaAssetCount: content.mediaAssetCount,
    primaryAssetFileType: primaryAsset?.fileType ?? null,
  });
  const previewUrl = resolveContentPreviewUrl(primaryAsset);
  const cardClassName = getContentCardClassName(isConnected);

  return (
    <div className={cardClassName} onClick={() => navigate(`/posts/${content.id}`)}>
      <ContentCardPreview previewUrl={previewUrl} mediaBadgeType={mediaBadgeType} />

      <div className="p-4">
        {!isConnected && content.status === 'scheduled' ? <StaleStatusNotice /> : null}

        <div className="mb-3">
          <p className="text-foreground text-sm leading-relaxed">{content.caption}</p>
        </div>

        <StatusArea
          localStatus={localStatus}
          isOptimistic={isOptimistic}
          isTransitioning={isTransitioning}
          content={content}
        />

        {content.scheduledAt && (
          <div className="text-muted-foreground mt-2 text-xs">
            Scheduled for:{' '}
            {formatInUserTimezone(content.scheduledAt, 'MMM d, yyyy h:mm a', brandTimezone)}
          </div>
        )}
      </div>
    </div>
  );
}
