import { Calendar, Heart, MessageCircle, TrendingUp, Zap } from 'lucide-react';

export const FACTOR_META = {
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
} as const;

export const LEVEL_CONFIG = {
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
} as const;
