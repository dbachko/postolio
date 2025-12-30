export interface ForecastDataPoint {
  date: string;
  predicted: number;
  confidence: {
    lower: number;
    upper: number;
  };
}

export interface ForecastData {
  current: number;
  predicted: ForecastDataPoint[];
  trend: 'increasing' | 'decreasing' | 'stable';
  confidence: number;
}

export interface ForecastChartsProps {
  forecasts?: {
    engagement?: ForecastData;
    followerGrowth?: ForecastData & { expectedGrowth: number; expectedFollowers: number };
    engagementRate?: ForecastData;
    reach?: ForecastData & { expectedReach: number };
  };
  loading?: boolean;
}

export type MetricType = 'engagement' | 'followerGrowth' | 'engagementRate' | 'reach';
