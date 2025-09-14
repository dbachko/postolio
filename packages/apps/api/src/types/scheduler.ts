/**
 * Type definitions for scheduler-related functionality
 */

/**
 * Content generation parameters stored in the database
 */
export interface GenerationParams {
  /** Schedule ID from AWS scheduler service */
  scheduleId?: string;

  /** Timezone for the scheduled content */
  scheduledTimezone?: string;

  /** Local time string for the scheduled content */
  scheduledLocalTime?: string;

  /** Brand timezone */
  brandTimezone?: string;

  /** User ID who scheduled the content */
  userId?: string;

  /** Whether AWS schedule was successfully created */
  awsScheduleCreated?: boolean;

  /** Processing state for async operations */
  processing?: {
    active: boolean;
    operation: 'scheduling';
    startedAt: string;
    operationId?: string;
  };

  /** Additional metadata */
  [key: string]: unknown;
}

/**
 * OAuth credentials metadata
 */
export interface CredentialsMetadata {
  /** Instagram Business Account ID */
  instagramBusinessAccountId?: string;

  /** LinkedIn Person URN */
  personUrn?: string;

  /** LinkedIn User ID */
  userId?: string;

  /** Facebook Page ID */
  pageId?: string;

  /** Additional platform-specific data */
  [key: string]: unknown;
}

/**
 * API error response from social platforms
 */
export interface PlatformApiError {
  error?: {
    message?: string;
    type?: string;
    code?: string | number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
  error_description?: string;
  error_message?: string;
}

/**
 * Instagram media creation response
 */
export interface InstagramMediaResponse {
  id: string;
}

/**
 * Instagram publish response
 */
export interface InstagramPublishResponse {
  id: string;
  permalink?: string;
}

/**
 * LinkedIn share response
 */
export interface LinkedInShareResponse {
  id: string;
  activity?: string;
}

/**
 * Facebook post response
 */
export interface FacebookPostResponse {
  id: string;
  post_id?: string;
}

/**
 * Analytics data structure
 */
export interface AnalyticsData {
  name: string;
  values: Array<{
    value: number;
    end_time?: string;
  }>;
}

/**
 * Post metrics structure
 */
export interface PostMetrics {
  impressions: number;
  reach: number;
  engagement: number;
  saves?: number;
  shares?: number;
  comments_count?: number;
  likes_count?: number;
}

/**
 * Schedule configuration
 */
export interface ScheduleConfig {
  timezone?: string;
  localTime?: string;
  utcTime?: string;
  retryAttempts?: number;
  priority?: number;
}

/**
 * Scheduler error structure
 */
export interface SchedulerError {
  code: string;
  message: string;
  details?: unknown;
  timestamp: string;
}
