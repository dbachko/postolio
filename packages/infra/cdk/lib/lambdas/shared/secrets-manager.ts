/**
 * AWS Secrets Manager Integration
 * Provides secure access to platform credentials
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'secrets-manager' });

export interface PlatformSecrets {
  // Only actual secrets (not public client IDs)
  FACEBOOK_APP_SECRET?: string;
  INSTAGRAM_APP_SECRET?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  TIKTOK_CLIENT_SECRET?: string;
  TWITTER_API_KEY?: string;
  TWITTER_API_SECRET?: string;
  TWITTER_BEARER_TOKEN?: string;
}

export class SecretManager {
  private client: SecretsManagerClient;
  private cache: Map<string, { value: any; expiry: number }>;
  private environment: string;

  constructor(environment: string = process.env.ENVIRONMENT || 'dev') {
    this.client = new SecretsManagerClient({});
    this.cache = new Map();
    this.environment = environment;
  }

  /**
   * Get platform credentials from environment variables
   */
  async getPlatformSecrets(): Promise<PlatformSecrets> {
    return {
      FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET,
      INSTAGRAM_APP_SECRET: process.env.INSTAGRAM_APP_SECRET,
      LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET,
      TIKTOK_CLIENT_SECRET: process.env.TIKTOK_CLIENT_SECRET,
      TWITTER_API_KEY: process.env.TWITTER_API_KEY,
      TWITTER_API_SECRET: process.env.TWITTER_API_SECRET,
      TWITTER_BEARER_TOKEN: process.env.TWITTER_BEARER_TOKEN,
    };
  }

  /**
   * Get a specific secret by name
   */
  async getSecret<T = any>(secretName: string): Promise<T> {
    // Check cache first
    const cached = this.cache.get(secretName);
    if (cached && cached.expiry > Date.now()) {
      logger.debug('Returning cached secret', { secretName });
      return cached.value;
    }

    try {
      logger.debug('Fetching secret from Secrets Manager', { secretName });

      const response = await this.client.send(new GetSecretValueCommand({ SecretId: secretName }));

      if (!response.SecretString) {
        throw new Error(`Secret ${secretName} has no string value`);
      }

      const value = JSON.parse(response.SecretString) as T;

      // Cache for 5 minutes
      this.cache.set(secretName, {
        value,
        expiry: Date.now() + 5 * 60 * 1000,
      });

      logger.debug('Secret fetched and cached', { secretName });
      return value;
    } catch (error) {
      logger.error('Failed to fetch secret', {
        secretName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new Error(`Failed to fetch secret ${secretName}: ${error}`);
    }
  }

  /**
   * Clear the cache (useful for testing or forced refresh)
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug('Secret cache cleared');
  }

  /**
   * Get a specific platform credential
   */
  async getPlatformCredential(
    platform: string,
    credentialType: 'id' | 'secret'
  ): Promise<string | undefined> {
    // Public IDs from environment variables
    if (credentialType === 'id') {
      if (platform === 'facebook') return process.env.FACEBOOK_APP_ID;
      if (platform === 'instagram') return process.env.INSTAGRAM_APP_ID;
      if (platform === 'linkedin') return process.env.LINKEDIN_CLIENT_ID;
      if (platform === 'tiktok') return process.env.TIKTOK_CLIENT_KEY;
      return undefined;
    }

    if (platform === 'facebook') return process.env.FACEBOOK_APP_SECRET;
    if (platform === 'instagram') return process.env.INSTAGRAM_APP_SECRET;
    if (platform === 'linkedin') return process.env.LINKEDIN_CLIENT_SECRET;
    if (platform === 'tiktok') return process.env.TIKTOK_CLIENT_SECRET;

    return undefined;
  }
}

// Singleton instance
let secretManager: SecretManager | null = null;

/**
 * Get singleton instance of SecretManager
 */
export function getSecretManager(): SecretManager {
  if (!secretManager) {
    secretManager = new SecretManager();
  }
  return secretManager;
}
