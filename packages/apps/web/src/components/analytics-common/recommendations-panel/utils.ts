import { Clock, FileText, Hash, Lightbulb, TrendingUp, type LucideIcon } from 'lucide-react';

type RecommendationImpact = 'high' | 'medium' | 'low';

export function getImpactBadgeConfig(impact: RecommendationImpact): {
  variant: 'default' | 'outline';
  className?: string;
  label: string;
} {
  switch (impact) {
    case 'high':
      return {
        variant: 'default',
        className: 'bg-red-500 text-white dark:bg-red-600',
        label: 'High Impact',
      };
    case 'medium':
      return {
        variant: 'default',
        className: 'bg-yellow-500 text-white dark:bg-yellow-600',
        label: 'Medium Impact',
      };
    case 'low':
      return {
        variant: 'outline',
        className: 'text-muted-foreground',
        label: 'Low Impact',
      };
  }
}

export function getDifficultyColorClassName(difficulty: string) {
  switch (difficulty) {
    case 'easy':
      return 'text-green-600 dark:text-green-400';
    case 'moderate':
      return 'text-yellow-600 dark:text-yellow-400';
    case 'complex':
      return 'text-orange-600 dark:text-orange-400';
    default:
      return 'text-gray-600 dark:text-gray-400';
  }
}

export function getRecommendationIcon(type: string): LucideIcon {
  switch (type) {
    case 'caption-length':
      return FileText;
    case 'hashtag-count':
      return Hash;
    case 'posting-frequency':
      return Clock;
    case 'content-type':
      return TrendingUp;
    default:
      return Lightbulb;
  }
}
