
interface EngagementTrend {
  date: string
  engagementRate: number
}

interface OptimalTimeSlot {
  dayOfWeek: number
  hour: number
  engagementScore: number
  sampleSize: number
  dayName: string
  timeFormatted: string
}

interface AnalyticsChartProps {
  title: string
  data: EngagementTrend[] | OptimalTimeSlot[]
  type: 'engagement' | 'optimal-times'
}

export default function AnalyticsChart({ title, data, type }: AnalyticsChartProps) {
  if (type === 'engagement') {
    const engagementData = data as EngagementTrend[]
    const maxRate = Math.max(...engagementData.map(d => d.engagementRate))
    
    return (
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h3 className="text-lg font-semibold mb-4">{title}</h3>
        <div className="space-y-2">
          {engagementData.map((item, index) => (
            <div key={index} className="flex items-center space-x-3">
              <span className="text-sm text-gray-600 w-24">
                {new Date(item.date).toLocaleDateString()}
              </span>
              <div className="flex-1 bg-gray-200 rounded-full h-4 relative">
                <div
                  className="bg-blue-500 h-4 rounded-full transition-all duration-300"
                  style={{ width: `${(item.engagementRate / maxRate) * 100}%` }}
                />
              </div>
              <span className="text-sm font-medium w-12">
                {item.engagementRate.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const optimalData = data as OptimalTimeSlot[]
  
  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h3 className="text-lg font-semibold mb-4">{title}</h3>
      <div className="grid gap-3">
        {optimalData.slice(0, 5).map((slot, index) => (
          <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div>
              <div className="font-medium">{slot.dayName}</div>
              <div className="text-sm text-gray-600">{slot.timeFormatted}</div>
            </div>
            <div className="text-right">
              <div className="font-semibold text-green-600">
                {slot.engagementScore.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500">
                {slot.sampleSize} posts
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}