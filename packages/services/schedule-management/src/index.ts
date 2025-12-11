/**
 * Schedule Management Lambda - Refactored
 *
 * Route dispatcher that delegates to focused handlers
 * Replaces the monolithic handler with clean separation of concerns
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { APIGatewayProxyEvent, APIGatewayProxyResult, APIGatewayProxyEventV2 } from 'aws-lambda';
import { HttpHandler } from './handlers/http-handler';
import { CampaignEventHandler, type EventBridgeEvent } from './handlers/campaign-event-handler';
import { createErrorResponse } from './utils/response-utils';
import { initSentry, captureException } from '@postolio/observability';

const logger = new Logger({ serviceName: 'schedule-management' });

initSentry({
  serviceName: 'schedule-management',
});

// Initialize handlers
const httpHandler = new HttpHandler();
const campaignEventHandler = new CampaignEventHandler();

/**
 * Main Lambda handler - Route dispatcher
 */
export const handler = async (
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2 | EventBridgeEvent
): Promise<APIGatewayProxyResult | void> => {
  logger.info('Lambda invocation started', {
    requestId: process.env.AWS_REQUEST_ID,
    eventType: determineEventType(event),
  });

  try {
    // Check if this is an EventBridge event
    if (isEventBridgeEvent(event)) {
      logger.info('Routing to campaign event handler', {
        source: event.source,
        detailType: event['detail-type'],
      });

      await campaignEventHandler.handle(event as EventBridgeEvent);
      return; // EventBridge events don't need HTTP responses
    }

    // Handle HTTP events (API Gateway / Function URL)
    logger.info('Routing to HTTP handler', {
      method: getMethod(event as APIGatewayProxyEvent | APIGatewayProxyEventV2),
      path: getPath(event as APIGatewayProxyEvent | APIGatewayProxyEventV2),
    });

    const result = await httpHandler.handle(event as APIGatewayProxyEvent | APIGatewayProxyEventV2);

    logger.info('HTTP request completed', {
      statusCode: result.statusCode,
    });

    return result;
  } catch (error) {
    logger.error('Lambda execution failed', { error });

    captureException(error, {
      function: 'schedule-management',
      eventType: determineEventType(event),
    });

    // For EventBridge events, re-throw to trigger DLQ
    if (isEventBridgeEvent(event)) {
      throw error;
    }

    // For HTTP events, return error response
    return createErrorResponse(
      500,
      'Internal server error',
      process.env.LOG_LEVEL === 'DEBUG' ? { error: String(error) } : undefined
    );
  }
};

/**
 * Determine if this is an EventBridge event
 */
function isEventBridgeEvent(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2 | EventBridgeEvent
): event is EventBridgeEvent {
  return (
    'source' in event &&
    event.source === 'postolio.campaign' &&
    'detail-type' in event &&
    'detail' in event
  );
}

/**
 * Determine the event type for logging
 */
function determineEventType(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2 | EventBridgeEvent
): string {
  if (isEventBridgeEvent(event)) {
    return 'EventBridge';
  }

  if ('requestContext' in event && event.requestContext) {
    if ('http' in event.requestContext) {
      return 'Function URL';
    }
    return 'API Gateway';
  }

  return 'Unknown';
}

/**
 * Get HTTP method from event
 */
function getMethod(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): string {
  if ('httpMethod' in event) {
    return event.httpMethod; // API Gateway v1.0
  } else {
    return event.requestContext.http.method; // API Gateway v2.0 / Function URL
  }
}

/**
 * Get path from event
 */
function getPath(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): string {
  if ('path' in event) {
    return event.path; // API Gateway v1.0
  } else {
    return event.requestContext.http.path; // API Gateway v2.0 / Function URL
  }
}

/**
 * Health check handler (can be called directly for monitoring)
 */
export const healthCheck = async (): Promise<{
  healthy: boolean;
  details: Record<string, unknown>;
  timestamp: string;
}> => {
  try {
    // Check HTTP handler health
    const httpHealth = await httpHandler.handle({
      requestContext: {
        http: {
          method: 'GET',
          path: '/health',
        },
      },
    } as APIGatewayProxyEventV2);

    // Check campaign event handler health
    const campaignEventHealth = await campaignEventHandler.healthCheck();

    const allHealthy = httpHealth.statusCode === 200 && campaignEventHealth.healthy;

    return {
      healthy: allHealthy,
      details: {
        httpHandler: httpHealth.statusCode === 200,
        campaignEventHandler: campaignEventHealth.healthy,
        httpHealthDetails: httpHealth.statusCode === 200 ? 'OK' : httpHealth.body,
        campaignEventDetails: campaignEventHealth.details,
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('Health check failed', { error });
    return {
      healthy: false,
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      timestamp: new Date().toISOString(),
    };
  }
};
