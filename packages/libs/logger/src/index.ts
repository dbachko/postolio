import pino, { Logger as PinoLogger, LoggerOptions } from 'pino';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogContext {
  userId?: string;
  correlationId?: string;
  brandId?: string;
  contentId?: string;
  endpoint?: string;
  duration?: number;
  statusCode?: number;
  [key: string]: unknown;
}

export interface LoggerConfig {
  level?: LogLevel;
  service: string;
  environment: string;
  version?: string;
  enablePrettyPrint?: boolean; // pretty output intended only for local TTY
}

class Logger {
  private pino: PinoLogger;
  private service: string;

  constructor(config: LoggerConfig) {
    this.service = config.service;

    const pinoOptions: LoggerOptions = {
      name: config.service,
      level: config.level || this.getDefaultLogLevel(config.environment),
      base: {
        service: config.service,
        environment: config.environment,
        version: config.version || '1.0.0',
        pid: process.pid,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
    };

    // Enable pretty printing only when explicitly requested AND running in a TTY (never in AWS)
    if (config.enablePrettyPrint) {
      pinoOptions.transport = {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
          messageFormat: '[{service}] {msg}',
          singleLine: true, // ensure each log record is a single line
        },
      };
    }

    this.pino = pino(pinoOptions);
  }

  private getDefaultLogLevel(environment: string): LogLevel {
    switch (environment) {
      case 'development':
      case 'dev':
        return 'debug';
      case 'staging':
        return 'info';
      case 'production':
      case 'prod':
        return 'warn';
      default:
        return 'info';
    }
  }

  private formatMessage(message: string, context?: LogContext): any {
    return {
      msg: message,
      ...context,
      timestamp: new Date().toISOString(),
    };
  }

  trace(message: string, context?: LogContext): void {
    this.pino.trace(this.formatMessage(message, context));
  }

  debug(message: string, context?: LogContext): void {
    this.pino.debug(this.formatMessage(message, context));
  }

  info(message: string, context?: LogContext): void {
    this.pino.info(this.formatMessage(message, context));
  }

  warn(message: string, context?: LogContext): void {
    this.pino.warn(this.formatMessage(message, context));
  }

  error(message: string, context?: LogContext): void {
    this.pino.error(this.formatMessage(message, context));
  }

  fatal(message: string, context?: LogContext): void {
    this.pino.fatal(this.formatMessage(message, context));
  }

  // Convenience methods for common logging scenarios

  request(method: string, path: string, context?: LogContext): void {
    this.info(`${method} ${path}`, {
      ...context,
      type: 'request',
    });
  }

  response(
    method: string,
    path: string,
    statusCode: number,
    duration: number,
    context?: LogContext
  ): void {
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    this[level](`${method} ${path} - ${statusCode}`, {
      ...context,
      type: 'response',
      statusCode,
      duration,
    });
  }

  auth(event: string, context?: LogContext): void {
    this.info(`Auth: ${event}`, {
      ...context,
      type: 'auth',
    });
  }

  security(event: string, context?: LogContext): void {
    this.warn(`Security: ${event}`, {
      ...context,
      type: 'security',
    });
  }

  performance(metric: string, value: number, context?: LogContext): void {
    this.info(`Performance: ${metric}`, {
      ...context,
      type: 'performance',
      metric,
      value,
    });
  }

  business(event: string, context?: LogContext): void {
    this.info(`Business: ${event}`, {
      ...context,
      type: 'business',
    });
  }

  // Create child logger with additional context
  child(context: LogContext): Logger {
    const childLogger = new Logger({
      service: this.service,
      environment: process.env.NODE_ENV || 'dev',
      enablePrettyPrint: false, // inherit from parent via child pino instance
    });

    // Override the pino instance with a child to inherit transports/level
    (childLogger as any).pino = this.pino.child(context);
    return childLogger;
  }

  /**
   * Expose underlying pino logger for integrations that require it (e.g., Fastify)
   */
  toPino(): PinoLogger {
    return this.pino;
  }
}

// Factory function to create logger instances
export function createLogger(config: LoggerConfig): Logger {
  return new Logger(config);
}

// Default logger for the current service
const wantsPretty = (process.env.LOG_PRETTY || '').toLowerCase();
const prettyRequested = wantsPretty === '1' || wantsPretty === 'true' || wantsPretty === 'yes';
// Only allow pretty when writing to an interactive terminal and not in common AWS runtimes
const runningInAws = !!(
  process.env.AWS_EXECUTION_ENV ||
  process.env.ECS_CONTAINER_METADATA_URI_V4 ||
  process.env.AWS_LAMBDA_FUNCTION_NAME
);
const prettyAllowed = !!process.stdout.isTTY && !runningInAws;

const defaultConfig: LoggerConfig = {
  service: process.env.SERVICE_NAME || 'postolio',
  environment: process.env.NODE_ENV || 'dev',
  version: process.env.SERVICE_VERSION || '1.0.0',
  level: (process.env.LOG_LEVEL as LogLevel) || undefined,
  enablePrettyPrint: prettyRequested && prettyAllowed,
};

export const logger = createLogger(defaultConfig);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function patchConsoleBridge(activeLogger: Logger): void {
  const mappings: Array<['log' | 'info' | 'warn' | 'error' | 'debug', keyof Logger]> = [
    ['log', 'info'],
    ['info', 'info'],
    ['warn', 'warn'],
    ['error', 'error'],
    ['debug', 'debug'],
  ];

  for (const [method, level] of mappings) {
    const logMethod = (activeLogger as any)[level].bind(activeLogger);
    (console as any)[method] = (...args: unknown[]) => {
      if (!args.length) {
        logMethod('console call with no arguments');
        return;
      }

      const [first, ...rest] = args;

      if (typeof first === 'string') {
        if (rest.length === 0) {
          logMethod(first);
        } else if (rest.length === 1 && isPlainObject(rest[0])) {
          logMethod(first, rest[0] as LogContext);
        } else {
          logMethod(first, { args: rest });
        }
        return;
      }

      if (isPlainObject(first)) {
        logMethod('console output', first as LogContext);
      } else {
        logMethod('console output', { args });
      }
    };
  }

  (console as any).__postolioPatched = true;
}

if (typeof console !== 'undefined' && !(console as any).__postolioPatched) {
  patchConsoleBridge(logger);
}

// Re-export types for convenience
export type { Logger, PinoLogger };
export default logger;
