import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar
} from 'recharts'
import { format, parseISO } from 'date-fns'

interface PostData {
  id: string
  caption: string
  impressions: number
  engagement: number
  media_url: string
  posted_at: string
}

interface EngagementChartProps {
  data: PostData[]
  type?: 'line' | 'bar'
}

export function EngagementChart({ data, type = 'bar' }: EngagementChartProps) {
  // Transform data for the chart
  const chartData = data
    .map((post, index) => ({
      name: `Post ${index + 1}`,
      date: format(parseISO(post.posted_at), 'MMM dd'),
      impressions: post.impressions,
      engagement: post.engagement,
      engagementRate: post.impressions > 0 ? (post.engagement / post.impressions) * 100 : 0,
      caption: post.caption.length > 30 ? post.caption.substring(0, 30) + '...' : post.caption
    }))
    .reverse() // Show oldest first (chronological order)

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload
      return (
        <div className="bg-white p-3 border rounded-lg shadow-lg">
          <p className="font-medium">{`${label} (${data.date})`}</p>
          <p className="text-sm text-muted-foreground mb-2">{data.caption}</p>
          <p className="text-blue-600">
            Impressions: {payload[0].value.toLocaleString()}
          </p>
          <p className="text-green-600">
            Engagement: {payload[1].value.toLocaleString()}
          </p>
          <p className="text-purple-600">
            Rate: {data.engagementRate.toFixed(1)}%
          </p>
        </div>
      )
    }
    return null
  }

  if (type === 'line') {
    return (
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="name" 
              tick={{ fontSize: 12 }}
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="impressions"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 4 }}
              name="Impressions"
            />
            <Line
              type="monotone"
              dataKey="engagement"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ r: 4 }}
              name="Engagement"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    )
  }

  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis 
            dataKey="name" 
            tick={{ fontSize: 12 }}
            angle={-45}
            textAnchor="end"
            height={60}
          />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip content={<CustomTooltip />} />
          <Bar 
            dataKey="impressions" 
            fill="#3b82f6" 
            name="Impressions"
            radius={[2, 2, 0, 0]}
          />
          <Bar 
            dataKey="engagement" 
            fill="#10b981" 
            name="Engagement"
            radius={[2, 2, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}