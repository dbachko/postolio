/**
 * Response Utilities
 *
 * Standardized HTTP response helpers
 * Ensures consistent response format across all endpoints
 */

import type { APIGatewayProxyResult } from 'aws-lambda';

/**
 * Create a successful HTTP response
 */
export function createSuccessResponse(
  statusCode: number,
  data?: unknown,
  headers?: Record<string, string>
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body:
      data !== null
        ? JSON.stringify({
            success: true,
            data,
            timestamp: new Date().toISOString(),
          })
        : '',
  };
}

/**
 * Create an error HTTP response
 */
export function createErrorResponse(
  statusCode: number,
  message: string,
  details?: unknown,
  code?: string
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      error: message,
      ...(code && { code }),
      ...(details && { details }),
    }),
  };
}

/**
 * Create a validation error response
 */
export function createValidationErrorResponse(
  errors: string[],
  headers?: Record<string, string>
): APIGatewayProxyResult {
  return createErrorResponse(400, 'Validation failed', { validationErrors: errors }, headers);
}

/**
 * Create a not found response
 */
export function createNotFoundResponse(
  resource: string,
  headers?: Record<string, string>
): APIGatewayProxyResult {
  return createErrorResponse(404, `${resource} not found`, undefined, headers);
}

/**
 * Create a method not allowed response
 */
export function createMethodNotAllowedResponse(
  allowedMethods: string[],
  headers?: Record<string, string>
): APIGatewayProxyResult {
  return createErrorResponse(
    405,
    'Method not allowed',
    { allowedMethods },
    {
      Allow: allowedMethods.join(', '),
      ...headers,
    }
  );
}

/**
 * Create an internal server error response
 */
export function createInternalServerErrorResponse(
  message?: string,
  details?: unknown,
  headers?: Record<string, string>
): APIGatewayProxyResult {
  return createErrorResponse(500, message || 'Internal server error', details, headers);
}

/**
 * Create a service unavailable response
 */
export function createServiceUnavailableResponse(
  service: string,
  headers?: Record<string, string>
): APIGatewayProxyResult {
  return createErrorResponse(503, `${service} service unavailable`, undefined, headers);
}
