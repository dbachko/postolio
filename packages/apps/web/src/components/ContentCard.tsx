import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { content as contentApi, type Content } from '../lib/api';
import { OptimizedImage } from './OptimizedImage';
import { formatInUserTimezone } from '../lib/timezone';
import { useTimezone } from '../contexts/TimezoneContext';
// import { useSchedulingWebSocket } from '../hooks/useSchedulingWebSocket'
import { StatusBadge } from './StatusBadge';
import { Loader2, AlertTriangle } from 'lucide-react';

interface ContentCardProps {
  content: Content;
  brandId: string;
  isOptimistic?: boolean;
}

export function ContentCard({ content, brandId, isOptimistic = false }: ContentCardProps) {
  const [publishError, setPublishError] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState(content.status);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const queryClient = useQueryClient();
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
  }, [content.status]);

  const publishMutation = useMutation({
    mutationFn: (contentId: string) => contentApi.publishToInstagram(contentId),
    onSuccess: () => {
      setPublishError(null);
      queryClient.invalidateQueries({ queryKey: ['contentHistory', brandId] });
    },
    onError: (error: Error) => {
      const errorMessage = error?.message || 'Failed to publish to Instagram. Please try again.';
      setPublishError(errorMessage);
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: (contentId: string) => contentApi.scheduleContent(contentId),
    onMutate: () => {
      setIsScheduling(true);
    },
    onSuccess: () => {
      setIsScheduling(false);
      queryClient.invalidateQueries({
        queryKey: ['content', 'scheduled', brandId],
      });
      queryClient.invalidateQueries({
        queryKey: ['content', 'pending', brandId],
      });
    },
    onError: (error: Error) => {
      setIsScheduling(false);
      const errorMessage = error?.message || 'Failed to schedule content. Please try again.';
      setPublishError(errorMessage);
    },
  });

  const handlePublish = () => {
    setPublishError(null);
    publishMutation.mutate(content.id);
  };

  const handleSchedule = () => {
    setPublishError(null);
    scheduleMutation.mutate(content.id);
  };

  const isConnected = connectionStatus === 'connected';

  return (
    <div
      className={`cursor-pointer overflow-hidden rounded-lg bg-white shadow-md transition-all hover:shadow-lg ${
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
          <div className="mb-2 flex items-center gap-2 rounded bg-yellow-50 p-2 text-xs text-yellow-600">
            <AlertTriangle className="h-4 w-4" />
            <span>Status may not be current - connection lost</span>
          </div>
        )}

        <div className="mb-3">
          <p className="text-sm leading-relaxed text-gray-900">{content.caption}</p>
        </div>

        <div className="mb-4">
          <div className="flex flex-wrap gap-1">
            {content.hashtags.map((tag, index) => (
              <span
                key={index}
                className="inline-block rounded bg-blue-100 px-2 py-1 text-xs text-blue-800"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusBadge
              status={localStatus}
              isLoading={isScheduling || isOptimistic}
              retryCount={0}
              className={`transition-all duration-500 ${
                isTransitioning ? 'scale-110 ring-2 ring-blue-400 ring-offset-2' : ''
              }`}
            />

            {isOptimistic && (
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <span>Updating...</span>
              </div>
            )}

            {isTransitioning && !isOptimistic && (
              <span className="animate-pulse text-xs font-medium text-green-600">Updated</span>
            )}
          </div>

          {content.status === 'draft' && (
            <div className="flex flex-col space-y-2">
              <div className="flex space-x-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSchedule();
                  }}
                  className="flex items-center gap-2 rounded bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isScheduling || !isConnected}
                >
                  {isScheduling ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Scheduling...
                    </>
                  ) : (
                    'Schedule'
                  )}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePublish();
                  }}
                  className="flex items-center gap-2 rounded bg-gradient-to-r from-purple-500 to-pink-500 px-4 py-2 text-sm text-white hover:from-purple-600 hover:to-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={publishMutation.isPending || !isConnected}
                >
                  {publishMutation.isPending ? (
                    <>
                      <div className="h-3 w-3 animate-spin rounded-full border border-white border-t-transparent"></div>
                      Publishing...
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2z" />
                        <path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" />
                        <circle cx="17.5" cy="6.5" r="1" />
                      </svg>
                      Publish Now
                    </>
                  )}
                </button>
              </div>
              {!isConnected && (
                <div className="rounded border border-yellow-200 bg-yellow-50 p-2">
                  <p className="text-xs text-yellow-800">
                    Actions disabled - waiting for connection
                  </p>
                </div>
              )}
              {publishError && (
                <div className="rounded border border-red-200 bg-red-50 p-2">
                  <p className="text-xs text-red-800">{publishError}</p>
                </div>
              )}
            </div>
          )}

          {content.status === 'published' && content.instagramPermalink && (
            <div className="flex space-x-2">
              <a
                href={content.instagramPermalink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 rounded bg-gray-100 px-3 py-1 text-sm text-gray-700 hover:bg-gray-200"
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
          <div className="mt-2 text-xs text-gray-500">
            Scheduled for:{' '}
            {formatInUserTimezone(content.scheduledAt, 'MMM d, yyyy h:mm a', brandTimezone)}
          </div>
        )}
      </div>
    </div>
  );
}
