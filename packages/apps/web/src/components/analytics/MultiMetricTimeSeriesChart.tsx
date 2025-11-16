interface MultiMetricPoint {
  date: string;
  metrics: Record<string, number>;
}

interface MetricConfig {
  key: string;
  label: string;
}

interface MultiMetricTimeSeriesChartProps {
  title: string;
  series: MultiMetricPoint[];
  metrics: MetricConfig[];
  label?: string;
}

export function MultiMetricTimeSeriesChart({
  title,
  series,
  metrics,
  label = 'Daily performance',
}: MultiMetricTimeSeriesChartProps) {
  if (!series || series.length === 0) {
    return (
      <div className="bg-card rounded-lg p-6 shadow-md">
        <h3 className="mb-4 text-lg font-semibold">{title}</h3>
        <div className="text-muted-foreground py-8 text-center">No data available</div>
      </div>
    );
  }

  const allValues = series.flatMap((p) => metrics.map((m) => p.metrics[m.key] || 0));
  const max = Math.max(...allValues, 1);

  const getColorForMetric = (key: string) => {
    switch (key) {
      case 'reach':
        return 'var(--chart-1)';
      case 'impressions':
        return 'var(--chart-2)';
      default:
        return 'var(--chart-3, var(--chart-2))';
    }
  };

  return (
    <div className="bg-card rounded-lg p-6 shadow-md">
      <h3 className="mb-4 text-lg font-semibold">{title}</h3>
      <div className="space-y-3">
        {series.map((item, idx) => (
          <div key={idx} className="space-y-1">
            <div className="text-muted-foreground text-xs">
              {new Date(item.date).toLocaleDateString()}
            </div>
            <div className="space-y-1">
              {metrics.map((metric) => {
                const value = item.metrics[metric.key] || 0;
                const widthPct = (value / max) * 100;
                return (
                  <div key={metric.key} className="flex items-center space-x-2">
                    <span className="text-muted-foreground w-20 text-xs">{metric.label}</span>
                    <div className="bg-muted relative h-3 flex-1 rounded-full">
                      <div
                        className="h-3 rounded-full transition-all duration-300"
                        style={{
                          width: `${widthPct}%`,
                          backgroundColor: getColorForMetric(metric.key),
                        }}
                      />
                    </div>
                    <span className="w-16 text-right text-xs font-medium">
                      {Math.round(value).toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {label && <div className="text-muted-foreground mt-3 text-xs">{label}</div>}
    </div>
  );
}
