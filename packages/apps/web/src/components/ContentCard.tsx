import { useState, useEffect } from 'react';
// react-query not needed here after removing actions
import { useNavigate } from 'react-router-dom';
import { type Content } from '../lib/api';
import { OptimizedImage } from './OptimizedImage';
import { formatInUserTimezone } from '../lib/timezone';
import { useTimezone } from '../contexts/TimezoneContext';
// import { useSchedulingWebSocket } from '../hooks/useSchedulingWebSocket'
import { StatusBadge } from './StatusBadge';
import { AlertTriangle } from 'lucide-react';

interface ContentCardProps {
  content: Content;
  brandId: string;
  isOptimistic?: boolean;
}

export function ContentCard({ content, brandId, isOptimistic = false }: ContentCardProps) {
  const [localStatus, setLocalStatus] = useState(content.status);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const { timezone, getBrandTimezone } = useTimezone();
  const [brandTimezone, setBrandTimezone] = useState<string>(timezone);
  const navigate = useNavigate();
  // const { connectionStatus } = useSchedulingWebSocket()
  const connectionStatus = 'connected'; // Default to connected for now

  // Resolve brand timezone (fallback to user tz)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const tz = await getBrandTimezone(brandId);
        if (mounted && tz) setBrandTimezone(tz);
      } catch {
        if (mounted) setBrandTimezone(timezone);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [brandId, getBrandTimezone, timezone]);

  // Update local status when content prop changes (from real-time updates)
  useEffect(() => {
    if (content.status !== localStatus) {
      setIsTransitioning(true);
      setLocalStatus(content.status);

      // Remove transition effect after animation
      const timer = setTimeout(() => {
        setIsTransitioning(false);
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [content.status, localStatus]);

  // Removed manual schedule and publish actions from cards per design update

  const isConnected = connectionStatus === 'connected';

  return (
    <div
      className={`bg-card cursor-pointer overflow-hidden rounded-lg shadow-md transition-all hover:shadow-lg ${
        !isConnected ? 'opacity-75' : ''
      }`}
      onClick={() => navigate(`/posts/${content.id}`)}
    >
      {content.imageUrl && (
        <div className="aspect-w-16 aspect-h-9">
          <OptimizedImage
            src={content.imageUrl}
            cdnUrl={content.imageUrl}
            fallbackUrl={undefined}
            alt="Generated content"
            className="h-48 w-full object-cover"
            aspectRatio="landscape"
          />
        </div>
      )}

      <div className="p-4">
        {/* Stale data indicator */}
        {!isConnected && content.status === 'scheduled' && (
          <div className="bg-muted text-muted-foreground mb-2 flex items-center gap-2 rounded p-2 text-xs">
            <AlertTriangle className="h-4 w-4" />
            <span>Status may not be current - connection lost</span>
          </div>
        )}

        <div className="mb-3">
          <p className="text-foreground text-sm leading-relaxed">{content.caption}</p>
        </div>

        <div className="mb-4">
          <div className="flex flex-wrap gap-1">
            {content.hashtags.map((tag, index) => {
              const t = typeof tag === 'string' && tag.startsWith('#') ? tag.slice(1) : tag;
              return (
                <span key={index} className="bg-muted inline-block rounded px-2 py-1 text-xs">
                  #{t}
                </span>
              );
            })}
          </div>
        </div>

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

            {isOptimistic && (
              <div className="text-muted-foreground flex items-center gap-1 text-xs">
                <span>Updating...</span>
              </div>
            )}

            {isTransitioning && !isOptimistic && (
              <span className="text-foreground animate-pulse text-xs font-medium">Updated</span>
            )}
          </div>

          {/* Manual schedule/publish actions removed on cards */}

          {content.status === 'published' && content.instagramPermalink && (
            <div className="flex space-x-2">
              <a
                href={content.instagramPermalink}
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
          )}
        </div>

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
