import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { FACTOR_META } from '../constants';
import type { HealthScoreFactors } from '../types';
import { getFactorColorClass } from '../utils';

interface FactorsBreakdownProps {
  factors: HealthScoreFactors;
}

export function FactorsBreakdown({ factors }: FactorsBreakdownProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Health Factors</h4>
        <span className="text-muted-foreground text-xs">Score Breakdown</span>
      </div>

      <div className="space-y-2.5">
        {Object.entries(factors).map(([key, value]) => {
          const meta = FACTOR_META[key as keyof typeof factors];
          const Icon = meta.icon;

          return (
            <TooltipProvider key={key}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="group cursor-help">
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Icon className="text-muted-foreground h-3.5 w-3.5" />
                        <span className="font-medium">{meta.label}</span>
                      </div>
                      <span className="text-xs font-semibold tabular-nums">{value}/100</span>
                    </div>
                    <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                      <div
                        className={`h-full transition-all duration-700 ease-out ${getFactorColorClass(value)}`}
                        style={{ width: `${value}%` }}
                      />
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-xs">
                  <p className="text-xs font-medium">{meta.label}</p>
                  <p className="text-muted-foreground text-xs">{meta.description}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </div>
    </div>
  );
}
