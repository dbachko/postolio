import { memo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { AlertTriangle, RefreshCw, Clock, User } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

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
      : "recently";

    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <DialogTitle>Recent Edit Detected</DialogTitle>
            </div>
            <DialogDescription>
              This campaign was recently edited by another user
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Warning Card */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-600" />
                  <span className="text-sm text-amber-900">
                    Last edited <strong>{timeAgo}</strong>
                  </span>
                </div>
                {lastModifiedBy && (
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-amber-600" />
                    <span className="text-sm text-amber-900">
                      By: <strong>{lastModifiedBy}</strong>
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Explanation */}
            <div className="text-sm text-gray-600 space-y-2">
              <p>
                Someone else has modified this campaign within the last 5
                minutes. Your changes might conflict with theirs.
              </p>
              <p className="font-medium">What would you like to do?</p>
            </div>

            {/* Options */}
            <div className="bg-gray-50 rounded-lg p-3 space-y-2">
              <div className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-1.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Refresh</p>
                  <p className="text-xs text-gray-600">
                    Load the latest version and lose your current changes
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-600 mt-1.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    Continue Anyway
                  </p>
                  <p className="text-xs text-gray-600">
                    Keep editing with your current changes (may overwrite recent
                    edits)
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
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Refreshing...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh
                </>
              )}
            </Button>
            <Button
              onClick={onContinue}
              disabled={isRefreshing}
              className="flex-1"
            >
              Continue Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
);

ConcurrentEditWarning.displayName = "ConcurrentEditWarning";

export default ConcurrentEditWarning;
