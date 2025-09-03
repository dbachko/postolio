/**
 * AWS Secrets Manager Integration
 * Provides secure access to platform credentials
 */
export interface PlatformSecrets {
    FACEBOOK_APP_ID?: string;
    FACEBOOK_APP_SECRET?: string;
    INSTAGRAM_APP_ID?: string;
    INSTAGRAM_APP_SECRET?: string;
    LINKEDIN_CLIENT_ID?: string;
    LINKEDIN_CLIENT_SECRET?: string;
    TIKTOK_CLIENT_KEY?: string;
    TIKTOK_CLIENT_SECRET?: string;
    TWITTER_API_KEY?: string;
    TWITTER_API_SECRET?: string;
    TWITTER_BEARER_TOKEN?: string;
}
export declare class SecretManager {
    private client;
    private cache;
    private environment;
    constructor(environment?: string);
    /**
     * Get platform credentials from Secrets Manager
     */
    getPlatformSecrets(): Promise<PlatformSecrets>;
    /**
     * Get a specific secret by name
     */
    getSecret<T = any>(secretName: string): Promise<T>;
    /**
     * Clear the cache (useful for testing or forced refresh)
     */
    clearCache(): void;
    /**
     * Get a specific platform credential
     */
    getPlatformCredential(platform: string, credentialType: 'id' | 'secret'): Promise<string | undefined>;
}
/**
 * Get singleton instance of SecretManager
 */
export declare function getSecretManager(): SecretManager;
