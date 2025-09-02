/**
 * Shared Error Classes for Lambda Functions
 * Centralized error definitions for better maintainability
 */

export class TokenServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'TokenServiceError';
    Object.setPrototypeOf(this, TokenServiceError.prototype);
  }
}

export class PublisherError extends Error {
  constructor(
    message: string,
    public code: string,
    public platform?: string,
    public scheduleId?: string
  ) {
    super(message);
    this.name = 'PublisherError';
    Object.setPrototypeOf(this, PublisherError.prototype);
  }
}

export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class UnauthorizedError extends Error {
  constructor(message?: string) {
    super(message || 'Unauthorized access');
    this.name = 'UnauthorizedError';
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

export class RateLimitError extends Error {
  constructor(public retryAfter?: number) {
    super('Rate limit exceeded');
    this.name = 'RateLimitError';
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}