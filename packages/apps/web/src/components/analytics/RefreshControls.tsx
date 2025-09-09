import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { RefreshCw, Clock, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface RefreshControlsProps {
  onRefresh: () => void;
  isRefreshing: boolean;
  lastUpdated?: string | null;
  rateLimitRemaining?: number;
}

export function RefreshControls({
  onRefresh,
  isRefreshing,
  lastUpdated,
  rateLimitRemaining = 200,
}: RefreshControlsProps) {
  const isRateLimited = rateLimitRemaining < 10;
  const isLowOnRequests = rateLimitRemaining < 50;

  const getStatusColor = () => {
    if (isRateLimited) return "bg-red-100 text-red-800";
    if (isLowOnRequests) return "bg-yellow-100 text-yellow-800";
    return "bg-green-100 text-green-800";
  };

  const getStatusIcon = () => {
    if (isRateLimited) return <AlertTriangle className="h-3 w-3" />;
    return <Clock className="h-3 w-3" />;
  };

  return (
    <div className="flex items-center gap-2">
      {/* Rate Limit Status */}
      <Badge variant="outline" className={getStatusColor()}>
        {getStatusIcon()}
        <span className="ml-1">{rateLimitRemaining}/200 requests</span>
      </Badge>

      {/* Last Updated */}
      {lastUpdated && (
        <span className="text-sm text-muted-foreground">
          Updated{" "}
          {formatDistanceToNow(new Date(lastUpdated), { addSuffix: true })}
        </span>
      )}

      {/* Refresh Button */}
      <Button
        onClick={onRefresh}
        disabled={isRefreshing || isRateLimited}
        size="sm"
        variant="outline"
      >
        <RefreshCw
          className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`}
        />
        {isRefreshing ? "Refreshing..." : "Refresh"}
      </Button>
    </div>
  );
}
