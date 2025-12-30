import { Calendar, Heart, MessageCircle, TrendingUp, Zap } from 'lucide-react';
import type { HealthScoreFactors, HealthScoreLevel } from './types';

export const SCORE_GAUGE_RADIUS = 70;

export const FACTOR_META: Record<
  keyof HealthScoreFactors,
  {
    icon: typeof Heart;
    label: string;
    description: string;
  }
> = {
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

export const LEVEL_CONFIG: Record<
  HealthScoreLevel,
  {
    label: string;
    description: string;
    ringGradient: string;
    textColor: string;
    bgGradient: string;
    badgeVariant: 'default' | 'secondary' | 'outline' | 'destructive';
    gradientStartColor: string;
    gradientEndColor: string;
  }
> = {
  excellent: {
    label: 'Excellent',
    description: 'Your brand is thriving on social media',
    ringGradient: 'from-emerald-400 to-teal-500',
    textColor: 'text-emerald-700 dark:text-emerald-400',
    bgGradient:
      'from-emerald-50/80 via-green-50/80 to-teal-50/80 dark:from-emerald-950/30 dark:via-green-950/30 dark:to-teal-950/30',
    badgeVariant: 'default',
    gradientStartColor: '#10b981',
    gradientEndColor: '#14b8a6',
  },
  good: {
    label: 'Good',
    description: 'Your brand is performing well',
    ringGradient: 'from-blue-400 to-purple-500',
    textColor: 'text-blue-700 dark:text-blue-400',
    bgGradient:
      'from-blue-50/80 via-indigo-50/80 to-purple-50/80 dark:from-blue-950/30 dark:via-indigo-950/30 dark:to-purple-950/30',
    badgeVariant: 'secondary',
    gradientStartColor: '#3b82f6',
    gradientEndColor: '#a855f7',
  },
  needs_improvement: {
    label: 'Needs Improvement',
    description: "There's room for growth",
    ringGradient: 'from-amber-400 to-orange-500',
    textColor: 'text-amber-700 dark:text-amber-400',
    bgGradient:
      'from-amber-50/80 via-orange-50/80 to-red-50/80 dark:from-amber-950/30 dark:via-orange-950/30 dark:to-red-950/30',
    badgeVariant: 'outline',
    gradientStartColor: '#f59e0b',
    gradientEndColor: '#f97316',
  },
  action_required: {
    label: 'Action Required',
    description: 'Immediate attention needed',
    ringGradient: 'from-red-400 to-pink-500',
    textColor: 'text-red-700 dark:text-red-400',
    bgGradient:
      'from-red-50/80 via-pink-50/80 to-rose-50/80 dark:from-red-950/30 dark:via-pink-950/30 dark:to-rose-950/30',
    badgeVariant: 'destructive',
    gradientStartColor: '#ef4444',
    gradientEndColor: '#ec4899',
  },
};
