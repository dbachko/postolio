interface SchedulingStats {
  scheduled: number;
  posted: number;
  failed: number;
  draft: number;
}

interface AnalyticsSchedulingTabProps {
  schedulingStats: SchedulingStats | null;
}

export function AnalyticsSchedulingTab({ schedulingStats }: AnalyticsSchedulingTabProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
        <div className="bg-card rounded-lg p-6 shadow-md">
          <h3 className="text-muted-foreground text-sm font-medium">Scheduled</h3>
          <p className="text-foreground text-2xl font-bold">{schedulingStats?.scheduled ?? 0}</p>
        </div>
        <div className="bg-card rounded-lg p-6 shadow-md">
          <h3 className="text-muted-foreground text-sm font-medium">Posted</h3>
          <p className="text-foreground text-2xl font-bold">{schedulingStats?.posted ?? 0}</p>
        </div>
        <div className="bg-card rounded-lg p-6 shadow-md">
          <h3 className="text-muted-foreground text-sm font-medium">Failed</h3>
          <p className="text-foreground text-2xl font-bold">{schedulingStats?.failed ?? 0}</p>
        </div>
        <div className="bg-card rounded-lg p-6 shadow-md">
          <h3 className="text-muted-foreground text-sm font-medium">Draft</h3>
          <p className="text-foreground text-2xl font-bold">{schedulingStats?.draft ?? 0}</p>
        </div>
      </div>
    </div>
  );
}
