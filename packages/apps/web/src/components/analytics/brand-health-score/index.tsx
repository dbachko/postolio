import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info, Target } from 'lucide-react';
import { BrandHealthScoreSkeleton } from './components/brand-health-score-skeleton';
import { FactorsBreakdown } from './components/factors-breakdown';
import { ScoreGauge } from './components/score-gauge';
import { LEVEL_CONFIG } from './constants';
import type { BrandHealthScoreProps } from './types';

export function BrandHealthScore({ healthScore, loading }: BrandHealthScoreProps) {
  if (loading) {
    return <BrandHealthScoreSkeleton />;
  }

  if (!healthScore) {
    return null;
  }

  const { score, level, factors, primaryFactor } = healthScore;
  const config = LEVEL_CONFIG[level];

  return (
    <Card
      className={`relative overflow-hidden border-none bg-gradient-to-br ${config.bgGradient} shadow-xl`}
    >
      <div
        className={`absolute -top-20 -right-20 h-60 w-60 rounded-full bg-gradient-to-br ${config.ringGradient} opacity-10 blur-3xl`}
      />
      <div
        className={`absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-gradient-to-br ${config.ringGradient} opacity-10 blur-3xl`}
      />

      <CardHeader className="relative">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Target className="h-5 w-5" />
            <span>Brand Health Score</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="text-muted-foreground hover:text-foreground h-4 w-4 transition-colors" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-sm">
                    A composite score (0-100) based on engagement rate (30%), follower growth (20%),
                    content consistency (20%), comment response rate (15%), and publishing frequency
                    (15%).
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardTitle>
          <Badge variant={config.badgeVariant} className="text-xs">
            {config.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="relative">
        <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
          <ScoreGauge
            score={score}
            ringGradient={config.ringGradient}
            textColor={config.textColor}
            gradientStartColor={config.gradientStartColor}
            gradientEndColor={config.gradientEndColor}
          />

          <div className="flex-1 space-y-6">
            <div className="space-y-1">
              <h3 className={`text-2xl font-bold ${config.textColor}`}>
                {config.label} Performance
              </h3>
              <p className="text-muted-foreground">{config.description}</p>
            </div>

            <div className="border-border/50 bg-card/50 rounded-xl border p-4 backdrop-blur-sm">
              <div className="mb-2 flex items-center gap-2">
                <div className={`rounded-lg bg-gradient-to-br ${config.ringGradient} p-1.5`}>
                  <Target className="h-4 w-4 text-white" />
                </div>
                <div className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Priority Focus
                </div>
              </div>
              <div className="mb-1 font-semibold">{primaryFactor.name}</div>
              <div className="text-muted-foreground text-sm">{primaryFactor.suggestion}</div>
            </div>

            <FactorsBreakdown factors={factors} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
