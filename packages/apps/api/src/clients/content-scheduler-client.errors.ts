export type ErrorDetails = Record<string, unknown>;

export class SchedulerError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number,
    public details?: ErrorDetails
  ) {
    super(message);
    this.name = 'SchedulerError';
  }
}

export class ValidationError extends SchedulerError {
  constructor(message: string, details?: ErrorDetails) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class NetworkError extends SchedulerError {
  constructor(message: string, details?: ErrorDetails) {
    super(message, 'NETWORK_ERROR', 0, details);
    this.name = 'NetworkError';
  }
}

export class RateLimitError extends SchedulerError {
  constructor(message: string, retryAfter?: number) {
    super(message, 'RATE_LIMIT_ERROR', 429, { retryAfter });
    this.name = 'RateLimitError';
  }
}
