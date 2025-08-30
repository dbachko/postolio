/**
 * Token Service Client SDK
 * Enterprise-grade client for Token Service with IAM SigV4 authentication
 */

import CircuitBreaker from 'opossum';
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { getServiceDiscovery } from '../utils/service-discovery-client.js';
import type { StoreTokenParams, TokenData, TokenServiceConfig } from '../types/token-service.js';

export class TokenServiceClient {
  private circuitBreaker: CircuitBreaker;
  private baseURL: string;
  private signer: SignatureV4 | undefined;

  constructor(config?: TokenServiceConfig) {
    this.baseURL = config?.apiUrl || process.env.TOKEN_SERVICE_URL || 'http://localhost:4001';
    
    // Initialize with service discovery if available
    this.initializeWithServiceDiscovery(config);

    // Initialize AWS SigV4 signer for IAM authentication
    // Only initialize if we're running in AWS or have credentials
    if (process.env.AWS_REGION || process.env.AWS_ACCESS_KEY_ID) {
      try {
        this.signer = new SignatureV4({
          service: 'execute-api',
          region: process.env.AWS_REGION || 'us-east-1',
          credentials: defaultProvider(),
          sha256: Sha256,
        });
      } catch (error) {
        console.warn('Failed to initialize AWS SigV4 signer:', error);
        console.warn('Token Service requests will be made without IAM authentication');
        // In local development without AWS credentials, signer will be undefined
      }
    } else {
      console.info('Running in local development mode without AWS credentials');
      console.info('Token Service requests will be made without IAM authentication');
    }

    // Circuit breaker configuration
    const options = {
      timeout: config?.timeout || 30000, // 30 seconds
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
      name: 'TokenServiceClient',
    };

    // Wrap all operations in circuit breaker
    this.circuitBreaker = new CircuitBreaker(
      async (operation: () => Promise<any>) => operation(),
      options
    );

    // Circuit breaker events
    this.circuitBreaker.on('open', () => {
      console.warn('Token Service circuit breaker is OPEN - failing fast');
    });

    this.circuitBreaker.on('halfOpen', () => {
      console.info('Token Service circuit breaker is HALF-OPEN - testing recovery');
    });

    this.circuitBreaker.on('close', () => {
      console.info('Token Service circuit breaker is CLOSED - normal operation');
    });
  }

  private async initializeWithServiceDiscovery(config?: TokenServiceConfig) {
    // Try service discovery if Cloud Map is configured
    if (process.env.SERVICE_DISCOVERY_ENABLED === 'true' && !config?.apiUrl) {
      try {
        const discovery = getServiceDiscovery();
        const tokenServiceUrl = await discovery.getServiceUrl('token-service');
        this.baseURL = tokenServiceUrl;
        console.log('✅ Token Service discovered via Cloud Map:', this.baseURL);
      } catch (error) {
        console.warn('⚠️  Token Service discovery failed, using fallback URL:', this.baseURL);
        console.warn('Error:', error);
      }
    }
  }

  /**
   * Store a token in Token Service
   */
  async storeToken(params: StoreTokenParams): Promise<void> {
    await this.circuitBreaker.fire(async () => {
      const response = await this.makeRequest('/tokens', 'POST', params);
      if (!response.ok) {
        throw new Error(`Failed to store token: ${response.statusText}`);
      }
    });
  }

  /**
   * Get a token from Token Service
   */
  async getToken(userId: string, brandId: string, platform: string): Promise<TokenData | null> {
    return this.circuitBreaker.fire(async () => {
      const response = await this.makeRequest('/tokens', 'POST', {
        userId,
        brandId,
        platform,
      });
      
      if (response.status === 404) {
        return null;
      }
      
      if (!response.ok) {
        throw new Error(`Failed to get token: ${response.statusText}`);
      }
      
      return response.json();
    }) as Promise<TokenData | null>;
  }

  /**
   * Refresh a token in Token Service
   */
  async refreshToken(userId: string, brandId: string, platform: string): Promise<TokenData | null> {
    return this.circuitBreaker.fire(async () => {
      const response = await this.makeRequest('/tokens/refresh', 'POST', {
        userId,
        brandId,
        platform,
      });
      
      if (response.status === 404) {
        return null;
      }
      
      if (!response.ok) {
        throw new Error(`Failed to refresh token: ${response.statusText}`);
      }
      
      return response.json();
    }) as Promise<TokenData | null>;
  }

  /**
   * Delete a token from Token Service
   */
  async deleteToken(userId: string, brandId: string, platform: string): Promise<void> {
    await this.circuitBreaker.fire(async () => {
      const response = await this.makeRequest('/tokens', 'DELETE', {
        userId,
        brandId,
        platform,
      });
      
      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to delete token: ${response.statusText}`);
      }
    });
  }

  /**
   * Make HTTP request with AWS SigV4 authentication and retry logic
   */
  private async makeRequest(
    path: string,
    method: string,
    body?: any,
    retries = 3
  ): Promise<Response> {
    const url = new URL(`${this.baseURL}${path}`);
    
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        let headers: any = {
          'Content-Type': 'application/json',
        };
        
        // If we have a signer (running in AWS or with credentials), sign the request
        if (this.signer) {
          // Prepare request for signing
          const request = {
            method,
            headers: {
              'Content-Type': 'application/json',
              host: url.hostname,
            },
            hostname: url.hostname,
            path: url.pathname + url.search,
            protocol: url.protocol,
            body: body ? JSON.stringify(body) : undefined,
          };

          // Sign the request with AWS SigV4
          const signedRequest = await this.signer.sign(request);
          headers = signedRequest.headers;
        } else {
          // Local development without AWS credentials
          // Token Service Lambda allows unauthenticated requests in dev mode
          console.debug('Making unsigned request to Token Service (local development)');
        }
        
        // Make the request (signed or unsigned based on environment)
        const fetchOptions: RequestInit = {
          method,
          headers,
        };
        
        // Only add body if it exists (undefined body causes TypeScript error)
        if (body) {
          fetchOptions.body = JSON.stringify(body);
        }
        
        const response = await fetch(url.toString(), fetchOptions);

        // Don't retry on client errors (4xx)
        if (response.status >= 400 && response.status < 500) {
          return response;
        }

        // Retry on server errors (5xx)
        if (response.status >= 500 && attempt < retries - 1) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
          await this.sleep(delay);
          continue;
        }

        return response;
      } catch (error) {
        // Network error - retry
        if (attempt < retries - 1) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
          await this.sleep(delay);
          continue;
        }
        throw error;
      }
    }

    throw new Error(`Failed after ${retries} attempts`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Health check endpoint
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.makeRequest('/health', 'GET');
      return response.ok;
    } catch (error) {
      console.warn('Token service health check failed:', error);
      return false;
    }
  }
}