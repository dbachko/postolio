/**
 * Token Service Client SDK
 * Enterprise-grade client for Token Service with circuit breaker and retry logic
 */

import CircuitBreaker from 'opossum';
import { getServiceDiscovery } from '../utils/service-discovery-client.js';
import type { StoreTokenParams, TokenData, TokenServiceConfig } from '../types/token-service.js';

export class TokenServiceClient {
  private circuitBreaker: CircuitBreaker;
  private baseURL: string;
  private apiKey: string | undefined;

  constructor(config?: TokenServiceConfig) {
    this.baseURL = config?.apiUrl || process.env.TOKEN_SERVICE_URL || 'http://localhost:4001';
    this.apiKey = process.env.TOKEN_SERVICE_API_KEY || undefined;
    
    // Initialize with service discovery if available
    this.initializeWithServiceDiscovery(config);

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
   * Make HTTP request with retry logic
   */
  private async makeRequest(
    path: string,
    method: string,
    body?: any,
    retries = 3
  ): Promise<Response> {
    const url = `${this.baseURL}${path}`;
    const headers: any = {
      'Content-Type': 'application/json',
    };
    
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const options: globalThis.RequestInit = {
          method,
          headers,
        };
        
        if (body) {
          options.body = JSON.stringify(body);
        }
        
        const response = await fetch(url, options);

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