import SchedulingPanel from '../SchedulingPanel';

interface SchedulingStats {
  scheduled: number;
  posted: number;
  failed: number;
  draft: number;
}

interface ScheduledPost {
  id: string;
  caption: string;
  imageUrl: string;
  hashtags?: string[];
  scheduledTime: string;
  status: string;
}

interface AnalyticsSchedulingTabProps {
  schedulingStats: SchedulingStats | null;
  scheduledPosts: ScheduledPost[];
  onCancelPost: (contentId: string) => Promise<void>;
  onReschedulePost: (contentId: string, newTime: string) => Promise<void>;
}

export function AnalyticsSchedulingTab({
  schedulingStats,
  scheduledPosts,
  onCancelPost,
  onReschedulePost,
}: AnalyticsSchedulingTabProps) {
  return (
    <div className="space-y-6">
      {schedulingStats && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
          <div className="bg-card rounded-lg p-6 shadow-md">
            <h3 className="text-muted-foreground text-sm font-medium">Scheduled</h3>
            <p className="text-foreground text-2xl font-bold">{schedulingStats.scheduled}</p>
          </div>
          <div className="bg-card rounded-lg p-6 shadow-md">
            <h3 className="text-muted-foreground text-sm font-medium">Posted</h3>
            <p className="text-foreground text-2xl font-bold">{schedulingStats.posted}</p>
          </div>
          <div className="bg-card rounded-lg p-6 shadow-md">
            <h3 className="text-muted-foreground text-sm font-medium">Failed</h3>
            <p className="text-foreground text-2xl font-bold">{schedulingStats.failed}</p>
          </div>
          <div className="bg-card rounded-lg p-6 shadow-md">
            <h3 className="text-muted-foreground text-sm font-medium">Draft</h3>
            <p className="text-foreground text-2xl font-bold">{schedulingStats.draft}</p>
          </div>
        </div>
      )}
      <SchedulingPanel
        scheduledPosts={scheduledPosts}
        onCancelPost={onCancelPost}
        onReschedulePost={onReschedulePost}
      />
    </div>
  );
}
