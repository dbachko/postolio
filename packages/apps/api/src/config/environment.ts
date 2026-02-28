/**
 * Environment Configuration
 *
 * This module handles environment configuration with the following priority:
 * 1. Environment variables (for public config and local development)
 * 2. AWS Secrets Manager (for actual secrets in production)
 * 3. Default values (for optional configuration)
 *
 * Public OAuth client IDs are now managed via GitHub Environment Variables
 * and passed as environment variables during CI/CD deployment.
 */

import { SecretsManager } from '@aws-sdk/client-secrets-manager';
import { getRedisUrl } from '../utils/redis-url.js';

interface AwsAppSecrets {
  databaseUrl?: string;
  redisUrl?: string;
  jwtSecret?: string;
  refreshTokenSecret?: string;
  googleClientSecret?: string;
  facebookAppSecret?: string;
  openaiApiKey?: string;
  schedulerApiUrl?: string;
  [key: string]: unknown;
}

interface EnvironmentConfig {
  // Environment
  nodeEnv: string;
  environment: string;
  port: number;
  logLevel: string;

  // Database
  databaseUrl: string;
  redisUrl: string;

  // Authentication (Secrets)
  jwtSecret: string;
  refreshTokenSecret?: string;

  // OAuth Configuration
  googleClientId: string; // Public - from env vars
  googleClientSecret: string; // Secret - from AWS Secrets Manager
  facebookAppId: string; // Public - from env vars
  facebookAppSecret: string; // Secret - from AWS Secrets Manager

  // API Keys (Secrets)
  openaiApiKey: string;

  // URLs and Endpoints
  apiUrl: string;
  frontendUrl: string;
  schedulerApiUrl?: string;

  // Feature Flags
  enableMonitoring: boolean;
  enableVideoSupport: boolean;
  enableAiSuggestions: boolean;

  // Rate Limiting
  rateLimitWindow: number;
  rateLimitMaxRequests: number;

  // CORS
  corsOrigin: string | string[];
}

function pickString(values: unknown[], fallback = ''): string {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return fallback;
}

function pickOptionalString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function parseInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseAwsSecrets(secretString: string | undefined): AwsAppSecrets {
  if (!secretString) {
    return {};
  }
  const parsed = JSON.parse(secretString) as unknown;
  return parsed && typeof parsed === 'object' ? (parsed as AwsAppSecrets) : {};
}

class EnvironmentService {
  private static instance: EnvironmentService;
  private config: EnvironmentConfig | null = null;
  private secretsManager?: SecretsManager;

  private constructor() {
    if (process.env.NODE_ENV === 'prod' && process.env.AWS_REGION) {
      this.secretsManager = new SecretsManager({
        region: process.env.AWS_REGION,
      });
    }
  }

  static getInstance(): EnvironmentService {
    if (!EnvironmentService.instance) {
      EnvironmentService.instance = new EnvironmentService();
    }
    return EnvironmentService.instance;
  }

  /**
   * Get a secret from AWS Secrets Manager
   */
  private async getSecretValue(secretId: string, key: string): Promise<string | undefined> {
    if (!this.secretsManager) {
      return undefined;
    }

    try {
      const response = await this.secretsManager.getSecretValue({
        SecretId: secretId,
      });
      if (response.SecretString) {
        const secrets = JSON.parse(response.SecretString);
        return secrets[key];
      }
    } catch (error) {
      console.warn(`Failed to fetch secret ${secretId}:${key}:`, error);
    }

    return undefined;
  }

  /**
   * Initialize configuration from environment variables and AWS Secrets Manager
   */
  async initialize(): Promise<EnvironmentConfig> {
    if (this.config) {
      return this.config;
    }

    const environment = pickString([process.env.ENVIRONMENT, process.env.NODE_ENV], 'dev');
    const isProduction = environment === 'prod';
    const awsSecrets = await this.loadAwsSecrets(environment, isProduction);
    this.config = this.buildConfig(awsSecrets);

    // Validate required configuration
    this.validateConfig();

    return this.config;
  }

  private async loadAwsSecrets(environment: string, isProduction: boolean): Promise<AwsAppSecrets> {
    if (!isProduction || !this.secretsManager) {
      return {};
    }

    const secretName = `Postolio-${environment}/AppSecrets`;
    try {
      const response = await this.secretsManager.getSecretValue({
        SecretId: secretName,
      });
      return parseAwsSecrets(response.SecretString);
    } catch (error) {
      console.warn('Failed to fetch AWS secrets, using environment variables:', error);
      return {};
    }
  }

  private buildConfig(awsSecrets: AwsAppSecrets): EnvironmentConfig {
    const nodeEnv = pickString([process.env.NODE_ENV], 'dev');
    const environment = pickString([process.env.ENVIRONMENT], 'dev');

    return {
      nodeEnv,
      environment,
      port: parseInteger(process.env.PORT, 3000),
      logLevel: pickString([process.env.LOG_LEVEL], 'info'),
      databaseUrl: pickString([process.env.DATABASE_URL, awsSecrets.databaseUrl], ''),
      redisUrl: getRedisUrl(pickString([awsSecrets.redisUrl], 'redis://localhost:6379')),
      jwtSecret: pickString([process.env.JWT_SECRET, awsSecrets.jwtSecret], 'dev-jwt-secret'),
      refreshTokenSecret: pickOptionalString([
        process.env.REFRESH_TOKEN_SECRET,
        awsSecrets.refreshTokenSecret,
      ]),
      googleClientId: pickString(
        [process.env.GOOGLE_CLIENT_ID, process.env.VITE_GOOGLE_CLIENT_ID],
        ''
      ),
      facebookAppId: pickString(
        [process.env.FACEBOOK_APP_ID, process.env.VITE_FACEBOOK_APP_ID],
        ''
      ),
      googleClientSecret: pickString(
        [process.env.GOOGLE_CLIENT_SECRET, awsSecrets.googleClientSecret],
        ''
      ),
      facebookAppSecret: pickString(
        [process.env.FACEBOOK_APP_SECRET, awsSecrets.facebookAppSecret],
        ''
      ),
      openaiApiKey: pickString([process.env.OPENAI_API_KEY, awsSecrets.openaiApiKey], ''),
      apiUrl: pickString([process.env.API_URL, process.env.VITE_API_URL], 'http://localhost:3000'),
      frontendUrl: pickString(
        [process.env.FRONTEND_URL, process.env.VITE_API_URL],
        'http://localhost:5173'
      ),
      schedulerApiUrl: pickOptionalString([
        process.env.SCHEDULER_API_URL,
        awsSecrets.schedulerApiUrl,
      ]),
      enableMonitoring: process.env.ENABLE_MONITORING === 'true',
      enableVideoSupport: process.env.VITE_FEATURE_VIDEO_SUPPORT === 'true',
      enableAiSuggestions: process.env.VITE_FEATURE_AI_SUGGESTIONS !== 'false',
      rateLimitWindow: parseInteger(process.env.RATE_LIMIT_WINDOW, 60000),
      rateLimitMaxRequests: parseInteger(process.env.RATE_LIMIT_MAX_REQUESTS, 100),
      corsOrigin: pickString([process.env.CORS_ORIGIN, process.env.VITE_API_URL], '*'),
    };
  }

  /**
   * Validate that required configuration is present
   */
  private validateConfig(): void {
    if (!this.config) {
      return;
    }

    const required: Array<keyof EnvironmentConfig> = ['jwtSecret', 'databaseUrl'];

    const missing = required.filter((key) => !this.config![key]);

    if (missing.length > 0) {
      console.error('Missing required configuration:', missing);
      if (this.config.nodeEnv === 'prod') {
        throw new Error(`Missing required configuration: ${missing.join(', ')}`);
      }
    }

    // Warn about missing OAuth configuration
    if (!this.config.googleClientId) {
      console.warn('Google OAuth Client ID not configured - Google login will not work');
    }

    if (!this.config.facebookAppId) {
      console.warn('Facebook App ID not configured - Facebook/Instagram login will not work');
    }
  }

  /**
   * Get the current configuration
   */
  getConfig(): EnvironmentConfig {
    if (!this.config) {
      throw new Error('Environment not initialized. Call initialize() first.');
    }
    return this.config;
  }

  /**
   * Check if running in production
   */
  isProduction(): boolean {
    return this.config?.nodeEnv === 'prod' || this.config?.environment === 'prod';
  }

  /**
   * Check if running in development
   */
  isDevelopment(): boolean {
    return this.config?.nodeEnv === 'dev' || this.config?.environment === 'dev';
  }
}

// Export singleton instance
export const environmentService = EnvironmentService.getInstance();

// Export config type
export type { EnvironmentConfig };

// Helper function to get config (for backwards compatibility)
export async function getEnvironmentConfig(): Promise<EnvironmentConfig> {
  return environmentService.initialize();
}
