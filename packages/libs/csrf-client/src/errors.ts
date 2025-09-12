/**
 * @postolio/csrf-client - Error Types
 * Specialized error classes for CSRF token management
 */

/**
 * Error codes for CSRF token operations
 */
export enum CSRFErrorCode {
  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  ABORTED = 'ABORTED',
  
  // Response errors
  INVALID_RESPONSE = 'INVALID_RESPONSE',
  UNAUTHORIZED = 'UNAUTHORIZED',
  RATE_LIMITED = 'RATE_LIMITED',
  SERVER_ERROR = 'SERVER_ERROR',
  
  // Storage errors
  STORAGE_ERROR = 'STORAGE_ERROR',
  STORAGE_QUOTA_EXCEEDED = 'STORAGE_QUOTA_EXCEEDED',
  STORAGE_UNAVAILABLE = 'STORAGE_UNAVAILABLE',
  
  // Token errors
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  TOKEN_MISSING = 'TOKEN_MISSING',
  
  // Circuit breaker
  CIRCUIT_OPEN = 'CIRCUIT_OPEN',
  MAX_RETRIES_EXCEEDED = 'MAX_RETRIES_EXCEEDED',
  
  // Configuration errors
  INVALID_CONFIG = 'INVALID_CONFIG',
  INVALID_ENDPOINT = 'INVALID_ENDPOINT',
}

/**
 * Severity levels for errors
 */
export enum CSRFErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * Base error class for CSRF token operations
 */
export class CSRFTokenError extends Error {
  public readonly code: CSRFErrorCode;
  public readonly severity: CSRFErrorSeverity;
  public readonly timestamp: number;
  public readonly details?: unknown;
  public readonly statusCode?: number;
  public readonly retryable: boolean;
  public readonly retryAfter?: number;

  constructor(
    message: string,
    code: CSRFErrorCode,
    options?: {
      severity?: CSRFErrorSeverity;
      details?: unknown;
      statusCode?: number;
      retryable?: boolean;
      retryAfter?: number;
      cause?: Error;
    }
  ) {
    super(message, { cause: options?.cause });
    this.name = 'CSRFTokenError';
    this.code = code;
    this.severity = options?.severity ?? this.inferSeverity(code);
    this.timestamp = Date.now();
    this.details = options?.details;
    this.statusCode = options?.statusCode;
    this.retryable = options?.retryable ?? this.inferRetryable(code);
    this.retryAfter = options?.retryAfter;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CSRFTokenError);
    }
  }

  /**
   * Infer severity based on error code
   */
  private inferSeverity(code: CSRFErrorCode): CSRFErrorSeverity {
    switch (code) {
      case CSRFErrorCode.NETWORK_ERROR:
      case CSRFErrorCode.TIMEOUT:
      case CSRFErrorCode.RATE_LIMITED:
        return CSRFErrorSeverity.MEDIUM;
      
      case CSRFErrorCode.UNAUTHORIZED:
      case CSRFErrorCode.TOKEN_INVALID:
      case CSRFErrorCode.INVALID_CONFIG:
        return CSRFErrorSeverity.HIGH;
      
      case CSRFErrorCode.SERVER_ERROR:
      case CSRFErrorCode.STORAGE_UNAVAILABLE:
        return CSRFErrorSeverity.CRITICAL;
      
      default:
        return CSRFErrorSeverity.LOW;
    }
  }

  /**
   * Infer if error is retryable based on code
   */
  private inferRetryable(code: CSRFErrorCode): boolean {
    switch (code) {
      case CSRFErrorCode.NETWORK_ERROR:
      case CSRFErrorCode.TIMEOUT:
      case CSRFErrorCode.RATE_LIMITED:
      case CSRFErrorCode.SERVER_ERROR:
      case CSRFErrorCode.STORAGE_ERROR:
        return true;
      
      case CSRFErrorCode.UNAUTHORIZED:
      case CSRFErrorCode.TOKEN_INVALID:
      case CSRFErrorCode.INVALID_CONFIG:
      case CSRFErrorCode.CIRCUIT_OPEN:
      case CSRFErrorCode.MAX_RETRIES_EXCEEDED:
        return false;
      
      default:
        return false;
    }
  }

  /**
   * Convert error to JSON for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      severity: this.severity,
      timestamp: this.timestamp,
      statusCode: this.statusCode,
      retryable: this.retryable,
      retryAfter: this.retryAfter,
      details: this.details,
      stack: this.stack,
    };
  }

  /**
   * Create error from HTTP response
   */
  static fromResponse(response: Response, message?: string): CSRFTokenError {
    const baseMessage = message ?? `HTTP ${response.status}: ${response.statusText}`;
    
    // Map HTTP status codes to error codes
    let code: CSRFErrorCode;
    let severity: CSRFErrorSeverity;
    let retryable = false;
    let retryAfter: number | undefined;

    switch (response.status) {
      case 401:
        code = CSRFErrorCode.UNAUTHORIZED;
        severity = CSRFErrorSeverity.HIGH;
        break;
      
      case 429: {
        code = CSRFErrorCode.RATE_LIMITED;
        severity = CSRFErrorSeverity.MEDIUM;
        retryable = true;
        const retryHeader = response.headers.get('Retry-After');
        if (retryHeader) {
          retryAfter = parseInt(retryHeader, 10) * 1000;
        }
        break;
      }
      
      case 500:
      case 502:
      case 503:
      case 504:
        code = CSRFErrorCode.SERVER_ERROR;
        severity = CSRFErrorSeverity.CRITICAL;
        retryable = true;
        break;
      
      default:
        code = CSRFErrorCode.INVALID_RESPONSE;
        severity = CSRFErrorSeverity.MEDIUM;
        break;
    }

    return new CSRFTokenError(baseMessage, code, {
      severity,
      statusCode: response.status,
      retryable,
      retryAfter,
      details: {
        url: response.url,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
      },
    });
  }

  /**
   * Create error from fetch failure
   */
  static fromFetchError(error: unknown, url: string): CSRFTokenError {
    if (error instanceof DOMException) {
      if (error.name === 'AbortError') {
        return new CSRFTokenError(
          'Request was aborted',
          CSRFErrorCode.ABORTED,
          {
            severity: CSRFErrorSeverity.LOW,
            retryable: false,
            cause: error as Error,
          }
        );
      }
      
      if (error.name === 'TimeoutError') {
        return new CSRFTokenError(
          'Request timed out',
          CSRFErrorCode.TIMEOUT,
          {
            severity: CSRFErrorSeverity.MEDIUM,
            retryable: true,
            cause: error as Error,
          }
        );
      }
    }

    return new CSRFTokenError(
      `Network error while fetching ${url}`,
      CSRFErrorCode.NETWORK_ERROR,
      {
        severity: CSRFErrorSeverity.MEDIUM,
        retryable: true,
        details: { url, originalError: error },
        cause: error as Error,
      }
    );
  }

  /**
   * Create error from storage operation
   */
  static fromStorageError(error: unknown, operation: string): CSRFTokenError {
    let code = CSRFErrorCode.STORAGE_ERROR;
    let message = `Storage ${operation} failed`;

    if (error instanceof DOMException) {
      if (error.name === 'QuotaExceededError') {
        code = CSRFErrorCode.STORAGE_QUOTA_EXCEEDED;
        message = 'Storage quota exceeded';
      } else if (error.name === 'SecurityError') {
        code = CSRFErrorCode.STORAGE_UNAVAILABLE;
        message = 'Storage access denied (possibly in private mode)';
      }
    }

    return new CSRFTokenError(message, code, {
      severity: CSRFErrorSeverity.LOW,
      retryable: code !== CSRFErrorCode.STORAGE_QUOTA_EXCEEDED,
      details: { operation, originalError: error },
      cause: error as Error,
    });
  }
}

/**
 * Error aggregator for multiple failures
 */
export class CSRFAggregateError extends Error {
  constructor(
    message: string,
    public readonly errors: CSRFTokenError[]
  ) {
    super(message);
    this.name = 'CSRFAggregateError';
  }

  /**
   * Get the most severe error
   */
  getMostSevere(): CSRFTokenError | undefined {
    const severityOrder = {
      [CSRFErrorSeverity.CRITICAL]: 4,
      [CSRFErrorSeverity.HIGH]: 3,
      [CSRFErrorSeverity.MEDIUM]: 2,
      [CSRFErrorSeverity.LOW]: 1,
    };

    return this.errors.reduce((mostSevere, error) => {
      if (!mostSevere) return error;
      const currentSeverity = severityOrder[error.severity];
      const mostSevereSeverity = severityOrder[mostSevere.severity];
      return currentSeverity > mostSevereSeverity ? error : mostSevere;
    }, undefined as CSRFTokenError | undefined);
  }

  /**
   * Check if any error is retryable
   */
  hasRetryableError(): boolean {
    return this.errors.some(error => error.retryable);
  }
}