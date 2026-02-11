/**
 * Environment variable validation and configuration
 */

// Required environment variables
const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'ASSETS_API_BASE_URL',
  'ASSETS_API_SERVICE_TOKEN',
] as const;

// Optional but important environment variables
const optionalEnvVars = [
  'OPENAI_API_KEY',
  'FACEBOOK_APP_ID',
  'FACEBOOK_APP_SECRET',
  'AWS_REGION',
  'REDIS_URL',
  'SCHEDULER_API_URL',
] as const;

export interface EnvironmentConfig {
  DATABASE_URL: string;
  JWT_SECRET: string;
  OPENAI_API_KEY?: string | undefined;
  FACEBOOK_APP_ID?: string | undefined;
  FACEBOOK_APP_SECRET?: string | undefined;
  AWS_REGION: string;
  ASSETS_API_BASE_URL: string;
  ASSETS_API_SERVICE_TOKEN: string;
  REDIS_URL?: string | undefined;
  SCHEDULER_API_URL?: string | undefined;
  NODE_ENV: 'dev' | 'prod' | 'test';
  PORT: number;
}

function normalizeNodeEnv(value: string): 'dev' | 'prod' | 'test' | null {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return null;

  if (raw === 'development') return 'dev';
  if (raw === 'production') return 'prod';

  if (raw === 'dev' || raw === 'prod' || raw === 'test') return raw;
  return null;
}

/**
 * Validate and parse environment variables
 */
export function validateEnvironment(): EnvironmentConfig {
  const missingVars: string[] = [];

  // Check required variables
  for (const varName of requiredEnvVars) {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  }

  if (missingVars.length > 0) {
    const messageParts = [`Missing required environment variables: ${missingVars.join(', ')}`];
    if (missingVars.some((name) => name.startsWith('ASSETS_API_'))) {
      messageParts.push(
        'Assets API integration requires ASSETS_API_BASE_URL and ASSETS_API_SERVICE_TOKEN to be configured.'
      );
    }
    throw new Error(messageParts.join(' '));
  }

  // Validate JWT_SECRET length
  const jwtSecret = process.env.JWT_SECRET!;
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long for security');
  }

  // Validate PORT
  const port = parseInt(process.env.PORT || '3000', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid port number between 1 and 65535');
  }

  // Validate NODE_ENV
  const normalizedNodeEnv = normalizeNodeEnv(process.env.NODE_ENV || 'dev');
  if (!normalizedNodeEnv) {
    throw new Error(
      'NODE_ENV must be one of: dev, prod, test (aliases: development→dev, production→prod)'
    );
  }
  process.env.NODE_ENV = normalizedNodeEnv;

  // Warning for missing optional but important variables
  const missingOptional: string[] = [];
  for (const varName of optionalEnvVars) {
    if (!process.env[varName]) {
      missingOptional.push(varName);
    }
  }

  if (missingOptional.length > 0 && normalizedNodeEnv === 'prod') {
    console.warn(
      `Warning: Missing optional environment variables in production: ${missingOptional.join(', ')}`
    );
  }

  return {
    DATABASE_URL: process.env.DATABASE_URL!,
    JWT_SECRET: jwtSecret,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID,
    FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET,
    AWS_REGION: process.env.AWS_REGION || 'us-east-1',
    ASSETS_API_BASE_URL: process.env.ASSETS_API_BASE_URL!,
    ASSETS_API_SERVICE_TOKEN: process.env.ASSETS_API_SERVICE_TOKEN!,
    REDIS_URL: process.env.REDIS_URL,
    SCHEDULER_API_URL: process.env.SCHEDULER_API_URL,
    NODE_ENV: normalizedNodeEnv,
    PORT: port,
  };
}

// Export validated config
export const config = validateEnvironment();
