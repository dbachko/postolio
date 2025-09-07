/**
 * API Version Constants
 * Centralized configuration for external API versions
 */

export const API_VERSIONS = {
  FACEBOOK_GRAPH: 'v23.0',  // Facebook Graph API version (includes Instagram)
  LINKEDIN: 'v2',            // LinkedIn API version
  TWITTER: 'v2',             // Twitter API version
  TIKTOK: 'v1',              // TikTok API version
} as const;

export const API_BASE_URLS = {
  FACEBOOK_GRAPH: 'https://graph.facebook.com',
  INSTAGRAM_GRAPH: 'https://graph.instagram.com',
  LINKEDIN: 'https://api.linkedin.com',
  TWITTER: 'https://api.twitter.com',
  TIKTOK: 'https://open-api.tiktok.com',
} as const;

export type ApiVersion = typeof API_VERSIONS[keyof typeof API_VERSIONS];
export type ApiBaseUrl = typeof API_BASE_URLS[keyof typeof API_BASE_URLS];