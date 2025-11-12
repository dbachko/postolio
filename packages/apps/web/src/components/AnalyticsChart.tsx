import { formatPercent } from '@/utils/formatNumber';

interface EngagementTrend {
  date: string;
  engagementRate: number;
}

interface OptimalTimeSlot {
  dayOfWeek: number;
  hour: number;
  engagementScore: number;
  sampleSize: number;
  dayName: string;
  timeFormatted: string;
}

interface AnalyticsChartProps {
  title: string;
  data: EngagementTrend[] | OptimalTimeSlot[];
  type: 'engagement' | 'optimal-times';
}

export default function AnalyticsChart({ title, data, type }: AnalyticsChartProps) {
  // Add null/undefined checks for data
  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <div className="bg-card rounded-lg p-6 shadow-md">
        <h3 className="mb-4 text-lg font-semibold">{title}</h3>
        <div className="text-muted-foreground py-8 text-center">
          No data available for this period
        </div>
      </div>
    );
  }

  if (type === 'engagement') {
    const engagementData = data as EngagementTrend[];
    const maxRate = Math.max(...engagementData.map((d) => d.engagementRate), 1);

    return (
      <div className="bg-card rounded-lg p-6 shadow-md">
        <h3 className="mb-4 text-lg font-semibold">{title}</h3>
        <div className="space-y-2">
          {engagementData.map((item, index) => (
            <div key={index} className="flex items-center space-x-3">
              <span className="text-muted-foreground w-24 text-sm">
                {new Date(item.date).toLocaleDateString()}
              </span>
              <div className="bg-muted relative h-4 flex-1 rounded-full">
                <div
                  className="h-4 rounded-full transition-all duration-300"
                  style={{
                    width: `${(item.engagementRate / maxRate) * 100}%`,
                    backgroundColor: 'var(--chart-1)',
                  }}
                />
              </div>
              <span className="w-12 text-sm font-medium">{formatPercent(item.engagementRate)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const optimalData = data as OptimalTimeSlot[];

  return (
    <div className="bg-card rounded-lg p-6 shadow-md">
      <h3 className="mb-4 text-lg font-semibold">{title}</h3>
      <div className="grid gap-3">
        {optimalData.slice(0, 5).map((slot, index) => (
          <div key={index} className="bg-muted flex items-center justify-between rounded-lg p-3">
            <div>
              <div className="font-medium">{slot.dayName}</div>
              <div className="text-muted-foreground text-sm">{slot.timeFormatted}</div>
            </div>
            <div className="text-right">
              <div className="text-foreground font-semibold">
                {formatPercent(slot.engagementScore)}
              </div>
              <div className="text-muted-foreground text-xs">{slot.sampleSize} posts</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
