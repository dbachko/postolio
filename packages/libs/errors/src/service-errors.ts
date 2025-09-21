/**
 * Standardized Service Errors
 *
 * Consistent error handling and response formats across all services
 */

export interface ServiceErrorDetails {
  code: string;
  message: string;
  details?: Record<string, any>;
  retryable?: boolean;
  userMessage?: string; // User-friendly message for frontend
}

export interface APIErrorResponse {
  error: string;
  code: string;
  details?: Record<string, any>;
  retryable?: boolean;
  userMessage?: string;
}

export class ServiceError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, any>;
  public readonly retryable: boolean;
  public readonly userMessage?: string;
  public readonly originalError?: Error;

  constructor(details: ServiceErrorDetails, originalError?: Error) {
    super(details.message);
    this.name = 'ServiceError';
    this.code = details.code;
    this.details = details.details;
    this.retryable = details.retryable ?? false;
    this.userMessage = details.userMessage;
    this.originalError = originalError;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ServiceError);
    }
  }

  /**
   * Create a serializable error object
   */
  toJSON(): APIErrorResponse {
    return {
      error: this.message,
      code: this.code,
      details: this.details,
      retryable: this.retryable,
      userMessage: this.userMessage,
    };
  }

  /**
   * Check if error is retryable
   */
  isRetryable(): boolean {
    return this.retryable;
  }
}

/**
 * Common error codes and factories
 */
export const ErrorCodes = {
  // Campaign errors
  CAMPAIGN_NOT_FOUND: 'CAMPAIGN_NOT_FOUND',
  CAMPAIGN_INACTIVE: 'CAMPAIGN_INACTIVE',
  CAMPAIGN_CONSISTENCY_FAILED: 'CAMPAIGN_CONSISTENCY_FAILED',

  // Content errors
  CONTENT_NOT_FOUND: 'CONTENT_NOT_FOUND',
  CONTENT_INVALID: 'CONTENT_INVALID',
  CONTENT_NO_CAMPAIGN: 'CONTENT_NO_CAMPAIGN',

  // Schedule errors
  SCHEDULE_NOT_FOUND: 'SCHEDULE_NOT_FOUND',
  SCHEDULE_ALREADY_EXISTS: 'SCHEDULE_ALREADY_EXISTS',
  SCHEDULE_TIME_INVALID: 'SCHEDULE_TIME_INVALID',

  // Validation errors
  VALIDATION_FAILED: 'VALIDATION_FAILED',

  // Infrastructure errors
  DYNAMODB_ERROR: 'DYNAMODB_ERROR',
  EVENTBRIDGE_ERROR: 'EVENTBRIDGE_ERROR',
  SCHEDULER_ERROR: 'SCHEDULER_ERROR',

  // Authentication/Authorization
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',

  // Rate limiting
  RATE_LIMITED: 'RATE_LIMITED',

  // Generic errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

/**
 * Error factory functions
 */
export class ErrorFactory {
  /**
   * Campaign not found error
   */
  static campaignNotFound(campaignId: string): ServiceError {
    return new ServiceError({
      code: ErrorCodes.CAMPAIGN_NOT_FOUND,
      message: `Campaign not found: ${campaignId}`,
      details: { campaignId },
      retryable: false,
      userMessage: 'The requested campaign could not be found.',
    });
  }

  /**
   * Campaign inactive error
   */
  static campaignInactive(campaignId: string, status: string): ServiceError {
    return new ServiceError({
      code: ErrorCodes.CAMPAIGN_INACTIVE,
      message: `Campaign is not active: ${campaignId} (status: ${status})`,
      details: { campaignId, status },
      retryable: false,
      userMessage: `Cannot perform operation - campaign is ${status.toLowerCase()}.`,
    });
  }

  /**
   * Content not associated with campaign error
   */
  static contentNoCampaign(contentId: string): ServiceError {
    return new ServiceError({
      code: ErrorCodes.CONTENT_NO_CAMPAIGN,
      message: `Content is not associated with a campaign: ${contentId}`,
      details: { contentId },
      retryable: false,
      userMessage: 'All content must be associated with a campaign before scheduling.',
    });
  }

  /**
   * Validation error
   */
  static validationFailed(errors: string[], details?: Record<string, any>): ServiceError {
    return new ServiceError({
      code: ErrorCodes.VALIDATION_FAILED,
      message: `Validation failed: ${errors.join(', ')}`,
      details: { validationErrors: errors, ...details },
      retryable: false,
      userMessage: 'Please check your input and try again.',
    });
  }

  /**
   * DynamoDB error
   */
  static dynamoDBError(operation: string, tableName: string, originalError: Error): ServiceError {
    return new ServiceError({
      code: ErrorCodes.DYNAMODB_ERROR,
      message: `DynamoDB ${operation} failed on table ${tableName}`,
      details: { operation, tableName },
      retryable: true,
      userMessage: 'Database operation failed. Please try again.',
    }, originalError);
  }

  /**
   * EventBridge error
   */
  static eventBridgeError(operation: string, originalError: Error): ServiceError {
    return new ServiceError({
      code: ErrorCodes.EVENTBRIDGE_ERROR,
      message: `EventBridge ${operation} failed`,
      details: { operation },
      retryable: true,
      userMessage: 'Event processing failed. Please try again.',
    }, originalError);
  }

  /**
   * Schedule time invalid error
   */
  static scheduleTimeInvalid(scheduledAt: string, reason: string): ServiceError {
    return new ServiceError({
      code: ErrorCodes.SCHEDULE_TIME_INVALID,
      message: `Invalid schedule time: ${scheduledAt} - ${reason}`,
      details: { scheduledAt, reason },
      retryable: false,
      userMessage: `Invalid schedule time: ${reason}`,
    });
  }

  /**
   * Internal server error
   */
  static internalError(message: string, originalError?: Error): ServiceError {
    return new ServiceError({
      code: ErrorCodes.INTERNAL_ERROR,
      message: `Internal error: ${message}`,
      retryable: true,
      userMessage: 'An unexpected error occurred. Please try again.',
    }, originalError);
  }

  /**
   * Service unavailable error
   */
  static serviceUnavailable(service: string): ServiceError {
    return new ServiceError({
      code: ErrorCodes.SERVICE_UNAVAILABLE,
      message: `${service} service is currently unavailable`,
      details: { service },
      retryable: true,
      userMessage: 'Service is temporarily unavailable. Please try again later.',
    });
  }

  /**
   * Rate limited error
   */
  static rateLimited(retryAfterSeconds?: number): ServiceError {
    return new ServiceError({
      code: ErrorCodes.RATE_LIMITED,
      message: 'Request rate limit exceeded',
      details: { retryAfterSeconds },
      retryable: true,
      userMessage: 'Too many requests. Please wait and try again.',
    });
  }
}

/**
 * Result wrapper for service operations
 */
export interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: ServiceError;
}

/**
 * Create successful result
 */
export function createSuccessResult<T>(data: T): ServiceResult<T> {
  return {
    success: true,
    data,
  };
}

/**
 * Create error result
 */
export function createErrorResult<T>(error: ServiceError): ServiceResult<T> {
  return {
    success: false,
    error,
  };
}

/**
 * Wrap a function to handle errors consistently
 */
export function wrapServiceOperation<T, Args extends any[]>(
  operation: (...args: Args) => Promise<T>,
  errorContext: { operation: string; service: string }
) {
  return async (...args: Args): Promise<ServiceResult<T>> => {
    try {
      const result = await operation(...args);
      return createSuccessResult(result);
    } catch (error) {
      if (error instanceof ServiceError) {
        return createErrorResult(error);
      }

      // Convert unexpected errors to ServiceError
      const serviceError = ErrorFactory.internalError(
        `${errorContext.service} ${errorContext.operation} failed`,
        error instanceof Error ? error : new Error(String(error))
      );

      return createErrorResult(serviceError);
    }
  };
}

/**
 * Check if an error is a specific service error
 */
export function isServiceError(error: any, code?: string): error is ServiceError {
  if (!(error instanceof ServiceError)) {
    return false;
  }

  if (code) {
    return error.code === code;
  }

  return true;
}

/**
 * Legacy error classes for backward compatibility
 */
export class APIError extends ServiceError {
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number = 400, details?: Record<string, any>) {
    super({
      code,
      message,
      details,
      retryable: false,
    });
    this.statusCode = statusCode;
  }
}

export class ValidationError extends APIError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class InternalServerError extends APIError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'INTERNAL_SERVER_ERROR', 500, details);
  }
}