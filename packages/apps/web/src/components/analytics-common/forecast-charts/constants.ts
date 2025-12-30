import type { MetricType } from './types';

export const FORECAST_METRIC_OPTIONS: Array<{ value: MetricType; label: string }> = [
  { value: 'engagement', label: 'Engagement' },
  { value: 'followerGrowth', label: 'Follower Growth' },
  { value: 'engagementRate', label: 'Engagement Rate' },
  { value: 'reach', label: 'Reach' },
];
