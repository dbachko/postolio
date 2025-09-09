/**
 * Token Service Error Classes
 * Centralized error definitions for better maintainability and type safety
 */

export class TokenServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
    public retryable: boolean = false,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = "TokenServiceError";
    Object.setPrototypeOf(this, TokenServiceError.prototype);
  }
}

export class TokenNotFoundError extends TokenServiceError {
  constructor(userId: string, brandId: string, platform: string) {
    super(
      `Token not found for user ${userId}, brand ${brandId}, platform ${platform}`,
      "TOKEN_NOT_FOUND",
      404,
      false,
    );
  }
}

export class TokenExpiredError extends TokenServiceError {
  constructor(message?: string) {
    super(message || "Token has expired", "TOKEN_EXPIRED", 401, false);
  }
}

export class TokenRefreshError extends TokenServiceError {
  constructor(platform: string, error?: string) {
    super(
      `Failed to refresh ${platform} token: ${error || "Unknown error"}`,
      "TOKEN_REFRESH_FAILED",
      500,
      true,
    );
  }
}

export class RateLimitError extends TokenServiceError {
  constructor(retryAfter?: number) {
    super("Rate limit exceeded", "RATE_LIMIT_EXCEEDED", 429, true, retryAfter);
  }
}

export class ValidationError extends TokenServiceError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 400, false);
  }
}

export class UnauthorizedError extends TokenServiceError {
  constructor(message?: string) {
    super(message || "Unauthorized access", "UNAUTHORIZED", 401, false);
  }
}

export class ServiceUnavailableError extends TokenServiceError {
  constructor(service: string) {
    super(
      `${service} service is temporarily unavailable`,
      "SERVICE_UNAVAILABLE",
      503,
      true,
    );
  }
}
