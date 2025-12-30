import { Info } from 'lucide-react';
import { CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { FORECAST_METRIC_OPTIONS } from '../constants';
import type { MetricType } from '../types';

type ForecastChartsHeaderProps = {
  selectedMetric: MetricType;
  onMetricChange: (metric: MetricType) => void;
  disabled?: boolean;
  showInfo?: boolean;
};

export function ForecastChartsHeader({
  selectedMetric,
  onMetricChange,
  disabled = false,
  showInfo = false,
}: ForecastChartsHeaderProps) {
  return (
    <CardHeader>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <CardTitle>Predictive Forecast</CardTitle>
          {showInfo ? (
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
          ) : null}
        </div>

        <Select value={selectedMetric} onValueChange={(v) => onMetricChange(v as MetricType)}>
          <SelectTrigger className="w-full sm:w-[180px]" disabled={disabled}>
            <SelectValue />
          </SelectTrigger>
          {disabled ? null : (
            <SelectContent>
              {FORECAST_METRIC_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          )}
        </Select>
      </div>
    </CardHeader>
  );
}
