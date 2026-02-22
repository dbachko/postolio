import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Info, Target } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import type { AccountHealthScore as AccountHealthScoreData } from '@/features/analytics/types';

import { FACTOR_META, LEVEL_CONFIG } from './constants';

interface AccountHealthScoreProps {
  healthScore?: AccountHealthScoreData;
  loading?: boolean;
}

export function AccountHealthScore({ healthScore, loading }: AccountHealthScoreProps) {
  if (loading) {
    return (
      <Card className="relative overflow-hidden border-none bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-blue-950/50 dark:via-indigo-950/50 dark:to-purple-950/50">
        <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-gradient-to-br from-blue-400/20 to-purple-400/20 blur-3xl" />
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span>Account Health Score</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
            <div className="flex justify-center">
              <Skeleton className="h-48 w-48 rounded-full" />
            </div>
            <div className="flex-1 space-y-4">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-20 w-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!healthScore) {
    return null;
  }

  const { score, level, factors, primaryFactor } = healthScore;
  const config = LEVEL_CONFIG[level as keyof typeof LEVEL_CONFIG];

  let gradientStartColor = '#ef4444';
  if (config.gradient.includes('emerald')) {
    gradientStartColor = '#10b981';
  } else if (config.gradient.includes('blue')) {
    gradientStartColor = '#3b82f6';
  } else if (config.gradient.includes('amber')) {
    gradientStartColor = '#f59e0b';
  }

  let gradientEndColor = '#ec4899';
  if (config.gradient.includes('teal')) {
    gradientEndColor = '#14b8a6';
  } else if (config.gradient.includes('purple')) {
    gradientEndColor = '#a855f7';
  } else if (config.gradient.includes('orange')) {
    gradientEndColor = '#f97316';
  }

  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const progress = circumference - (score / 100) * circumference;

  const getFactorColor = (value: number) => {
    if (value >= 80) {
      return 'bg-emerald-500 dark:bg-emerald-600';
    }
    if (value >= 60) {
      return 'bg-blue-500 dark:bg-blue-600';
    }
    if (value >= 40) {
      return 'bg-amber-500 dark:bg-amber-600';
    }
    return 'bg-red-500 dark:bg-red-600';
  };

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
            <span>Account Health Score</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="text-muted-foreground hover:text-foreground h-4 w-4 transition-colors" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-sm">
                    A composite score (0-100) based on engagement rate, follower growth, posting
                    consistency, and publishing frequency.
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
          <div className="flex justify-center lg:justify-start">
            <div className="relative h-48 w-48">
              <div
                className={`absolute inset-0 rounded-full bg-gradient-to-br ${config.ringGradient} opacity-20 blur-2xl`}
              />

              <svg
                className="h-full w-full -rotate-90 transform drop-shadow-lg"
                viewBox="0 0 160 160"
              >
                <circle
                  cx="80"
                  cy="80"
                  r="75"
                  stroke="currentColor"
                  strokeWidth="1"
                  fill="none"
                  className="text-muted-foreground/20"
                  strokeDasharray="2 4"
                />

                <circle
                  cx="80"
                  cy="80"
                  r={radius}
                  stroke="currentColor"
                  strokeWidth="14"
                  fill="none"
                  className="text-muted-foreground/10"
                />

                <circle
                  cx="80"
                  cy="80"
                  r={radius}
                  stroke="url(#scoreGradient)"
                  strokeWidth="14"
                  fill="none"
                  strokeDasharray={circumference}
                  strokeDashoffset={progress}
                  strokeLinecap="round"
                  className="transition-all duration-1000 ease-out"
                  style={{ filter: 'drop-shadow(0 0 8px rgba(0,0,0,0.1))' }}
                />

                <defs>
                  <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor={gradientStartColor} />
                    <stop offset="100%" stopColor={gradientEndColor} />
                  </linearGradient>
                </defs>
              </svg>

              <div className="pointer-events-none absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
                <div className={`text-5xl font-bold ${config.textColor} drop-shadow-sm`}>
                  {score}
                </div>
              </div>
            </div>
          </div>

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
                              <span className="text-xs font-semibold tabular-nums">
                                {value}/100
                              </span>
                            </div>
                            <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                              <div
                                className={`h-full transition-all duration-700 ease-out ${getFactorColor(value)}`}
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
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
