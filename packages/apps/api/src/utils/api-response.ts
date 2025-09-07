/**
 * Standardized API Response Utilities
 * Ensures consistent response format across all endpoints
 */

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta?: {
    timestamp: string;
    version?: string;
    [key: string]: unknown;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  code?: string;
  details?: string[] | Record<string, unknown>;
  meta?: {
    timestamp: string;
    requestId?: string;
    [key: string]: unknown;
  };
}

export interface ApiPaginatedResponse<T = unknown>
  extends ApiSuccessResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Create a successful API response
 */
export function successResponse<T>(
  data: T,
  meta?: Record<string, unknown>,
): ApiSuccessResponse<T> {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };
}

/**
 * Create a paginated API response
 */
export function paginatedResponse<T>(
  data: T[],
  page: number,
  limit: number,
  total: number,
  meta?: Record<string, unknown>,
): ApiPaginatedResponse<T> {
  const pages = Math.ceil(total / limit);
  return {
    success: true,
    data,
    pagination: {
      page,
      limit,
      total,
      pages,
      hasNext: page < pages,
      hasPrev: page > 1,
    },
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };
}

/**
 * Create an error API response
 */
export function errorResponse(
  error: string,
  code?: string,
  details?: string[] | Record<string, unknown>,
  meta?: Record<string, unknown>,
): ApiErrorResponse {
  const response: ApiErrorResponse = {
    success: false,
    error,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };

  if (code !== undefined) {
    response.code = code;
  }

  if (details !== undefined) {
    response.details = details;
  }

  return response;
}

/**
 * Common HTTP error responses
 */
export const ErrorResponses = {
  badRequest: (
    message = "Bad request",
    details?: string[] | Record<string, unknown>,
  ) => errorResponse(message, "BAD_REQUEST", details),

  unauthorized: (message = "Unauthorized") =>
    errorResponse(message, "UNAUTHORIZED"),

  forbidden: (message = "Forbidden") => errorResponse(message, "FORBIDDEN"),

  notFound: (resource = "Resource") =>
    errorResponse(`${resource} not found`, "NOT_FOUND"),

  conflict: (
    message = "Resource conflict",
    details?: string[] | Record<string, unknown>,
  ) => errorResponse(message, "CONFLICT", details),

  unprocessable: (
    message = "Unprocessable entity",
    details?: string[] | Record<string, unknown>,
  ) => errorResponse(message, "UNPROCESSABLE_ENTITY", details),

  tooManyRequests: (retryAfter?: number) =>
    errorResponse("Too many requests", "TOO_MANY_REQUESTS", undefined, {
      retryAfter,
    }),

  internalError: (message = "Internal server error", requestId?: string) =>
    errorResponse(message, "INTERNAL_ERROR", undefined, { requestId }),

  serviceUnavailable: (
    message = "Service temporarily unavailable",
    retryAfter?: number,
  ) => errorResponse(message, "SERVICE_UNAVAILABLE", undefined, { retryAfter }),
};

/**
 * Extract error message from various error types
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "An unknown error occurred";
}

/**
 * Convert validation errors to standardized format
 */
export function formatValidationErrors(
  errors: Array<{ path?: string[]; message: string }>,
): string[] {
  return errors.map((error) => {
    if (error.path && error.path.length > 0) {
      return `${error.path.join(".")}: ${error.message}`;
    }
    return error.message;
  });
}
