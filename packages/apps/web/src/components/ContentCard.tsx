import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiClient, type Content } from "../lib/api";
import { OptimizedImage } from "./OptimizedImage";
import { formatInUserTimezone } from "../lib/timezone";
import { useTimezone } from "../contexts/TimezoneContext";
// import { useSchedulingWebSocket } from '../hooks/useSchedulingWebSocket'
import { StatusBadge } from "./StatusBadge";
import { Loader2, AlertTriangle } from "lucide-react";

interface ContentCardProps {
  content: Content;
  brandId: string;
  isOptimistic?: boolean;
}

export function ContentCard({
  content,
  brandId,
  isOptimistic = false,
}: ContentCardProps) {
  const [publishError, setPublishError] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState(content.status);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const queryClient = useQueryClient();
  const { timezone } = useTimezone();
  const navigate = useNavigate();
  // const { connectionStatus } = useSchedulingWebSocket()
  const connectionStatus = "connected"; // Default to connected for now

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
    mutationFn: (contentId: string) => apiClient.publishToInstagram(contentId),
    onSuccess: () => {
      setPublishError(null);
      queryClient.invalidateQueries({ queryKey: ["contentHistory", brandId] });
    },
    onError: (error: Error) => {
      const errorMessage =
        error?.message || "Failed to publish to Instagram. Please try again.";
      setPublishError(errorMessage);
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: (contentId: string) => apiClient.scheduleContent(contentId),
    onMutate: () => {
      setIsScheduling(true);
    },
    onSuccess: () => {
      setIsScheduling(false);
      queryClient.invalidateQueries({
        queryKey: ["content", "scheduled", brandId],
      });
      queryClient.invalidateQueries({
        queryKey: ["content", "pending", brandId],
      });
    },
    onError: (error: Error) => {
      setIsScheduling(false);
      const errorMessage =
        error?.message || "Failed to schedule content. Please try again.";
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

  const isConnected = connectionStatus === "connected";

  return (
    <div
      className={`bg-white rounded-lg shadow-md overflow-hidden cursor-pointer hover:shadow-lg transition-all ${
        !isConnected ? "opacity-75" : ""
      }`}
      onClick={() => navigate(`/posts/${content.id}`)}
    >
      {content.cdnImageUrl && (
        <div className="aspect-w-16 aspect-h-9">
          <OptimizedImage
            src={content.cdnImageUrl}
            cdnUrl={content.cdnImageUrl}
            fallbackUrl={undefined}
            alt="Generated content"
            className="w-full h-48 object-cover"
            aspectRatio="landscape"
          />
        </div>
      )}

      <div className="p-4">
        {/* Stale data indicator */}
        {!isConnected && content.status === "scheduled" && (
          <div className="flex items-center gap-2 text-xs text-yellow-600 mb-2 p-2 bg-yellow-50 rounded">
            <AlertTriangle className="w-4 h-4" />
            <span>Status may not be current - connection lost</span>
          </div>
        )}

        <div className="mb-3">
          <p className="text-gray-900 text-sm leading-relaxed">
            {content.caption}
          </p>
        </div>

        <div className="mb-4">
          <div className="flex flex-wrap gap-1">
            {content.hashtags.map((tag, index) => (
              <span
                key={index}
                className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded"
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
                isTransitioning
                  ? "scale-110 ring-2 ring-offset-2 ring-blue-400"
                  : ""
              }`}
            />

            {isOptimistic && (
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <span>Updating...</span>
              </div>
            )}

            {isTransitioning && !isOptimistic && (
              <span className="text-xs text-green-600 font-medium animate-pulse">
                Updated
              </span>
            )}
          </div>

          {content.status === "draft" && (
            <div className="flex flex-col space-y-2">
              <div className="flex space-x-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSchedule();
                  }}
                  className="bg-blue-500 text-white px-4 py-2 rounded text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  disabled={isScheduling || !isConnected}
                >
                  {isScheduling ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Scheduling...
                    </>
                  ) : (
                    "Schedule"
                  )}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePublish();
                  }}
                  className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded text-sm hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  disabled={publishMutation.isPending || !isConnected}
                >
                  {publishMutation.isPending ? (
                    <>
                      <div className="animate-spin rounded-full h-3 w-3 border border-white border-t-transparent"></div>
                      Publishing...
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-4 h-4"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
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
                <div className="bg-yellow-50 border border-yellow-200 rounded p-2">
                  <p className="text-xs text-yellow-800">
                    Actions disabled - waiting for connection
                  </p>
                </div>
              )}
              {publishError && (
                <div className="bg-red-50 border border-red-200 rounded p-2">
                  <p className="text-xs text-red-800">{publishError}</p>
                </div>
              )}
            </div>
          )}

          {content.status === "published" && content.instagramPermalink && (
            <div className="flex space-x-2">
              <a
                href={content.instagramPermalink}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-gray-100 text-gray-700 px-3 py-1 rounded text-sm hover:bg-gray-200 flex items-center gap-1"
              >
                <svg
                  className="w-3 h-3"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
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
            Scheduled for:{" "}
            {formatInUserTimezone(
              content.scheduledAt,
              "MMM d, yyyy h:mm a",
              timezone,
            )}
          </div>
        )}
      </div>
    </div>
  );
}
