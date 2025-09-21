/**
 * Standardized Logger Service
 *
 * Creates consistent, structured logging across all services
 * Replaces console.error calls with proper structured logging
 */

import { Logger as PowertoolsLogger } from '@aws-lambda-powertools/logger';

export interface LogContext {
  [key: string]: any;
}

export interface ErrorContext extends LogContext {
  error: Error | string | unknown;
  operation?: string;
  userId?: string;
  brandId?: string;
  campaignId?: string;
  contentId?: string;
  scheduleId?: string;
}

/**
 * Create a service-specific logger instance
 */
export function createServiceLogger(serviceName: string): ServiceLogger {
  const logger = new PowertoolsLogger({
    serviceName,
    logLevel: (process.env.LOG_LEVEL as any) || 'INFO',
  });

  return new ServiceLogger(logger, serviceName);
}

/**
 * Service Logger with standardized methods
 */
export class ServiceLogger {
  constructor(
    private logger: PowertoolsLogger,
    private serviceName: string
  ) {}

  /**
   * Log info message with context
   */
  info(message: string, context?: LogContext): void {
    this.logger.info(message, {
      service: this.serviceName,
      ...context,
    });
  }

  /**
   * Log warning message with context
   */
  warn(message: string, context?: LogContext): void {
    this.logger.warn(message, {
      service: this.serviceName,
      ...context,
    });
  }

  /**
   * Log error with structured context
   */
  error(message: string, context: ErrorContext): void {
    const errorInfo = this.extractErrorInfo(context.error);

    this.logger.error(message, {
      service: this.serviceName,
      operation: context.operation,
      userId: context.userId,
      brandId: context.brandId,
      campaignId: context.campaignId,
      contentId: context.contentId,
      scheduleId: context.scheduleId,
      error: {
        name: errorInfo.name,
        message: errorInfo.message,
        stack: errorInfo.stack,
        type: errorInfo.type,
      },
      ...this.excludeError(context),
    });
  }

  /**
   * Log debug message (only in debug mode)
   */
  debug(message: string, context?: LogContext): void {
    this.logger.debug(message, {
      service: this.serviceName,
      ...context,
    });
  }

  /**
   * Log operation start
   */
  operationStart(operation: string, context?: LogContext): void {
    this.info(`Starting operation: ${operation}`, {
      operation,
      phase: 'start',
      ...context,
    });
  }

  /**
   * Log operation success
   */
  operationSuccess(operation: string, context?: LogContext): void {
    this.info(`Operation completed successfully: ${operation}`, {
      operation,
      phase: 'success',
      ...context,
    });
  }

  /**
   * Log operation failure
   */
  operationFailure(operation: string, error: Error | string | unknown, context?: LogContext): void {
    this.error(`Operation failed: ${operation}`, {
      operation,
      phase: 'failure',
      error,
      ...context,
    });
  }

  /**
   * Log validation error
   */
  validationError(message: string, validationErrors: string[], context?: LogContext): void {
    this.warn(`Validation failed: ${message}`, {
      validationErrors,
      operation: 'validation',
      ...context,
    });
  }

  /**
   * Log consistency issue
   */
  consistencyIssue(message: string, context: LogContext & {
    expected?: any;
    actual?: any;
    source?: string;
  }): void {
    this.warn(`Data consistency issue: ${message}`, {
      type: 'consistency_issue',
      expected: context.expected,
      actual: context.actual,
      source: context.source,
      ...this.excludeKeys(context, ['expected', 'actual', 'source']),
    });
  }

  /**
   * Log security event
   */
  securityEvent(message: string, context: LogContext & {
    severity: 'low' | 'medium' | 'high' | 'critical';
    eventType: string;
  }): void {
    this.warn(`Security event: ${message}`, {
      type: 'security_event',
      severity: context.severity,
      eventType: context.eventType,
      timestamp: new Date().toISOString(),
      ...this.excludeKeys(context, ['severity', 'eventType']),
    });
  }

  /**
   * Log performance metric
   */
  performance(operation: string, durationMs: number, context?: LogContext): void {
    this.info(`Performance: ${operation}`, {
      operation,
      type: 'performance',
      durationMs,
      ...context,
    });
  }

  /**
   * Extract error information from various error types
   */
  private extractErrorInfo(error: Error | string | unknown): {
    name: string;
    message: string;
    stack?: string;
    type: string;
  } {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: process.env.LOG_LEVEL === 'DEBUG' ? error.stack : undefined,
        type: 'Error',
      };
    }

    if (typeof error === 'string') {
      return {
        name: 'StringError',
        message: error,
        type: 'string',
      };
    }

    if (error && typeof error === 'object') {
      return {
        name: 'ObjectError',
        message: JSON.stringify(error),
        type: 'object',
      };
    }

    return {
      name: 'UnknownError',
      message: String(error),
      type: typeof error,
    };
  }

  /**
   * Remove error from context to avoid duplication
   */
  private excludeError(context: ErrorContext): Omit<ErrorContext, 'error'> {
    const { error, ...rest } = context;
    return rest;
  }

  /**
   * Remove specific keys from context
   */
  private excludeKeys<T extends Record<string, any>, K extends keyof T>(
    obj: T,
    keys: K[]
  ): Omit<T, K> {
    const result = { ...obj };
    keys.forEach(key => delete result[key]);
    return result;
  }
}

/**
 * Convenience functions for common logging patterns
 */

/**
 * Log AWS SDK errors with proper context
 */
export function logAWSError(
  logger: ServiceLogger,
  operation: string,
  error: any,
  context?: LogContext
): void {
  logger.error(`AWS operation failed: ${operation}`, {
    operation,
    error,
    awsError: {
      code: error.$metadata?.httpStatusCode,
      requestId: error.$metadata?.requestId,
      service: error.$metadata?.service,
    },
    ...context,
  });
}

/**
 * Log DynamoDB errors with table context
 */
export function logDynamoDBError(
  logger: ServiceLogger,
  operation: string,
  tableName: string,
  error: any,
  context?: LogContext
): void {
  logAWSError(logger, `DynamoDB ${operation}`, error, {
    tableName,
    operation: `dynamodb.${operation}`,
    ...context,
  });
}

/**
 * Log EventBridge errors with event context
 */
export function logEventBridgeError(
  logger: ServiceLogger,
  operation: string,
  error: any,
  context?: LogContext & { eventType?: string; source?: string }
): void {
  logAWSError(logger, `EventBridge ${operation}`, error, {
    operation: `eventbridge.${operation}`,
    eventType: context?.eventType,
    source: context?.source,
    ...context,
  });
}

/**
 * Log campaign-related errors with campaign context
 */
export function logCampaignError(
  logger: ServiceLogger,
  operation: string,
  error: any,
  context: LogContext & { campaignId: string; brandId?: string }
): void {
  logger.error(`Campaign operation failed: ${operation}`, {
    operation: `campaign.${operation}`,
    error,
    ...context,
  });
}

/**
 * Log content-related errors with content context
 */
export function logContentError(
  logger: ServiceLogger,
  operation: string,
  error: any,
  context: LogContext & { contentId: string; brandId?: string; campaignId?: string }
): void {
  logger.error(`Content operation failed: ${operation}`, {
    operation: `content.${operation}`,
    error,
    ...context,
  });
}

/**
 * Legacy migration helper - gradually replace console.error calls
 */
export function migrateConsoleError(
  serviceName: string,
  message: string,
  error?: any,
  context?: LogContext
): void {
  const logger = createServiceLogger(serviceName);

  if (error) {
    logger.error(message, {
      operation: 'legacy_console_error',
      error,
      ...context,
    });
  } else {
    logger.warn(`Legacy console.error call: ${message}`, {
      operation: 'legacy_console_error',
      ...context,
    });
  }
}