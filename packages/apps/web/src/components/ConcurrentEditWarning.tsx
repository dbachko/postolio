import { memo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw, Clock, User } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface ConcurrentEditWarningProps {
  isOpen: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onContinue: () => void;
  lastModifiedAt?: string;
  lastModifiedBy?: string;
  isRefreshing?: boolean;
}

const ConcurrentEditWarning = memo(
  ({
    isOpen,
    onClose,
    onRefresh,
    onContinue,
    lastModifiedAt,
    lastModifiedBy,
    isRefreshing = false,
  }: ConcurrentEditWarningProps) => {
    const timeAgo = lastModifiedAt
      ? formatDistanceToNow(new Date(lastModifiedAt), { addSuffix: true })
      : 'recently';

    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="text-foreground h-5 w-5" />
              <DialogTitle>Recent Edit Detected</DialogTitle>
            </div>
            <DialogDescription>This campaign was recently edited by another user</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Warning Card */}
            <div className="bg-muted rounded-lg border p-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Clock className="text-foreground h-4 w-4" />
                  <span className="text-foreground text-sm">
                    Last edited <strong>{timeAgo}</strong>
                  </span>
                </div>
                {lastModifiedBy && (
                  <div className="flex items-center gap-2">
                    <User className="text-foreground h-4 w-4" />
                    <span className="text-foreground text-sm">
                      By: <strong>{lastModifiedBy}</strong>
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Explanation */}
            <div className="text-muted-foreground space-y-2 text-sm">
              <p>
                Someone else has modified this campaign within the last 5 minutes. Your changes
                might conflict with theirs.
              </p>
              <p className="font-medium">What would you like to do?</p>
            </div>

            {/* Options */}
            <div className="bg-muted space-y-2 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <div className="bg-foreground mt-1.5 h-1.5 w-1.5 rounded-full" />
                <div>
                  <p className="text-foreground text-sm font-medium">Refresh</p>
                  <p className="text-muted-foreground text-xs">
                    Load the latest version and lose your current changes
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="bg-foreground/70 mt-1.5 h-1.5 w-1.5 rounded-full" />
                <div>
                  <p className="text-foreground text-sm font-medium">Continue Anyway</p>
                  <p className="text-muted-foreground text-xs">
                    Keep editing with your current changes (may overwrite recent edits)
                  </p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="flex-1"
            >
              {isRefreshing ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Refreshing...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh
                </>
              )}
            </Button>
            <Button onClick={onContinue} disabled={isRefreshing} className="flex-1">
              Continue Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

ConcurrentEditWarning.displayName = 'ConcurrentEditWarning';

export default ConcurrentEditWarning;
