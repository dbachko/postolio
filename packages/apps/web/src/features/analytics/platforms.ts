import type { Platform } from '@/lib/platform-config';

export type AnalyticsTabKey = 'overview' | 'posts' | 'insights' | 'recommendations' | 'forecasts';

export type PostMetricKey =
  | 'impressions'
  | 'reach'
  | 'likes'
  | 'comments'
  | 'saves'
  | 'shares'
  | 'engagementRate';

export type PostMetricColumn = {
  key: PostMetricKey;
  label: string;
};

export type PlatformAnalyticsModule = {
  platform: Platform | 'unknown';
  likesLabel: string;
  postColumns: PostMetricColumn[];
  tabs: AnalyticsTabKey[];
};

const DEFAULT_TABS: AnalyticsTabKey[] = [
  'overview',
  'posts',
  'insights',
  'recommendations',
  'forecasts',
];

const DEFAULT_MODULE: PlatformAnalyticsModule = {
  platform: 'unknown',
  likesLabel: 'Likes',
  postColumns: [
    { key: 'impressions', label: 'Views' },
    { key: 'reach', label: 'Reach' },
    { key: 'likes', label: 'Likes' },
    { key: 'comments', label: 'Comments' },
    { key: 'shares', label: 'Shares' },
    { key: 'engagementRate', label: 'Eng. Rate' },
  ],
  tabs: DEFAULT_TABS,
};

const MODULES: Record<Platform, PlatformAnalyticsModule> = {
  instagram: {
    platform: 'instagram',
    likesLabel: 'Likes',
    postColumns: [
      { key: 'impressions', label: 'Views' },
      { key: 'reach', label: 'Reach' },
      { key: 'likes', label: 'Likes' },
      { key: 'comments', label: 'Comments' },
      { key: 'saves', label: 'Saves' },
      { key: 'shares', label: 'Shares' },
      { key: 'engagementRate', label: 'Eng. Rate' },
    ],
    tabs: DEFAULT_TABS,
  },
  facebook: {
    platform: 'facebook',
    likesLabel: 'Reactions',
    postColumns: [
      { key: 'impressions', label: 'Views' },
      { key: 'reach', label: 'Reach' },
      { key: 'likes', label: 'Reactions' },
      { key: 'comments', label: 'Comments' },
      { key: 'shares', label: 'Shares' },
      { key: 'engagementRate', label: 'Eng. Rate' },
    ],
    tabs: DEFAULT_TABS,
  },
  linkedin: DEFAULT_MODULE,
  x: DEFAULT_MODULE,
  youtube: DEFAULT_MODULE,
  tiktok: DEFAULT_MODULE,
};

export function getPlatformAnalyticsModule(
  platform: string | null | undefined
): PlatformAnalyticsModule {
  const key = platform as Platform | undefined;
  if (key && key in MODULES) return MODULES[key];
  return DEFAULT_MODULE;
}
