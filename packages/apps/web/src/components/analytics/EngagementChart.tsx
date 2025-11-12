import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { formatPercent } from '@/utils/formatNumber';

interface PostData {
  id: string;
  caption: string;
  impressions: number;
  engagement: number;
  media_url: string;
  posted_at: string;
}

interface EngagementChartProps {
  data: PostData[];
  type?: 'line' | 'bar';
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
      caption: post.caption.length > 30 ? post.caption.substring(0, 30) + '...' : post.caption,
    }))
    .reverse(); // Show oldest first (chronological order)

  interface CustomTooltipProps {
    active?: boolean;
    payload?: {
      payload: {
        name: string;
        date: string;
        impressions: number;
        engagement: number;
        engagementRate: number;
        caption: string;
      };
      value: number;
    }[];
    label?: string | number;
  }

  const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-background rounded-lg border p-3 shadow-lg">
          <p className="font-medium">{`${label} (${data.date})`}</p>
          <p className="text-muted-foreground mb-2 text-sm">{data.caption}</p>
          <p className="text-foreground">Impressions: {payload[0].value.toLocaleString()}</p>
          <p className="text-foreground">Engagement: {payload[1].value.toLocaleString()}</p>
          <p className="text-foreground">Rate: {formatPercent(data.engagementRate)}</p>
        </div>
      );
    }
    return null;
  };

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
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={{ r: 4 }}
              name="Impressions"
            />
            <Line
              type="monotone"
              dataKey="engagement"
              stroke="var(--chart-2)"
              strokeWidth={2}
              dot={{ r: 4 }}
              name="Engagement"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} angle={-45} textAnchor="end" height={60} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip content={<CustomTooltip />} />
          <Bar
            dataKey="impressions"
            fill="var(--chart-1)"
            name="Impressions"
            radius={[2, 2, 0, 0]}
          />
          <Bar dataKey="engagement" fill="var(--chart-2)" name="Engagement" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
