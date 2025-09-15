import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import {
  APIError,
  APIErrorResponse,
  InternalServerError,
  ValidationError
} from '@postolio/errors';
import { logger } from '@postolio/logger';

// Type guards for enhanced error handling
interface ExtendedAPIError extends APIError {
  correlationId?: string;
  statusCode: number;
  code: string;
  type: string;
  details?: Record<string, unknown>;
  toJSON(): APIErrorResponse;
}

interface FastifyValidationError extends FastifyError {
  validation?: FastifyError['validation'];
}

interface FastifyHTTPError extends FastifyError {
  statusCode?: number;
}

interface ErrorContext {
  correlationId: string;
  userId?: string;
  endpoint: string;
  method: string;
  userAgent?: string;
  ip?: string;
}

interface AuthenticatedRequest extends FastifyRequest {
  user: {
    id: string;
    email: string;
  };
}

// Type guards
function isAPIError(error: unknown): error is ExtendedAPIError {
  return error instanceof APIError;
}

function hasValidation(error: FastifyError | Error): error is FastifyValidationError {
  return 'validation' in error && Array.isArray((error as FastifyValidationError).validation);
}

function hasStatusCode(error: FastifyError | Error): error is FastifyHTTPError {
  return 'statusCode' in error && typeof (error as FastifyHTTPError).statusCode === 'number';
}

export async function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const context: ErrorContext = {
    correlationId: request.id,
    userId: (request as Partial<AuthenticatedRequest>).user?.id,
    endpoint: request.url,
    method: request.method,
    userAgent: request.headers['user-agent'],
    ip: request.ip,
  };

  // Handle APIError instances (our standardized errors)
  if (isAPIError(error)) {
    error.correlationId = context.correlationId;

    // Log based on error type and severity
    if (error.statusCode >= 500) {
      logger.error(`API Error: ${error.message}`, {
        ...context,
        code: error.code,
        type: error.type,
        details: error.details,
        stack: error.stack,
      });
    } else if (error.statusCode >= 400) {
      logger.warn(`Client Error: ${error.message}`, {
        ...context,
        code: error.code,
        type: error.type,
        details: error.details,
      });
    }

    // Add retry-after header for rate limit errors
    if (error.code === 'RATE_LIMIT_EXCEEDED' && error.details?.retryAfter) {
      reply.header('Retry-After', error.details.retryAfter.toString());
    }

    return reply.status(error.statusCode).send(error.toJSON());
  }

  // Handle Fastify validation errors
  if (hasValidation(error)) {
    const validationError = new ValidationError('Request validation failed', {
      fields: error.validation,
    }) as ExtendedAPIError;
    validationError.correlationId = context.correlationId;

    logger.warn('Validation Error', {
      ...context,
      validation: error.validation,
    });

    return reply.status(400).send(validationError.toJSON());
  }

  // Handle Fastify HTTP errors (like 404, 405, etc.)
  if (hasStatusCode(error)) {
    let apiError: ExtendedAPIError;

    switch (error.statusCode) {
      case 404:
        apiError = new APIError(
          'Endpoint not found',
          'ENDPOINT_NOT_FOUND',
          404,
          'ROUTING_ERROR'
        );
        break;
      case 405:
        apiError = new APIError(
          'Method not allowed',
          'METHOD_NOT_ALLOWED',
          405,
          'ROUTING_ERROR'
        );
        break;
      case 413:
        apiError = new APIError(
          'Request entity too large',
          'PAYLOAD_TOO_LARGE',
          413,
          'REQUEST_ERROR'
        );
        break;
      default:
        apiError = new APIError(
          error.message,
          'HTTP_ERROR',
          error.statusCode || 500,
          'HTTP_ERROR'
        ) as ExtendedAPIError;
    }

    apiError.correlationId = context.correlationId;

    logger.warn(`HTTP Error ${error.statusCode}: ${error.message}`, {
      ...context,
      statusCode: error.statusCode,
    });

    return reply.status(error.statusCode || 500).send(apiError.toJSON());
  }

  // Handle generic errors (convert to InternalServerError)
  const internalError = new InternalServerError('An unexpected error occurred', {
    originalError: error.name,
    // Don't leak internal details in production
    ...(process.env.NODE_ENV === 'development' && {
      stack: error.stack,
      originalMessage: error.message
    }),
  }) as ExtendedAPIError;
  internalError.correlationId = context.correlationId;

  logger.error(`Unexpected Error: ${error.message}`, {
    ...context,
    error: error.name,
    stack: error.stack,
    originalMessage: error.message,
  });

  return reply.status(500).send(internalError.toJSON());
}

// Helper function to create error responses in route handlers
export function createErrorResponse(error: ExtendedAPIError): APIErrorResponse {
  return error.toJSON();
}

// Helper function to send standardized error responses
export function sendError(reply: FastifyReply, error: ExtendedAPIError): void {
  // Add retry-after header for rate limit errors
  if (error.code === 'RATE_LIMIT_EXCEEDED' && error.details?.retryAfter) {
    reply.header('Retry-After', error.details.retryAfter.toString());
  }

  reply.status(error.statusCode).send(error.toJSON());
}