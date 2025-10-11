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
      <div className="rounded-lg bg-white p-6 shadow-md">
        <h3 className="mb-4 text-lg font-semibold">{title}</h3>
        <div className="py-8 text-center text-gray-500">No data available for this period</div>
      </div>
    );
  }

  if (type === 'engagement') {
    const engagementData = data as EngagementTrend[];
    const maxRate = Math.max(...engagementData.map((d) => d.engagementRate), 1);

    return (
      <div className="rounded-lg bg-white p-6 shadow-md">
        <h3 className="mb-4 text-lg font-semibold">{title}</h3>
        <div className="space-y-2">
          {engagementData.map((item, index) => (
            <div key={index} className="flex items-center space-x-3">
              <span className="w-24 text-sm text-gray-600">
                {new Date(item.date).toLocaleDateString()}
              </span>
              <div className="relative h-4 flex-1 rounded-full bg-gray-200">
                <div
                  className="h-4 rounded-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${(item.engagementRate / maxRate) * 100}%` }}
                />
              </div>
              <span className="w-12 text-sm font-medium">{item.engagementRate.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const optimalData = data as OptimalTimeSlot[];

  return (
    <div className="rounded-lg bg-white p-6 shadow-md">
      <h3 className="mb-4 text-lg font-semibold">{title}</h3>
      <div className="grid gap-3">
        {optimalData.slice(0, 5).map((slot, index) => (
          <div key={index} className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
            <div>
              <div className="font-medium">{slot.dayName}</div>
              <div className="text-sm text-gray-600">{slot.timeFormatted}</div>
            </div>
            <div className="text-right">
              <div className="font-semibold text-green-600">{slot.engagementScore.toFixed(1)}%</div>
              <div className="text-xs text-gray-500">{slot.sampleSize} posts</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
