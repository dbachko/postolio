import type { FastifyInstance } from 'fastify';

export const FB_GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || 'v24.0';
export const fbGraph = (path: string) =>
  `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${path}`;

export interface PlatformContent {
  caption: string;
  mediaUrl?: string;
  imageUrl?: string;
  mediaType?: 'image' | 'video' | 'carousel';
  metadata?: Record<string, unknown>;
}

export interface PublishResult {
  platform: string;
  postId: string;
  permalink?: string;
  publishedAt: string;
  metrics?: {
    impressions?: number;
    reach?: number;
    engagement?: number;
  };
  metadata?: Record<string, unknown>;
}

export interface PlatformCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  platformSpecific?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface PlatformAdapter {
  platform: string;
  validateContent(content: PlatformContent): ValidationResult;
  formatContent(content: PlatformContent): PlatformContent;
  publish(content: PlatformContent, credentials: PlatformCredentials): Promise<PublishResult>;
  getInsights?(postId: string, credentials: PlatformCredentials): Promise<unknown>;
  deletePost?(postId: string, credentials: PlatformCredentials): Promise<boolean>;
  getRateLimits(): RateLimits;
  refreshToken?(refreshToken: string): Promise<PlatformCredentials>;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

export interface RateLimits {
  postsPerHour?: number;
  postsPerDay?: number;
  apiCallsPerHour?: number;
  customLimits?: Record<string, number>;
}

export type FastifyApp = FastifyInstance;
