/**
 * Schedule Management Lambda
 *
 * Route dispatcher that delegates to focused handlers.
 */

import { Logger } from '@aws-lambda-powertools/logger';
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  APIGatewayProxyEventV2,
} from 'aws-lambda';
import { HttpHandler } from './handlers/http-handler';
import { createErrorResponse } from './utils/response-utils';
import { initSentry, captureException } from '@postolio/observability';

const logger = new Logger({ serviceName: 'schedule-management' });

initSentry({
  serviceName: 'schedule-management',
});

// Initialize handlers
const httpHandler = new HttpHandler();

/**
 * Main Lambda handler - Route dispatcher
 */
export const handler = async (
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2
): Promise<APIGatewayProxyResult> => {
  logger.info('Lambda invocation started', {
    requestId: process.env.AWS_REQUEST_ID,
    eventType: determineEventType(event),
  });

  try {
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

    // For HTTP events, return error response
    return createErrorResponse(
      500,
      'Internal server error',
      process.env.LOG_LEVEL === 'DEBUG' ? { error: String(error) } : undefined
    );
  }
};

/**
 * Determine the event type for logging
 */
function determineEventType(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): string {
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
  }
  return event.requestContext.http.method; // API Gateway v2.0 / Function URL
}

/**
 * Get path from event
 */
function getPath(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): string {
  if ('path' in event) {
    return event.path; // API Gateway v1.0
  }
  return event.requestContext.http.path; // API Gateway v2.0 / Function URL
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

    const allHealthy = httpHealth.statusCode === 200;

    return {
      healthy: allHealthy,
      details: {
        httpHandler: httpHealth.statusCode === 200,
        httpHealthDetails: httpHealth.statusCode === 200 ? 'OK' : httpHealth.body,
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
