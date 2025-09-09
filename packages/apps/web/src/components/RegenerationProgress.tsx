import { memo, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { Badge } from "./ui/badge";
import { CheckCircle, RefreshCw, XCircle, AlertCircle } from "lucide-react";

interface RegenerationProgressProps {
  isOpen: boolean;
  onClose: () => void;
  jobId: string | null;
  totalContent: number;
  onComplete?: () => void;
}

interface ProgressData {
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  total: number;
  completed: number;
  failed: number;
  errors?: string[];
}

const RegenerationProgress = memo(
  ({
    isOpen,
    onClose,
    jobId,
    totalContent,
    onComplete,
  }: RegenerationProgressProps) => {
    const [progressData, setProgressData] = useState<ProgressData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isPolling, setIsPolling] = useState(false);

    // Poll for progress updates
    useEffect(() => {
      if (!isOpen || !jobId) {
        setIsPolling(false);
        return;
      }

      setIsPolling(true);
      const pollProgress = async () => {
        try {
          const response = await fetch(
            `/api/campaigns/regeneration-jobs/${jobId}`,
            {
              headers: {
                Authorization: `Bearer ${localStorage.getItem("token")}`,
              },
            },
          );

          if (!response.ok) {
            throw new Error("Failed to fetch progress");
          }

          const result = await response.json();
          setProgressData(result.data);

          // Stop polling if completed or failed
          if (
            result.data.status === "completed" ||
            result.data.status === "failed"
          ) {
            setIsPolling(false);
            if (result.data.status === "completed" && onComplete) {
              // Delay callback to show completion state
              setTimeout(onComplete, 2000);
            }
          }
        } catch (err) {
          console.error("Progress polling error:", err);
          setError(err instanceof Error ? err.message : "Unknown error");
          setIsPolling(false);
        }
      };

      // Initial poll
      pollProgress();

      // Set up polling interval (every 2 seconds)
      const interval = setInterval(pollProgress, 2000);

      return () => {
        clearInterval(interval);
        setIsPolling(false);
      };
    }, [isOpen, jobId, onComplete]);

    const getStatusIcon = () => {
      if (!progressData)
        return <RefreshCw className="w-5 h-5 animate-spin text-blue-600" />;

      switch (progressData.status) {
        case "completed":
          return <CheckCircle className="w-5 h-5 text-green-600" />;
        case "failed":
          return <XCircle className="w-5 h-5 text-red-600" />;
        case "processing":
          return <RefreshCw className="w-5 h-5 animate-spin text-blue-600" />;
        default:
          return <AlertCircle className="w-5 h-5 text-yellow-600" />;
      }
    };

    const getStatusText = () => {
      if (!progressData) return "Initializing...";

      switch (progressData.status) {
        case "pending":
          return "Queued for processing...";
        case "processing":
          return "Regenerating content...";
        case "completed":
          return "Regeneration completed!";
        case "failed":
          return "Regeneration failed";
        default:
          return "Unknown status";
      }
    };

    const getStatusColor = () => {
      if (!progressData) return "bg-blue-50 border-blue-200";

      switch (progressData.status) {
        case "completed":
          return "bg-green-50 border-green-200";
        case "failed":
          return "bg-red-50 border-red-200";
        case "processing":
          return "bg-blue-50 border-blue-200";
        default:
          return "bg-yellow-50 border-yellow-200";
      }
    };

    const estimatedTimeRemaining = () => {
      if (!progressData || progressData.status !== "processing") return null;

      const remaining = progressData.total - progressData.completed;
      const avgTimePerItem = 7.5; // seconds
      return Math.ceil(remaining * avgTimePerItem);
    };

    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <div className="flex items-center gap-2">
              {getStatusIcon()}
              <DialogTitle>Content Regeneration Progress</DialogTitle>
            </div>
            <DialogDescription>{getStatusText()}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <span>
                  {progressData
                    ? `${progressData.completed}/${progressData.total}`
                    : `0/${totalContent}`}
                </span>
              </div>
              <Progress
                value={progressData ? progressData.progress : 0}
                className="w-full"
              />
              <div className="text-xs text-gray-500 text-center">
                {progressData ? `${Math.round(progressData.progress)}%` : "0%"}{" "}
                complete
              </div>
            </div>

            {/* Status Card */}
            <div className={`rounded-lg p-4 border ${getStatusColor()}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium">{getStatusText()}</h4>
                  {progressData?.status === "processing" && (
                    <p className="text-sm text-gray-600 mt-1">
                      {progressData.completed} posts completed •{" "}
                      {progressData.total - progressData.completed} remaining
                      {estimatedTimeRemaining() && (
                        <span className="block">
                          ~{estimatedTimeRemaining()} seconds remaining
                        </span>
                      )}
                    </p>
                  )}
                  {progressData?.status === "completed" && (
                    <p className="text-sm text-green-700 mt-1">
                      All {progressData.completed} posts have been successfully
                      regenerated
                    </p>
                  )}
                  {progressData?.status === "failed" && (
                    <p className="text-sm text-red-700 mt-1">
                      Regeneration failed. You can try again or contact support.
                    </p>
                  )}
                </div>
                <Badge
                  variant={
                    progressData?.status === "completed"
                      ? "default"
                      : "secondary"
                  }
                  className={
                    progressData?.status === "completed"
                      ? "bg-green-100 text-green-800"
                      : progressData?.status === "failed"
                        ? "bg-red-100 text-red-800"
                        : progressData?.status === "processing"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-yellow-100 text-yellow-800"
                  }
                >
                  {progressData?.status || "pending"}
                </Badge>
              </div>
            </div>

            {/* Error Details */}
            {progressData?.errors && progressData.errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <h4 className="text-sm font-medium text-red-900 mb-2">
                  Errors:
                </h4>
                <ul className="text-xs text-red-700 space-y-1">
                  {progressData.errors.slice(0, 3).map((error, index) => (
                    <li key={index}>• {error}</li>
                  ))}
                  {progressData.errors.length > 3 && (
                    <li>• ...and {progressData.errors.length - 3} more</li>
                  )}
                </ul>
              </div>
            )}

            {/* Generic Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              variant={
                progressData?.status === "completed" ? "default" : "outline"
              }
              onClick={onClose}
              disabled={isPolling && progressData?.status === "processing"}
            >
              {progressData?.status === "completed" ? "Done" : "Close"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  },
);

RegenerationProgress.displayName = "RegenerationProgress";

export default RegenerationProgress;
