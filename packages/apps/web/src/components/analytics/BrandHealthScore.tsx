import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Info, Heart, TrendingUp, Calendar, MessageCircle, Zap, Target } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';

interface HealthScoreData {
  score: number;
  level: 'excellent' | 'good' | 'needs_improvement' | 'action_required';
  color: string;
  factors: {
    engagementRate: number;
    followerGrowthRate: number;
    contentConsistency: number;
    commentResponseRate: number;
    publishingFrequency: number;
  };
  primaryFactor: {
    name: string;
    value: number;
    suggestion: string;
  };
}

interface BrandHealthScoreProps {
  healthScore?: HealthScoreData;
  loading?: boolean;
}

// Factor metadata with icons and labels
const factorMeta = {
  engagementRate: {
    icon: Heart,
    label: 'Engagement Rate',
    description: 'How much your audience interacts',
  },
  followerGrowthRate: {
    icon: TrendingUp,
    label: 'Follower Growth',
    description: 'New followers over time',
  },
  contentConsistency: {
    icon: Calendar,
    label: 'Content Consistency',
    description: 'Regular posting schedule',
  },
  commentResponseRate: {
    icon: MessageCircle,
    label: 'Response Rate',
    description: 'How quickly you engage',
  },
  publishingFrequency: {
    icon: Zap,
    label: 'Publishing Frequency',
    description: 'How often you post',
  },
};

export function BrandHealthScore({ healthScore, loading }: BrandHealthScoreProps) {
  if (loading) {
    return (
      <Card className="relative overflow-hidden border-none bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-blue-950/50 dark:via-indigo-950/50 dark:to-purple-950/50">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gradient-to-br from-blue-400/20 to-purple-400/20 blur-3xl" />
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span>Brand Health Score</span>
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

  const levelConfig = {
    excellent: {
      label: 'Excellent',
      description: 'Your brand is thriving on social media',
      gradient: 'from-emerald-500 via-green-500 to-teal-500',
      ringGradient: 'from-emerald-400 to-teal-500',
      textColor: 'text-emerald-700 dark:text-emerald-400',
      bgGradient:
        'from-emerald-50/80 via-green-50/80 to-teal-50/80 dark:from-emerald-950/30 dark:via-green-950/30 dark:to-teal-950/30',
      badgeVariant: 'default' as const,
      glowColor: 'emerald',
    },
    good: {
      label: 'Good',
      description: 'Your brand is performing well',
      gradient: 'from-blue-500 via-indigo-500 to-purple-500',
      ringGradient: 'from-blue-400 to-purple-500',
      textColor: 'text-blue-700 dark:text-blue-400',
      bgGradient:
        'from-blue-50/80 via-indigo-50/80 to-purple-50/80 dark:from-blue-950/30 dark:via-indigo-950/30 dark:to-purple-950/30',
      badgeVariant: 'secondary' as const,
      glowColor: 'blue',
    },
    needs_improvement: {
      label: 'Needs Improvement',
      description: "There's room for growth",
      gradient: 'from-amber-500 via-orange-500 to-red-500',
      ringGradient: 'from-amber-400 to-orange-500',
      textColor: 'text-amber-700 dark:text-amber-400',
      bgGradient:
        'from-amber-50/80 via-orange-50/80 to-red-50/80 dark:from-amber-950/30 dark:via-orange-950/30 dark:to-red-950/30',
      badgeVariant: 'outline' as const,
      glowColor: 'orange',
    },
    action_required: {
      label: 'Action Required',
      description: 'Immediate attention needed',
      gradient: 'from-red-500 via-pink-500 to-rose-500',
      ringGradient: 'from-red-400 to-pink-500',
      textColor: 'text-red-700 dark:text-red-400',
      bgGradient:
        'from-red-50/80 via-pink-50/80 to-rose-50/80 dark:from-red-950/30 dark:via-pink-950/30 dark:to-rose-950/30',
      badgeVariant: 'destructive' as const,
      glowColor: 'red',
    },
  };

  const config = levelConfig[level];

  // Circle progress calculation
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const progress = circumference - (score / 100) * circumference;

  // Get factor color based on value
  const getFactorColor = (value: number) => {
    if (value >= 80) return 'bg-emerald-500 dark:bg-emerald-600';
    if (value >= 60) return 'bg-blue-500 dark:bg-blue-600';
    if (value >= 40) return 'bg-amber-500 dark:bg-amber-600';
    return 'bg-red-500 dark:bg-red-600';
  };

  return (
    <Card
      className={`relative overflow-hidden border-none bg-gradient-to-br ${config.bgGradient} shadow-xl`}
    >
      {/* Decorative background elements */}
      <div
        className={`absolute -right-20 -top-20 h-60 w-60 rounded-full bg-gradient-to-br ${config.ringGradient} opacity-10 blur-3xl`}
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
          {/* Enhanced Circular Gauge */}
          <div className="flex justify-center lg:justify-start">
            <div className="relative">
              {/* Glow effect */}
              <div
                className={`absolute inset-0 rounded-full bg-gradient-to-br ${config.ringGradient} opacity-20 blur-2xl`}
              />

              <svg className="h-48 w-48 -rotate-90 transform drop-shadow-lg" viewBox="0 0 160 160">
                {/* Outer decorative ring */}
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

                {/* Background track */}
                <circle
                  cx="80"
                  cy="80"
                  r={radius}
                  stroke="currentColor"
                  strokeWidth="14"
                  fill="none"
                  className="text-muted-foreground/10"
                />

                {/* Progress ring with gradient */}
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
                    <stop
                      offset="0%"
                      stopColor={
                        config.gradient.includes('emerald')
                          ? '#10b981'
                          : config.gradient.includes('blue')
                            ? '#3b82f6'
                            : config.gradient.includes('amber')
                              ? '#f59e0b'
                              : '#ef4444'
                      }
                    />
                    <stop
                      offset="100%"
                      stopColor={
                        config.gradient.includes('teal')
                          ? '#14b8a6'
                          : config.gradient.includes('purple')
                            ? '#a855f7'
                            : config.gradient.includes('orange')
                              ? '#f97316'
                              : '#ec4899'
                      }
                    />
                  </linearGradient>
                </defs>
              </svg>

              {/* Score display */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className={`text-5xl font-bold ${config.textColor} drop-shadow-sm`}>
                    {score}
                  </div>
                  <div className="text-muted-foreground text-sm font-medium">/ 100</div>
                </div>
              </div>
            </div>
          </div>

          {/* Score Details and Factors */}
          <div className="flex-1 space-y-6">
            {/* Status description */}
            <div className="space-y-1">
              <h3 className={`text-2xl font-bold ${config.textColor}`}>
                {config.label} Performance
              </h3>
              <p className="text-muted-foreground">{config.description}</p>
            </div>

            {/* Primary Focus Area */}
            <div className="border-border/50 bg-card/50 rounded-xl border p-4 backdrop-blur-sm">
              <div className="mb-2 flex items-center gap-2">
                <div className={`rounded-lg bg-gradient-to-br ${config.ringGradient} p-1.5`}>
                  <Target className="h-4 w-4 text-white" />
                </div>
                <div className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                  Priority Focus
                </div>
              </div>
              <div className="mb-1 font-semibold">{primaryFactor.name}</div>
              <div className="text-muted-foreground text-sm">{primaryFactor.suggestion}</div>
            </div>

            {/* Health Factors Breakdown */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Health Factors</h4>
                <span className="text-muted-foreground text-xs">Score Breakdown</span>
              </div>

              <div className="space-y-2.5">
                {Object.entries(factors).map(([key, value]) => {
                  const meta = factorMeta[key as keyof typeof factors];
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
