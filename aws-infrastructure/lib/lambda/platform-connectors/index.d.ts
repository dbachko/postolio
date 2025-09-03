/**
 * Platform Publisher Lambda
 * Main entry point for publishing content to social media platforms
 */
import { EventBridgeEvent } from 'aws-lambda';
import { BasePlatformConnector, Content } from './base-connector';
import { InstagramConnector } from './instagram-connector';
import { TikTokConnector } from './tiktok-connector';
import { YouTubeConnector } from './youtube-connector';
export interface ScheduleEventDetail {
    scheduleId: string;
    brandId: string;
    contentId: string;
    platform: string;
    content: Content;
    scheduledAt: string;
    retryCount?: number;
    priority?: number;
}
export interface PublishingStatus {
    scheduleId: string;
    status: 'pending' | 'publishing' | 'published' | 'failed' | 'retrying';
    platformPostId?: string;
    platformUrl?: string;
    publishedAt?: string;
    error?: {
        code: string;
        message: string;
        retryable: boolean;
    };
    retryCount: number;
    lastAttemptAt: string;
}
/**
 * Lambda handler for platform publishing
 */
export declare const handler: (event: EventBridgeEvent<"ScheduledPublish", ScheduleEventDetail>) => Promise<void>;
/**
 * Export connectors for testing
 */
export { InstagramConnector, TikTokConnector, YouTubeConnector, BasePlatformConnector, };
