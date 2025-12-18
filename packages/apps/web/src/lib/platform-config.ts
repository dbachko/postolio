/**
 * Platform Configuration
 * Centralized configuration for all social media platforms
 */

export type Platform = 'instagram' | 'facebook' | 'linkedin' | 'x' | 'youtube' | 'tiktok';

export interface PlatformConfig {
  id: Platform;
  name: string;
  displayName: string;
  color: string;
  gradientClass: string;
  icon: string; // emoji for now, can be replaced with components later
  description: string;
  requirements: string;
  enabled: boolean;
  features: {
    publishing: boolean;
    scheduling: boolean;
    analytics: boolean;
    comments: boolean;
    directMessages: boolean;
    stories: boolean;
    reels: boolean;
  };
}

export const PLATFORM_CONFIG: Record<Platform, PlatformConfig> = {
  instagram: {
    id: 'instagram',
    name: 'Instagram',
    displayName: 'Instagram',
    color: '#E1306C',
    gradientClass: 'from-purple-500 to-pink-500',
    icon: '📷',
    description: 'Share photos and videos with your Instagram followers',
    requirements: 'Instagram Business or Creator account linked to a Facebook Page',
    enabled: true,
    features: {
      publishing: true,
      scheduling: true,
      analytics: true,
      comments: true,
      directMessages: true,
      stories: true,
      reels: true,
    },
  },
  facebook: {
    id: 'facebook',
    name: 'Facebook',
    displayName: 'Facebook',
    color: '#1877F2',
    gradientClass: 'from-blue-600 to-blue-700',
    icon: '👥',
    description: 'Share updates with your Facebook audience',
    requirements: 'Facebook Page',
    enabled: true,
    features: {
      publishing: true,
      scheduling: true,
      analytics: false,
      comments: false,
      directMessages: false,
      stories: false,
      reels: false,
    },
  },
  linkedin: {
    id: 'linkedin',
    name: 'LinkedIn',
    displayName: 'LinkedIn',
    color: '#0A66C2',
    gradientClass: 'from-blue-700 to-blue-800',
    icon: '💼',
    description: 'Share professional content with your LinkedIn network',
    requirements: 'LinkedIn Company Page',
    enabled: false, // Not yet implemented
    features: {
      publishing: false,
      scheduling: false,
      analytics: false,
      comments: false,
      directMessages: false,
      stories: false,
      reels: false,
    },
  },
  x: {
    id: 'x',
    name: 'X',
    displayName: 'X (Twitter)',
    color: '#000000',
    gradientClass: 'from-gray-800 to-black',
    icon: '𝕏',
    description: 'Share updates with your X followers',
    requirements: 'X (Twitter) account',
    enabled: false, // Not yet implemented
    features: {
      publishing: false,
      scheduling: false,
      analytics: false,
      comments: false,
      directMessages: false,
      stories: false,
      reels: false,
    },
  },
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    displayName: 'YouTube',
    color: '#FF0000',
    gradientClass: 'from-red-600 to-red-700',
    icon: '🎥',
    description: 'Upload videos to your YouTube channel',
    requirements: 'YouTube channel',
    enabled: false, // Not yet implemented
    features: {
      publishing: false,
      scheduling: false,
      analytics: false,
      comments: false,
      directMessages: false,
      stories: false,
      reels: false,
    },
  },
  tiktok: {
    id: 'tiktok',
    name: 'TikTok',
    displayName: 'TikTok',
    color: '#000000',
    gradientClass: 'from-black to-pink-600',
    icon: '🎵',
    description: 'Share short-form videos with your TikTok audience',
    requirements: 'TikTok Business account',
    enabled: false, // Not yet implemented
    features: {
      publishing: false,
      scheduling: false,
      analytics: false,
      comments: false,
      directMessages: false,
      stories: false,
      reels: false,
    },
  },
};

/**
 * Get all enabled platforms
 */
export function getEnabledPlatforms(): PlatformConfig[] {
  return Object.values(PLATFORM_CONFIG).filter((p) => p.enabled);
}

/**
 * Get platform configuration by ID
 */
export function getPlatformConfig(platform: Platform): PlatformConfig {
  return PLATFORM_CONFIG[platform];
}

/**
 * Check if platform is enabled and ready for use
 */
export function isPlatformEnabled(platform: Platform): boolean {
  return PLATFORM_CONFIG[platform]?.enabled ?? false;
}

/**
 * Get platforms that support a specific feature
 */
export function getPlatformsWithFeature(
  feature: keyof PlatformConfig['features']
): PlatformConfig[] {
  return getEnabledPlatforms().filter((p) => p.features[feature]);
}
