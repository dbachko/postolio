import { formatNumber, formatPercent } from '@/utils/formatNumber';
import type { ForecastData, MetricType } from './types';

export function formatForecastValue(value: number, metric: MetricType) {
  if (metric === 'engagementRate') {
    return formatPercent(value, 2);
  }
  return formatNumber(value);
}

export function getTrendTextClass(trend: ForecastData['trend']) {
  switch (trend) {
    case 'increasing':
      return 'text-primary';
    case 'decreasing':
      return 'text-destructive';
    default:
      return 'text-muted-foreground';
  }
}

export function getConfidenceTextClass(confidence: number) {
  if (confidence >= 75) {
    return 'text-primary';
  }
  if (confidence >= 50) {
    return 'text-foreground';
  }
  return 'text-muted-foreground';
}

export function getConfidenceLabel(confidence: number) {
  if (confidence >= 75) {
    return 'High Confidence';
  }
  if (confidence >= 50) {
    return 'Medium Confidence';
  }
  return 'Low Confidence';
}

export function toForecastChartData(forecast: ForecastData) {
  return forecast.predicted.map((point) => ({
    date: new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    predicted: Math.round(point.predicted),
    lower: Math.round(point.confidence.lower),
    upper: Math.round(point.confidence.upper),
  }));
}
