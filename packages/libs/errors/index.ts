// Standardized API Error Response Interface
export interface APIErrorResponse {
  error: {
    message: string;
    code: string;
    type: string;
    details?: Record<string, unknown>;
    timestamp: string;
    correlationId?: string;
  };
}

// Base error class for all API errors
export class APIError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number,
    public type: string = 'API_ERROR',
    public details?: Record<string, unknown>,
    public correlationId?: string,
    public isRetryable: boolean = false
  ) {
    super(message);
    this.name = this.constructor.name;
  }

  toJSON(): APIErrorResponse {
    return {
      error: {
        message: this.message,
        code: this.code,
        type: this.type,
        details: this.details,
        timestamp: new Date().toISOString(),
        correlationId: this.correlationId,
      },
    };
  }
}

// Authentication and authorization errors
export class AuthenticationError extends APIError {
  constructor(message: string = 'Authentication required', details?: Record<string, unknown>) {
    super(message, 'AUTHENTICATION_REQUIRED', 401, 'AUTH_ERROR', details);
  }
}

export class AuthorizationError extends APIError {
  constructor(message: string = 'Insufficient permissions', details?: Record<string, unknown>) {
    super(message, 'INSUFFICIENT_PERMISSIONS', 403, 'AUTH_ERROR', details);
  }
}

// Validation errors
export class ValidationError extends APIError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, 'VALIDATION_ERROR', details);
  }
}

// Rate limiting errors
export class RateLimitError extends APIError {
  constructor(
    public retryAfter: number,
    message?: string
  ) {
    super(
      message || `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
      'RATE_LIMIT_EXCEEDED',
      429,
      'RATE_LIMIT_ERROR',
      { retryAfter },
      undefined,
      true
    );
  }
}

// Resource errors
export class NotFoundError extends APIError {
  constructor(resource: string, identifier?: string) {
    const message = identifier ? `${resource} '${identifier}' not found` : `${resource} not found`;
    super(message, 'RESOURCE_NOT_FOUND', 404, 'RESOURCE_ERROR', {
      resource,
      identifier,
    });
  }
}

export class ConflictError extends APIError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'RESOURCE_CONFLICT', 409, 'RESOURCE_ERROR', details);
  }
}

// Token service specific errors
export class TokenServiceError extends APIError {
  constructor(message: string, code: string, statusCode?: number, isRetryable?: boolean) {
    super(
      message,
      code,
      statusCode || 500,
      'TOKEN_SERVICE_ERROR',
      undefined,
      undefined,
      isRetryable
    );
    this.name = 'TokenServiceError';
  }
}

// Server errors
export class InternalServerError extends APIError {
  constructor(message: string = 'Internal server error', details?: Record<string, unknown>) {
    super(message, 'INTERNAL_SERVER_ERROR', 500, 'SERVER_ERROR', details, undefined, true);
  }
}

export class ServiceUnavailableError extends APIError {
  constructor(service: string, details?: Record<string, unknown>) {
    super(
      `${service} service is currently unavailable`,
      'SERVICE_UNAVAILABLE',
      503,
      'SERVICE_ERROR',
      { service, ...details },
      undefined,
      true
    );
  }
}

// Business logic errors
export class BusinessRuleError extends APIError {
  constructor(message: string, rule: string, details?: Record<string, unknown>) {
    super(message, 'BUSINESS_RULE_VIOLATION', 422, 'BUSINESS_ERROR', {
      rule,
      ...details,
    });
  }
}
