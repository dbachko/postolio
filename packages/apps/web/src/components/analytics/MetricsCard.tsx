import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatNumber, formatGrowth } from '@/utils/formatNumber';

interface MetricsCardProps {
  title: string;
  value: number;
  icon?: React.ReactNode;
  trend?: number; // Percentage change
  description?: string;
  formatValue?: (value: number) => string;
}

const defaultFormatValue = formatNumber;

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
                <TrendingUp className="text-foreground h-3 w-3" />
              ) : (
                <TrendingDown className="text-foreground h-3 w-3" />
              )}
              <Badge
                variant={isPositiveTrend ? 'default' : 'destructive'}
                className={cn('text-xs')}
              >
                {formatGrowth(trend)}
              </Badge>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
