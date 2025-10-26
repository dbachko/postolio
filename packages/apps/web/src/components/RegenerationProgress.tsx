import { memo, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, RefreshCw, XCircle, AlertCircle } from 'lucide-react';

interface RegenerationProgressProps {
  isOpen: boolean;
  onClose: () => void;
  jobId: string | null;
  totalContent: number;
  onComplete?: () => void;
}

interface ProgressData {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  total: number;
  completed: number;
  failed: number;
  errors?: string[];
}

const RegenerationProgress = memo(
  ({ isOpen, onClose, jobId, totalContent, onComplete }: RegenerationProgressProps) => {
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
          const response = await fetch(`/api/campaigns/regeneration-jobs/${jobId}`, {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('token')}`,
            },
          });

          if (!response.ok) {
            throw new Error('Failed to fetch progress');
          }

          const result = await response.json();
          setProgressData(result.data);

          // Stop polling if completed or failed
          if (result.data.status === 'completed' || result.data.status === 'failed') {
            setIsPolling(false);
            if (result.data.status === 'completed' && onComplete) {
              // Delay callback to show completion state
              setTimeout(onComplete, 2000);
            }
          }
        } catch (err) {
          console.error('Progress polling error:', err);
          setError(err instanceof Error ? err.message : 'Unknown error');
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
      if (!progressData) return <RefreshCw className="text-foreground h-5 w-5 animate-spin" />;

      switch (progressData.status) {
        case 'completed':
          return <CheckCircle className="text-foreground h-5 w-5" />;
        case 'failed':
          return <XCircle className="text-destructive h-5 w-5" />;
        case 'processing':
          return <RefreshCw className="text-foreground h-5 w-5 animate-spin" />;
        default:
          return <AlertCircle className="text-foreground h-5 w-5" />;
      }
    };

    const getStatusText = () => {
      if (!progressData) return 'Initializing...';

      switch (progressData.status) {
        case 'pending':
          return 'Queued for processing...';
        case 'processing':
          return 'Regenerating content...';
        case 'completed':
          return 'Regeneration completed!';
        case 'failed':
          return 'Regeneration failed';
        default:
          return 'Unknown status';
      }
    };

    const getStatusColor = () => {
      return 'bg-muted border';
    };

    const estimatedTimeRemaining = () => {
      if (!progressData || progressData.status !== 'processing') return null;

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
              <Progress value={progressData ? progressData.progress : 0} className="w-full" />
              <div className="text-muted-foreground text-center text-xs">
                {progressData ? `${Math.round(progressData.progress)}%` : '0%'} complete
              </div>
            </div>

            {/* Status Card */}
            <div className={`rounded-lg border p-4 ${getStatusColor()}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium">{getStatusText()}</h4>
                  {progressData?.status === 'processing' && (
                    <p className="text-muted-foreground mt-1 text-sm">
                      {progressData.completed} posts completed •{' '}
                      {progressData.total - progressData.completed} remaining
                      {estimatedTimeRemaining() && (
                        <span className="block">~{estimatedTimeRemaining()} seconds remaining</span>
                      )}
                    </p>
                  )}
                  {progressData?.status === 'completed' && (
                    <p className="text-foreground mt-1 text-sm">
                      All {progressData.completed} posts have been successfully regenerated
                    </p>
                  )}
                  {progressData?.status === 'failed' && (
                    <p className="text-destructive mt-1 text-sm">
                      Regeneration failed. You can try again or contact support.
                    </p>
                  )}
                </div>
                <Badge
                  variant={
                    progressData?.status === 'failed'
                      ? 'destructive'
                      : progressData?.status === 'completed'
                        ? 'default'
                        : 'secondary'
                  }
                  className="capitalize"
                >
                  {progressData?.status || 'pending'}
                </Badge>
              </div>
            </div>

            {/* Error Details */}
            {progressData?.errors && progressData.errors.length > 0 && (
              <div className="bg-muted rounded-lg border p-3">
                <h4 className="text-foreground mb-2 text-sm font-medium">Errors:</h4>
                <ul className="text-muted-foreground space-y-1 text-xs">
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
              <div className="border-destructive/20 bg-destructive/10 rounded-lg border p-3">
                <p className="text-destructive text-sm">{error}</p>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              variant={progressData?.status === 'completed' ? 'default' : 'outline'}
              onClick={onClose}
              disabled={isPolling && progressData?.status === 'processing'}
            >
              {progressData?.status === 'completed' ? 'Done' : 'Close'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
);

RegenerationProgress.displayName = 'RegenerationProgress';

export default RegenerationProgress;
