import type { LogContext } from '@postolio/logger';

export function formatError(error: unknown): LogContext {
  if (error instanceof Error) {
    return {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    };
  }

  if (typeof error === 'object' && error !== null) {
    return {
      error: {
        message: JSON.stringify(error),
      },
    };
  }

  return {
    error: {
      message: String(error),
    },
  };
}

export function mergeContext(context: LogContext, extra?: LogContext): LogContext {
  if (!extra) {
    return context;
  }
  return { ...context, ...extra };
}
