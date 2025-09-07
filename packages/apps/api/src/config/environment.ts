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

import { SecretsManager } from "@aws-sdk/client-secrets-manager";
import { getRedisUrl } from "../utils/redis-url.js";

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

class EnvironmentService {
  private static instance: EnvironmentService;
  private config: EnvironmentConfig | null = null;
  private secretsManager?: SecretsManager;

  private constructor() {
    if (process.env.NODE_ENV === "production" && process.env.AWS_REGION) {
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
  private async getSecretValue(
    secretId: string,
    key: string,
  ): Promise<string | undefined> {
    if (!this.secretsManager) return undefined;

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
    if (this.config) return this.config;

    const environment =
      process.env.ENVIRONMENT || process.env.NODE_ENV || "development";
    const isProduction = environment === "production" || environment === "prod";

    // Get secrets from AWS Secrets Manager if in production
    let awsSecrets: AwsAppSecrets = {};
    if (isProduction && this.secretsManager) {
      const secretName = `Postolio-${environment}/AppSecrets`;
      try {
        const response = await this.secretsManager.getSecretValue({
          SecretId: secretName,
        });
        if (response.SecretString) {
          const parsed = JSON.parse(response.SecretString) as unknown;
          if (parsed && typeof parsed === "object") {
            awsSecrets = parsed as AwsAppSecrets;
          }
        }
      } catch (error) {
        console.warn(
          "Failed to fetch AWS secrets, using environment variables:",
          error,
        );
      }
    }

    // Build configuration with proper precedence
    this.config = {
      // Environment
      nodeEnv: process.env.NODE_ENV || "development",
      environment: process.env.ENVIRONMENT || "dev",
      port: parseInt(process.env.PORT || "3000", 10),
      logLevel: process.env.LOG_LEVEL || "info",

      // Database (from AWS Secrets Manager or env vars)
      databaseUrl: process.env.DATABASE_URL || awsSecrets.databaseUrl || "",
      // Redis URL using shared utility
      redisUrl: getRedisUrl(awsSecrets.redisUrl || "redis://localhost:6379"),

      // Authentication Secrets (from AWS Secrets Manager or env vars)
      jwtSecret:
        process.env.JWT_SECRET || awsSecrets.jwtSecret || "dev-jwt-secret",
      refreshTokenSecret:
        process.env.REFRESH_TOKEN_SECRET || awsSecrets.refreshTokenSecret,

      // OAuth Configuration
      // Public IDs from environment variables (set by GitHub Actions)
      googleClientId:
        process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "",
      facebookAppId:
        process.env.FACEBOOK_APP_ID || process.env.VITE_FACEBOOK_APP_ID || "",

      // OAuth Secrets from AWS Secrets Manager only
      googleClientSecret:
        process.env.GOOGLE_CLIENT_SECRET || awsSecrets.googleClientSecret || "",
      facebookAppSecret:
        process.env.FACEBOOK_APP_SECRET || awsSecrets.facebookAppSecret || "",

      // API Keys (from AWS Secrets Manager or env vars)
      openaiApiKey: process.env.OPENAI_API_KEY || awsSecrets.openaiApiKey || "",

      // URLs and Endpoints (from environment variables)
      apiUrl:
        process.env.API_URL ||
        process.env.VITE_API_URL ||
        "http://localhost:3000",
      frontendUrl:
        process.env.FRONTEND_URL ||
        process.env.VITE_API_URL ||
        "http://localhost:5173",
      schedulerApiUrl:
        process.env.SCHEDULER_API_URL || awsSecrets.schedulerApiUrl,

      // Feature Flags (from environment variables)
      enableMonitoring: process.env.ENABLE_MONITORING === "true",
      enableVideoSupport: process.env.VITE_FEATURE_VIDEO_SUPPORT === "true",
      enableAiSuggestions: process.env.VITE_FEATURE_AI_SUGGESTIONS !== "false", // Default true

      // Rate Limiting (from environment variables with defaults)
      rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || "60000", 10),
      rateLimitMaxRequests: parseInt(
        process.env.RATE_LIMIT_MAX_REQUESTS || "100",
        10,
      ),

      // CORS (from environment variables)
      corsOrigin: process.env.CORS_ORIGIN || process.env.VITE_API_URL || "*",
    };

    // Validate required configuration
    this.validateConfig();

    return this.config;
  }

  /**
   * Validate that required configuration is present
   */
  private validateConfig(): void {
    if (!this.config) return;

    const required: Array<keyof EnvironmentConfig> = [
      "jwtSecret",
      "databaseUrl",
    ];

    const missing = required.filter((key) => !this.config![key]);

    if (missing.length > 0) {
      console.error("Missing required configuration:", missing);
      if (this.config.nodeEnv === "production") {
        throw new Error(
          `Missing required configuration: ${missing.join(", ")}`,
        );
      }
    }

    // Warn about missing OAuth configuration
    if (!this.config.googleClientId) {
      console.warn(
        "Google OAuth Client ID not configured - Google login will not work",
      );
    }

    if (!this.config.facebookAppId) {
      console.warn(
        "Facebook App ID not configured - Facebook/Instagram login will not work",
      );
    }
  }

  /**
   * Get the current configuration
   */
  getConfig(): EnvironmentConfig {
    if (!this.config) {
      throw new Error("Environment not initialized. Call initialize() first.");
    }
    return this.config;
  }

  /**
   * Check if running in production
   */
  isProduction(): boolean {
    return (
      this.config?.nodeEnv === "production" ||
      this.config?.environment === "prod"
    );
  }

  /**
   * Check if running in development
   */
  isDevelopment(): boolean {
    return (
      this.config?.nodeEnv === "development" ||
      this.config?.environment === "dev"
    );
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
