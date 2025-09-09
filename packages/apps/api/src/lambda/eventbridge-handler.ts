/**
 * Main Lambda handler for EventBridge scheduled events
 * This handler routes EventBridge events to appropriate services
 */

import type {
  EventBridgeScheduledEvent,
  LambdaResponse,
} from "../types/aws-events.js";
import { lambdaHandler as retentionHandler } from "../services/retention-manager.js";
import { autopilotService } from "../services/autopilot.js";
import fastify, { FastifyInstance } from "fastify";

/**
 * Initialize Fastify instance for service use
 */
const initializeFastify = (): FastifyInstance => {
  return fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
      serializers: {
        req: (req) => ({
          method: req.method,
          url: req.url,
          hostname: (req as { hostname?: string }).hostname,
          correlationId: req.id,
        }),
        res: (res) => ({
          statusCode: res.statusCode,
        }),
      },
    },
  });
};

/**
 * Main Lambda handler that routes events to appropriate services
 */
export const handler = async (
  event: EventBridgeScheduledEvent,
): Promise<LambdaResponse> => {
  const app = initializeFastify();

  // Add correlation ID for distributed tracing
  app.log.info(
    {
      eventId: event.id,
      taskType: event.detail?.taskType,
      time: event.time,
      source: event.source,
    },
    "EventBridge event received",
  );

  try {
    const taskType = event.detail?.taskType;

    switch (taskType) {
      case "autopilot":
        // Handle autopilot content generation
        await autopilotService.runAutopilotGeneration();
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: "Autopilot execution completed",
            eventId: event.id,
            timestamp: new Date().toISOString(),
          }),
        };

      case "retention":
      case "gdpr":
        // Delegate to retention manager
        return await retentionHandler(event);

      case "content-publishing":
        // Handle content publishing
        app.log.info("Content publishing task triggered");
        // TODO: Implement content publishing logic
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: "Content publishing completed",
            eventId: event.id,
          }),
        };

      case "metrics-collection":
        // Handle metrics collection
        app.log.info("Metrics collection task triggered");
        // TODO: Implement metrics collection logic
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: "Metrics collection completed",
            eventId: event.id,
          }),
        };

      default:
        app.log.warn({ taskType }, "Unknown task type received");
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "Unknown task type",
            taskType,
            eventId: event.id,
          }),
        };
    }
  } catch (error) {
    app.log.error(
      { error, eventId: event.id },
      "Error processing EventBridge event",
    );

    // Return error response for Lambda
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
        eventId: event.id,
      }),
    };
  } finally {
    // Clean up Fastify instance
    await app.close();
  }
};

/**
 * Export for local testing
 */
export const testHandler = async (
  taskType: EventBridgeScheduledEvent["detail"]["taskType"],
) => {
  const mockEvent: EventBridgeScheduledEvent = {
    version: "0",
    id: `test-${Date.now()}`,
    "detail-type": "Scheduled Task",
    source: "postolio.scheduler.test",
    account: "123456789012",
    time: new Date().toISOString(),
    region: "us-east-1",
    resources: [],
    detail: {
      taskType,
      context: {
        environment: "test",
      },
    },
  };

  return await handler(mockEvent);
};
