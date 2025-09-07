/**
 * AWS EventBridge Event Types
 * Type definitions for AWS Lambda and EventBridge events
 */

/**
 * EventBridge Scheduled Event
 * Triggered by EventBridge rules for scheduled tasks
 */
export interface EventBridgeScheduledEvent {
  version: string;
  id: string;
  "detail-type": string;
  source: string;
  account: string;
  time: string;
  region: string;
  resources: string[];
  detail: {
    /** Custom data passed to the event */
    taskType?:
      | "autopilot"
      | "content-publishing"
      | "metrics-collection"
      | "retention"
      | "gdpr";
    /** Additional context for the task */
    context?: Record<string, unknown>;
  };
}

/**
 * Lambda Response for EventBridge handlers
 */
export interface LambdaResponse {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

/**
 * Content Scheduler Event (from our microservice)
 */
export interface ContentSchedulerEvent {
  eventType: "CONTENT_SCHEDULED" | "CONTENT_PUBLISHED" | "CONTENT_FAILED";
  contentId: string;
  brandId: string;
  scheduledTime?: string;
  publishedTime?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}
