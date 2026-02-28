import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Info, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ForecastChartsHeader } from './components/forecast-charts-header';
import type { ForecastChartsProps, MetricType } from './types';
import {
  formatForecastValue,
  getConfidenceLabel,
  getConfidenceTextClass,
  getTrendTextClass,
  toForecastChartData,
} from './utils';

function getTrendIcon(trend: string) {
  if (trend === 'increasing') {
    return <TrendingUp className="text-primary h-4 w-4" />;
  }
  if (trend === 'decreasing') {
    return <TrendingDown className="text-destructive h-4 w-4" />;
  }
  return <Minus className="text-muted-foreground h-4 w-4" />;
}

function ForecastChartsLoading({
  selectedMetric,
  onMetricChange,
}: {
  selectedMetric: MetricType;
  onMetricChange: (value: MetricType) => void;
}) {
  return (
    <Card>
      <ForecastChartsHeader
        selectedMetric={selectedMetric}
        onMetricChange={onMetricChange}
        disabled
      />
      <CardContent>
        <Skeleton className="h-80 w-full" />
      </CardContent>
    </Card>
  );
}

function ForecastChartsEmpty({
  selectedMetric,
  onMetricChange,
}: {
  selectedMetric: MetricType;
  onMetricChange: (value: MetricType) => void;
}) {
  return (
    <Card>
      <ForecastChartsHeader selectedMetric={selectedMetric} onMetricChange={onMetricChange} />
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

function ForecastSummaryCards({
  currentForecast,
  selectedMetric,
}: {
  currentForecast: NonNullable<NonNullable<ForecastChartsProps['forecasts']>[MetricType]>;
  selectedMetric: MetricType;
}) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
      <SummaryCard label="Current">
        <div className="text-lg font-bold">
          {formatForecastValue(currentForecast.current, selectedMetric)}
        </div>
      </SummaryCard>
      <SummaryCard label="Predicted (30d)">
        <div className="text-lg font-bold">
          {formatForecastValue(
            currentForecast.predicted[currentForecast.predicted.length - 1]?.predicted || 0,
            selectedMetric
          )}
        </div>
      </SummaryCard>
      <SummaryCard label="Trend">
        <div
          className={`flex items-center gap-1 font-medium ${getTrendTextClass(currentForecast.trend)}`}
        >
          {getTrendIcon(currentForecast.trend)}
          <span className="text-sm capitalize">{currentForecast.trend}</span>
        </div>
      </SummaryCard>
      <SummaryCard label="Confidence">
        <div className="flex items-center gap-2">
          <span
            className={`text-lg font-bold ${getConfidenceTextClass(currentForecast.confidence)}`}
          >
            {currentForecast.confidence}%
          </span>
          <Badge variant="outline" className="text-xs">
            {getConfidenceLabel(currentForecast.confidence)}
          </Badge>
        </div>
      </SummaryCard>
    </div>
  );
}

function SummaryCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-border/50 bg-card/50 rounded-lg border p-3">
      <div className="text-muted-foreground mb-1 text-xs">{label}</div>
      {children}
    </div>
  );
}

function ForecastChartArea({
  chartData,
  selectedMetric,
}: {
  chartData: ReturnType<typeof toForecastChartData>;
  selectedMetric: MetricType;
}) {
  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="confidenceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} className="text-muted-foreground" />
          <YAxis
            tick={{ fontSize: 12 }}
            className="text-muted-foreground"
            tickFormatter={(value: number) => formatForecastValue(value, selectedMetric)}
          />
          <RechartsTooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '8px',
            }}
            labelStyle={{ color: 'hsl(var(--foreground))' }}
            formatter={(value: unknown, name?: string) => {
              const numericValue = typeof value === 'number' ? value : Number(value);
              if (!Number.isFinite(numericValue)) {
                return [value as any, name ?? ''];
              }
              return [formatForecastValue(numericValue, selectedMetric), name ?? ''];
            }}
          />
          <Legend />
          <Area
            type="monotone"
            dataKey="upper"
            stroke="none"
            fill="url(#confidenceGradient)"
            name="Confidence Interval"
          />
          <Area type="monotone" dataKey="lower" stroke="none" fill="hsl(var(--card))" name="" />
          <Line
            type="monotone"
            dataKey="predicted"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={false}
            name="Predicted"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ForecastLegendHint() {
  return (
    <div className="bg-muted/50 mt-4 flex items-start gap-2 rounded-md p-3 text-xs">
      <Info className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
      <div className="text-muted-foreground">
        <span className="font-medium">How to read this chart:</span> The blue line shows predicted
        values. The shaded area represents the confidence interval - actual values are likely to
        fall within this range. Confidence decreases for predictions further in the future.
      </div>
    </div>
  );
}

export function ForecastCharts({ forecasts: forecastsProp, loading }: ForecastChartsProps) {
  const forecasts = forecastsProp ?? ({} as NonNullable<ForecastChartsProps['forecasts']>);
  const [selectedMetric, setSelectedMetric] = useState<MetricType>('engagement');
  const currentForecast = forecasts?.[selectedMetric];
  const hasData = Boolean(currentForecast && currentForecast.predicted?.length);

  if (loading) {
    return (
      <ForecastChartsLoading selectedMetric={selectedMetric} onMetricChange={setSelectedMetric} />
    );
  }
  if (!hasData || !currentForecast) {
    return (
      <ForecastChartsEmpty selectedMetric={selectedMetric} onMetricChange={setSelectedMetric} />
    );
  }

  const chartData = toForecastChartData(currentForecast);
  return (
    <Card>
      <ForecastChartsHeader
        selectedMetric={selectedMetric}
        onMetricChange={setSelectedMetric}
        showInfo
      />
      <CardContent>
        <ForecastSummaryCards currentForecast={currentForecast} selectedMetric={selectedMetric} />
        <ForecastChartArea chartData={chartData} selectedMetric={selectedMetric} />
        <ForecastLegendHint />
      </CardContent>
    </Card>
  );
}
