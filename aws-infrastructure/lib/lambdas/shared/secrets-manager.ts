/**
 * AWS Secrets Manager Integration
 * Provides secure access to platform credentials
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { Logger } from '@aws-lambda-powertools/logger'

const logger = new Logger({ serviceName: 'secrets-manager' })

export interface PlatformSecrets {
  FACEBOOK_APP_ID?: string
  FACEBOOK_APP_SECRET?: string
  INSTAGRAM_APP_ID?: string
  INSTAGRAM_APP_SECRET?: string
  LINKEDIN_CLIENT_ID?: string
  LINKEDIN_CLIENT_SECRET?: string
  TIKTOK_CLIENT_KEY?: string
  TIKTOK_CLIENT_SECRET?: string
  TWITTER_API_KEY?: string
  TWITTER_API_SECRET?: string
  TWITTER_BEARER_TOKEN?: string
}

export class SecretManager {
  private client: SecretsManagerClient
  private cache: Map<string, { value: any; expiry: number }>
  private environment: string

  constructor(environment: string = process.env.ENVIRONMENT || 'dev') {
    this.client = new SecretsManagerClient({})
    this.cache = new Map()
    this.environment = environment
  }

  /**
   * Get platform credentials from Secrets Manager
   */
  async getPlatformSecrets(): Promise<PlatformSecrets> {
    const secretName = `postolio/${this.environment}/platform-credentials`
    return this.getSecret<PlatformSecrets>(secretName)
  }

  /**
   * Get a specific secret by name
   */
  async getSecret<T = any>(secretName: string): Promise<T> {
    // Check cache first
    const cached = this.cache.get(secretName)
    if (cached && cached.expiry > Date.now()) {
      logger.debug('Returning cached secret', { secretName })
      return cached.value
    }

    try {
      logger.debug('Fetching secret from Secrets Manager', { secretName })
      
      const response = await this.client.send(
        new GetSecretValueCommand({ SecretId: secretName })
      )

      if (!response.SecretString) {
        throw new Error(`Secret ${secretName} has no string value`)
      }

      const value = JSON.parse(response.SecretString) as T

      // Cache for 5 minutes
      this.cache.set(secretName, {
        value,
        expiry: Date.now() + 5 * 60 * 1000
      })

      logger.debug('Secret fetched and cached', { secretName })
      return value

    } catch (error) {
      logger.error('Failed to fetch secret', {
        secretName,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error(`Failed to fetch secret ${secretName}: ${error}`)
    }
  }

  /**
   * Clear the cache (useful for testing or forced refresh)
   */
  clearCache(): void {
    this.cache.clear()
    logger.debug('Secret cache cleared')
  }

  /**
   * Get a specific platform credential
   */
  async getPlatformCredential(platform: string, credentialType: 'id' | 'secret'): Promise<string | undefined> {
    const secrets = await this.getPlatformSecrets()
    const key = `${platform.toUpperCase()}_${credentialType === 'id' ? 'APP_ID' : 'APP_SECRET'}` as keyof PlatformSecrets
    
    // Special cases for different naming conventions
    if (platform === 'linkedin') {
      const linkedinKey = `LINKEDIN_CLIENT_${credentialType.toUpperCase()}` as keyof PlatformSecrets
      return secrets[linkedinKey]
    }
    
    if (platform === 'tiktok') {
      const tiktokKey = `TIKTOK_CLIENT_${credentialType === 'id' ? 'KEY' : 'SECRET'}` as keyof PlatformSecrets
      return secrets[tiktokKey]
    }
    
    return secrets[key]
  }
}

// Singleton instance
let secretManager: SecretManager | null = null

/**
 * Get singleton instance of SecretManager
 */
export function getSecretManager(): SecretManager {
  if (!secretManager) {
    secretManager = new SecretManager()
  }
  return secretManager
}