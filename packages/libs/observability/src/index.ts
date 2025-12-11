import * as Sentry from '@sentry/node';

export interface SentryInitConfig {
  serviceName: string;
  dsn?: string;
  environment?: string;
  release?: string;
  tracesSampleRate?: number;
}

let sentryInitialized = false;
let globalHandlersRegistered = false;

function getNodeEnvironment(): string {
  return process.env.NODE_ENV || process.env.ENVIRONMENT || 'dev';
}

export function initSentry(config: SentryInitConfig): void {
  if (sentryInitialized) {
    // Multiple initializations are ignored to avoid duplicate clients.
    // Log a warning to make this behavior explicit during development.
    // eslint-disable-next-line no-console
    console.warn(
      '[observability] Sentry has already been initialized. Subsequent calls to initSentry are ignored.'
    );
    return;
  }

  const dsn = config.dsn || process.env.SENTRY_BACKEND_DSN;
  if (!dsn) {
    return;
  }

  const environment = config.environment || getNodeEnvironment();
  const release = config.release || process.env.SERVICE_VERSION || process.env.APP_VERSION;

  Sentry.init({
    dsn,
    environment,
    release,
    // Default to 0 to disable tracing by default; individual services can
    // opt in with a non-zero sample rate when they are ready to pay the cost.
    tracesSampleRate: config.tracesSampleRate ?? 0,
    beforeSend(event) {
      event.tags = {
        ...(event.tags || {}),
        service: config.serviceName,
      };
      return event;
    },
  });

  sentryInitialized = true;
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!sentryInitialized) {
    return;
  }

  if (context && Object.keys(context).length > 0) {
    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([key, value]) => {
        if (value === undefined) {
          return;
        }
        scope.setExtra(key, value as unknown);
      });
      Sentry.captureException(error);
    });
    return;
  }

  Sentry.captureException(error);
}

export function captureMessage(message: string, context?: Record<string, unknown>): void {
  if (!sentryInitialized) {
    return;
  }

  if (context && Object.keys(context).length > 0) {
    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([key, value]) => {
        if (value === undefined) {
          return;
        }
        scope.setExtra(key, value as unknown);
      });
      Sentry.captureMessage(message);
    });
    return;
  }

  Sentry.captureMessage(message);
}

export interface GlobalHandlerOptions {
  /**
   * When true, exits the process on fatal errors in production-like environments.
   */
  exitOnFatal?: boolean;
}

export function registerGlobalErrorHandlers(options: GlobalHandlerOptions = {}): void {
  if (globalHandlersRegistered) {
    return;
  }
  globalHandlersRegistered = true;

  const exitOnFatal = options.exitOnFatal ?? false;
  const flushTimeoutMs = 2000;

  process.on('unhandledRejection', (reason, promise) => {
    captureException(reason, {
      source: 'unhandledRejection',
      promise: String(promise),
    });

    const env = getNodeEnvironment();
    if (exitOnFatal && (env === 'prod' || env === 'production')) {
      // Flush Sentry before exiting so fatal errors are captured reliably.
      void Sentry.close(flushTimeoutMs).finally(() => {
        process.exit(1);
      });
    }
  });

  process.on('uncaughtException', (error: Error) => {
    captureException(error, {
      source: 'uncaughtException',
    });

    const env = getNodeEnvironment();
    if (exitOnFatal && (env === 'prod' || env === 'production')) {
      void Sentry.close(flushTimeoutMs).finally(() => {
        process.exit(1);
      });
    }
  });
}

export { Sentry };
