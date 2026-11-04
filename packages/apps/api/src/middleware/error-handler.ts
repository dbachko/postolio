import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import {
  APIError,
  type APIErrorResponse,
  InternalServerError,
  ValidationError,
} from '@postolio/errors';
import { logger } from '@postolio/logger';
import { captureException } from '@postolio/observability';

interface ExtendedAPIError extends APIError {
  correlationId?: string;
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

function buildErrorContext(request: FastifyRequest): ErrorContext {
  return {
    correlationId: request.id,
    userId: (request as Partial<AuthenticatedRequest>).user?.id,
    endpoint: request.url,
    method: request.method,
    userAgent: request.headers['user-agent'],
    ip: request.ip,
  };
}

function handleCsrfError(
  error: FastifyError | Error,
  reply: FastifyReply,
  context: ErrorContext
): FastifyReply | null {
  if (!(error instanceof Error) || !/csrf/i.test(error.message)) {
    return null;
  }

  logger.warn('CSRF validation failed', { ...context, message: error.message });
  return reply.code(403).send({
    error: 'Invalid or missing CSRF token',
    code: 'CSRF_VALIDATION_FAILED',
  });
}

function sendApiError(
  error: ExtendedAPIError,
  reply: FastifyReply,
  context: ErrorContext
): FastifyReply {
  error.correlationId = context.correlationId;
  const payload = error.toJSON() as APIErrorResponse & { correlationId?: string };
  payload.correlationId = context.correlationId;

  if (error.statusCode >= 500) {
    logger.error(`API Error: ${error.message}`, {
      ...context,
      code: error.code,
      details: error.details,
      stack: error.stack,
    });
    captureException(error, {
      ...context,
      code: error.code,
      details: error.details,
      type: 'APIError',
    });
  } else if (error.statusCode >= 400) {
    logger.warn(`Client Error: ${error.message}`, {
      ...context,
      code: error.code,
      details: error.details,
    });
  }

  if (error.code === 'RATE_LIMIT_EXCEEDED' && error.details?.retryAfter) {
    reply.header('Retry-After', error.details.retryAfter.toString());
  }
  return reply.status(error.statusCode).send(payload);
}

function sendValidationError(
  error: FastifyValidationError,
  reply: FastifyReply,
  context: ErrorContext
): FastifyReply {
  const validationError = new ValidationError('Request validation failed', {
    fields: error.validation,
  }) as ExtendedAPIError;
  validationError.correlationId = context.correlationId;
  const payload = validationError.toJSON() as APIErrorResponse & { correlationId?: string };
  payload.correlationId = context.correlationId;

  logger.warn('Validation Error', { ...context, validation: error.validation });
  return reply.status(400).send(payload);
}

function mapHttpError(error: FastifyHTTPError): ExtendedAPIError {
  switch (error.statusCode) {
    case 404:
      return new APIError('Endpoint not found', 'ENDPOINT_NOT_FOUND', 404, {
        type: 'ROUTING_ERROR',
      }) as ExtendedAPIError;
    case 405:
      return new APIError('Method not allowed', 'METHOD_NOT_ALLOWED', 405, {
        type: 'ROUTING_ERROR',
      }) as ExtendedAPIError;
    case 413:
      return new APIError('Request entity too large', 'PAYLOAD_TOO_LARGE', 413, {
        type: 'REQUEST_ERROR',
      }) as ExtendedAPIError;
    default:
      return new APIError(error.message, 'HTTP_ERROR', error.statusCode || 500, {
        type: 'HTTP_ERROR',
      }) as ExtendedAPIError;
  }
}

function sendHttpError(
  error: FastifyHTTPError,
  reply: FastifyReply,
  context: ErrorContext
): FastifyReply {
  const apiError = mapHttpError(error);
  apiError.correlationId = context.correlationId;
  const payload = apiError.toJSON() as APIErrorResponse & { correlationId?: string };
  payload.correlationId = context.correlationId;

  logger.warn(`HTTP Error ${error.statusCode}: ${error.message}`, {
    ...context,
    statusCode: error.statusCode,
  });

  if ((error.statusCode || 500) >= 500) {
    captureException(error, { ...context, type: 'HTTPError', statusCode: error.statusCode });
  }
  return reply.status(error.statusCode || 500).send(payload);
}

function sendUnexpectedError(
  error: FastifyError | Error,
  reply: FastifyReply,
  context: ErrorContext
): FastifyReply {
  const internalError = new InternalServerError('An unexpected error occurred', {
    originalError: error.name,
    ...(process.env.NODE_ENV === 'dev' && {
      stack: error.stack,
      originalMessage: error.message,
    }),
  }) as ExtendedAPIError;
  internalError.correlationId = context.correlationId;
  const payload = internalError.toJSON() as APIErrorResponse & { correlationId?: string };
  payload.correlationId = context.correlationId;

  logger.error(`Unexpected Error: ${error.message}`, {
    ...context,
    error: error.name,
    stack: error.stack,
    originalMessage: error.message,
  });
  captureException(error, { ...context, type: 'UnexpectedError' });
  return reply.status(500).send(payload);
}

export async function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const context = buildErrorContext(request);
  const csrfReply = handleCsrfError(error, reply, context);
  if (csrfReply) {
    return;
  }
  if (isAPIError(error)) {
    void sendApiError(error, reply, context);
    return;
  }
  if (hasValidation(error)) {
    void sendValidationError(error, reply, context);
    return;
  }
  if (hasStatusCode(error)) {
    void sendHttpError(error, reply, context);
    return;
  }
  void sendUnexpectedError(error, reply, context);
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
