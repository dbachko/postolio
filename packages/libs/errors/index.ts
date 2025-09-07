export class TokenServiceError extends Error {
  constructor(message: string, public code: string, public statusCode?: number, public isRetryable?: boolean) {
    super(message);
    this.name = 'TokenServiceError';
  }
}

export class RateLimitError extends TokenServiceError {
  constructor(public retryAfter: number) {
    super(`Rate limit exceeded. Try again in ${retryAfter} seconds.`, 'RATE_LIMIT_EXCEEDED', 429, false);
    this.name = 'RateLimitError';
  }
}

export class ValidationError extends TokenServiceError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400, false);
    this.name = 'ValidationError';
  }
}
