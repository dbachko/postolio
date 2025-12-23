import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TrendingUp, TrendingDown, Minus, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
  Line,
} from 'recharts';
import { useState } from 'react';
import { formatNumber, formatPercent } from '@/utils/formatNumber';

interface ForecastDataPoint {
  date: string;
  predicted: number;
  confidence: {
    lower: number;
    upper: number;
  };
}

interface ForecastData {
  current: number;
  predicted: ForecastDataPoint[];
  trend: 'increasing' | 'decreasing' | 'stable';
  confidence: number;
}

interface ForecastChartsProps {
  forecasts?: {
    engagement?: ForecastData;
    followerGrowth?: ForecastData & { expectedGrowth: number; expectedFollowers: number };
    engagementRate?: ForecastData;
    reach?: ForecastData & { expectedReach: number };
  };
  loading?: boolean;
}

type MetricType = 'engagement' | 'followerGrowth' | 'engagementRate' | 'reach';

export function ForecastCharts({ forecasts: forecastsProp, loading }: ForecastChartsProps) {
  // Ensure a defined object for safer narrowing below
  const forecasts = forecastsProp ?? ({} as NonNullable<ForecastChartsProps['forecasts']>);
  const [selectedMetric, setSelectedMetric] = useState<MetricType>('engagement');

  // Keep header + selector visible even when loading or no data
  const fc = forecasts && forecasts[selectedMetric];
  const hasData = Boolean(fc && fc.predicted?.length);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <CardTitle>Predictive Forecast</CardTitle>
            </div>
            <Select
              value={selectedMetric}
              onValueChange={(v) => setSelectedMetric(v as MetricType)}
            >
              <SelectTrigger className="w-full sm:w-[180px]" disabled>
                <SelectValue />
              </SelectTrigger>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-80 w-full" />
        </CardContent>
      </Card>
    );
  }

  // If no data for selected metric, render an empty state but keep the selector visible
  if (!hasData) {
    return (
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <CardTitle>Predictive Forecast</CardTitle>
            </div>
            <Select
              value={selectedMetric}
              onValueChange={(v) => setSelectedMetric(v as MetricType)}
            >
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="engagement">Engagement</SelectItem>
                <SelectItem value="followerGrowth">Follower Growth</SelectItem>
                <SelectItem value="engagementRate">Engagement Rate</SelectItem>
                <SelectItem value="reach">Reach</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground py-12 text-center">
            <div className="mb-4">
              <TrendingUp className="mx-auto h-12 w-12 opacity-50" />
            </div>
            <p className="text-sm">Insufficient data for forecasting</p>
            <p className="text-xs">Try another metric from the dropdown</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const currentForecast = fc!;

  // Prepare chart data
  const chartData = currentForecast.predicted.map((point) => ({
    date: new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    predicted: Math.round(point.predicted),
    lower: Math.round(point.confidence.lower),
    upper: Math.round(point.confidence.upper),
  }));

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'increasing':
        return <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />;
      case 'decreasing':
        return <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />;
      default:
        return <Minus className="h-4 w-4 text-gray-600 dark:text-gray-400" />;
    }
  };

  const getTrendColor = (trend: string) => {
    switch (trend) {
      case 'increasing':
        return 'text-green-600 dark:text-green-400';
      case 'decreasing':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };

  const formatValue = (value: number, metric: MetricType) => {
    if (metric === 'engagementRate') {
      return formatPercent(value, 2);
    }
    return formatNumber(value);
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 75) return 'text-green-600 dark:text-green-400';
    if (confidence >= 50) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-orange-600 dark:text-orange-400';
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 75) return 'High Confidence';
    if (confidence >= 50) return 'Medium Confidence';
    return 'Low Confidence';
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>Predictive Forecast</CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="text-muted-foreground h-4 w-4" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">
                    AI-powered predictions based on your historical performance. Shaded area shows
                    confidence interval.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <Select value={selectedMetric} onValueChange={(v) => setSelectedMetric(v as MetricType)}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="engagement">Engagement</SelectItem>
              <SelectItem value="followerGrowth">Follower Growth</SelectItem>
              <SelectItem value="engagementRate">Engagement Rate</SelectItem>
              <SelectItem value="reach">Reach</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {/* Metric Summary */}
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="border-border/50 bg-card/50 rounded-lg border p-3">
            <div className="text-muted-foreground mb-1 text-xs">Current</div>
            <div className="text-lg font-bold">
              {formatValue(currentForecast.current, selectedMetric)}
            </div>
          </div>

          <div className="border-border/50 bg-card/50 rounded-lg border p-3">
            <div className="text-muted-foreground mb-1 text-xs">Predicted (30d)</div>
            <div className="text-lg font-bold">
              {formatValue(
                currentForecast.predicted[currentForecast.predicted.length - 1]?.predicted || 0,
                selectedMetric
              )}
            </div>
          </div>

          <div className="border-border/50 bg-card/50 rounded-lg border p-3">
            <div className="text-muted-foreground mb-1 text-xs">Trend</div>
            <div
              className={`flex items-center gap-1 font-medium ${getTrendColor(currentForecast.trend)}`}
            >
              {getTrendIcon(currentForecast.trend)}
              <span className="text-sm capitalize">{currentForecast.trend}</span>
            </div>
          </div>

          <div className="border-border/50 bg-card/50 rounded-lg border p-3">
            <div className="text-muted-foreground mb-1 text-xs">Confidence</div>
            <div className="flex items-center gap-2">
              <span
                className={`text-lg font-bold ${getConfidenceColor(currentForecast.confidence)}`}
              >
                {currentForecast.confidence}%
              </span>
              <Badge variant="outline" className="text-xs">
                {getConfidenceLabel(currentForecast.confidence)}
              </Badge>
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="confidenceGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} className="text-muted-foreground" />
              <YAxis
                tick={{ fontSize: 12 }}
                className="text-muted-foreground"
                tickFormatter={(value: number) => formatValue(value, selectedMetric)}
              />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: 'hsl(var(--foreground))' }}
                formatter={(value: unknown, name?: string) => {
                  const label = name ?? '';
                  const numericValue = typeof value === 'number' ? value : Number(value);
                  const formattedValue = Number.isFinite(numericValue)
                    ? formatValue(numericValue, selectedMetric)
                    : String(value);

                  if (label === 'Predicted') return [formattedValue, label];
                  if (label === 'Lower Bound') return [formattedValue, label];
                  if (label === 'Upper Bound') return [formattedValue, label];
                  return [value as any, label];
                }}
              />
              <Legend />

              {/* Confidence interval area */}
              <Area
                type="monotone"
                dataKey="upper"
                stroke="none"
                fill="url(#confidenceGradient)"
                name="Confidence Interval"
              />
              <Area type="monotone" dataKey="lower" stroke="none" fill="#ffffff" name="" />

              {/* Prediction line */}
              <Line
                type="monotone"
                dataKey="predicted"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                name="Predicted"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Legend explanation */}
        <div className="bg-muted/50 mt-4 flex items-start gap-2 rounded-md p-3 text-xs">
          <Info className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
          <div className="text-muted-foreground">
            <span className="font-medium">How to read this chart:</span> The blue line shows
            predicted values. The shaded area represents the confidence interval - actual values are
            likely to fall within this range. Confidence decreases for predictions further in the
            future.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
