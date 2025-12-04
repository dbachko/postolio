import { TrendingUp, TrendingDown, Minus, HelpCircle } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatGrowth } from '@/utils/formatNumber';
import { Button } from '@/components/ui/button';

interface KPICardProps {
  title: string;
  value: string | number;
  change?: number; // Percentage change from previous period
  trend?: 'up' | 'down' | 'neutral';
  icon?: React.ReactNode;
  loading?: boolean;
  onClick?: () => void;
  onHelpClick?: () => void;
}

export function KPICard({
  title,
  value,
  change,
  trend,
  icon,
  loading,
  onClick,
  onHelpClick,
}: KPICardProps) {
  if (loading) {
    return (
      <Card className="cursor-pointer transition-shadow hover:shadow-md">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-5 rounded" />
          </div>
        </CardHeader>
        <CardContent>
          <Skeleton className="mb-2 h-8 w-32" />
          <Skeleton className="h-4 w-20" />
        </CardContent>
      </Card>
    );
  }

  // Auto-determine trend if not provided
  const determinedTrend =
    trend || (change && change > 0 ? 'up' : change && change < 0 ? 'down' : 'neutral');

  const trendConfig = {
    up: {
      icon: TrendingUp,
      color: 'text-green-600 dark:text-green-400',
      bgColor: 'bg-green-50 dark:bg-green-950/30',
    },
    down: {
      icon: TrendingDown,
      color: 'text-red-600 dark:text-red-400',
      bgColor: 'bg-red-50 dark:bg-red-950/30',
    },
    neutral: {
      icon: Minus,
      color: 'text-gray-600 dark:text-gray-400',
      bgColor: 'bg-gray-50 dark:bg-gray-950/30',
    },
  };

  const config = trendConfig[determinedTrend];
  const TrendIcon = config.icon;

  return (
    <Card
      className={`transition-all duration-200 ${onClick ? 'cursor-pointer hover:scale-[1.02] hover:shadow-lg' : ''}`}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground text-sm font-medium">{title}</span>
            {onHelpClick && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground h-5 w-5"
                aria-label={`What is ${title}?`}
                onClick={(event) => {
                  event.stopPropagation();
                  onHelpClick();
                }}
              >
                <HelpCircle className="h-3 w-3" />
              </Button>
            )}
          </div>
          {icon && <div className="text-muted-foreground">{icon}</div>}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-foreground mb-2 text-2xl font-bold">{value}</div>
        {change !== undefined && (
          <div className={`flex items-center gap-1 text-sm ${config.color}`}>
            <TrendIcon className="h-4 w-4" />
            <span className="font-medium">{formatGrowth(change)}</span>
            <span className="text-muted-foreground text-xs whitespace-nowrap">vs prev</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
