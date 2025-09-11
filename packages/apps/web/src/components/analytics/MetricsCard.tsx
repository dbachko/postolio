import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '../../lib/utils';

interface MetricsCardProps {
  title: string;
  value: number;
  icon?: React.ReactNode;
  trend?: number; // Percentage change
  description?: string;
  formatValue?: (value: number) => string;
}

const defaultFormatValue = (value: number): string => {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString();
};

export function MetricsCard({
  title,
  value,
  icon,
  trend = 0,
  description,
  formatValue = defaultFormatValue,
}: MetricsCardProps) {
  const isPositiveTrend = trend > 0;
  const hasTrend = Math.abs(trend) > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">{title}</CardTitle>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formatValue(value)}</div>
        <div className="flex items-center justify-between">
          {description && <p className="text-muted-foreground text-xs">{description}</p>}
          {hasTrend && (
            <div className="flex items-center space-x-1">
              {isPositiveTrend ? (
                <TrendingUp className="h-3 w-3 text-green-500" />
              ) : (
                <TrendingDown className="h-3 w-3 text-red-500" />
              )}
              <Badge
                variant="secondary"
                className={cn(
                  'text-xs',
                  isPositiveTrend ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                )}
              >
                {isPositiveTrend ? '+' : ''}
                {trend.toFixed(1)}%
              </Badge>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
