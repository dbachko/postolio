/**
 * Simplified Service Discovery
 *
 * Clean, cacheable service discovery to replace complex fallback logic
 * Uses SSM Parameter Store with intelligent caching and graceful degradation
 */

import { SSMClient, GetParameterCommand, GetParametersCommand } from '@aws-sdk/client-ssm';
import { createServiceLogger } from './logger';

const logger = createServiceLogger('service-discovery');

export interface ServiceEndpoint {
  url: string;
  lastUpdated: Date;
  source: 'ssm' | 'env' | 'default';
}

export interface ServiceDiscoveryConfig {
  region?: string;
  cacheTtlMs?: number;
  timeout?: number;
  enableFallbacks?: boolean;
}

export class ServiceDiscovery {
  private ssmClient: SSMClient;
  private cache = new Map<string, ServiceEndpoint>();
  private config: Required<ServiceDiscoveryConfig>;

  constructor(config: ServiceDiscoveryConfig = {}) {
    this.config = {
      region: config.region || process.env.AWS_REGION || 'us-east-1',
      cacheTtlMs: config.cacheTtlMs || 5 * 60 * 1000, // 5 minutes
      timeout: config.timeout || 3000, // 3 seconds
      enableFallbacks: config.enableFallbacks ?? true,
    };

    this.ssmClient = new SSMClient({
      region: this.config.region,
      maxAttempts: 2,
    });
  }

  /**
   * Get service URL with caching and fallbacks
   */
  async getServiceUrl(serviceName: string): Promise<string> {
    logger.operationStart('getServiceUrl', { serviceName });

    try {
      // Check cache first
      const cached = this.getCachedEndpoint(serviceName);
      if (cached) {
        logger.debug('Using cached service URL', {
          serviceName,
          url: cached.url,
          source: cached.source,
        });
        return cached.url;
      }

      // Try SSM Parameter Store
      const ssmUrl = await this.getFromSSM(serviceName);
      if (ssmUrl) {
        const endpoint: ServiceEndpoint = {
          url: ssmUrl,
          lastUpdated: new Date(),
          source: 'ssm',
        };
        this.cache.set(serviceName, endpoint);

        logger.operationSuccess('getServiceUrl', {
          serviceName,
          url: ssmUrl,
          source: 'ssm',
        });
        return ssmUrl;
      }

      // Fallback to environment variables
      if (this.config.enableFallbacks) {
        const envUrl = this.getFromEnvironment(serviceName);
        if (envUrl) {
          const endpoint: ServiceEndpoint = {
            url: envUrl,
            lastUpdated: new Date(),
            source: 'env',
          };
          this.cache.set(serviceName, endpoint);

          logger.warn('Using environment variable fallback for service URL', {
            serviceName,
            url: envUrl,
          });
          return envUrl;
        }

        // Final fallback to default URLs
        const defaultUrl = this.getDefaultUrl(serviceName);
        if (defaultUrl) {
          const endpoint: ServiceEndpoint = {
            url: defaultUrl,
            lastUpdated: new Date(),
            source: 'default',
          };
          this.cache.set(serviceName, endpoint);

          logger.warn('Using default URL for service', {
            serviceName,
            url: defaultUrl,
          });
          return defaultUrl;
        }
      }

      // No URL found
      const error = new Error(`Service URL not found: ${serviceName}`);
      logger.operationFailure('getServiceUrl', error, { serviceName });
      throw error;
    } catch (error) {
      logger.operationFailure('getServiceUrl', error, { serviceName });
      throw error;
    }
  }

  /**
   * Get multiple service URLs in a single batch request
   */
  async getServiceUrls(serviceNames: string[]): Promise<Record<string, string>> {
    logger.operationStart('getServiceUrls', { serviceNames });

    try {
      const results: Record<string, string> = {};

      // Get cached URLs first
      const uncachedServices: string[] = [];
      for (const serviceName of serviceNames) {
        const cached = this.getCachedEndpoint(serviceName);
        if (cached) {
          results[serviceName] = cached.url;
        } else {
          uncachedServices.push(serviceName);
        }
      }

      if (uncachedServices.length === 0) {
        logger.operationSuccess('getServiceUrls', {
          serviceNames,
          source: 'cache',
        });
        return results;
      }

      // Batch request to SSM for uncached services
      const ssmResults = await this.getBatchFromSSM(uncachedServices);

      for (const serviceName of uncachedServices) {
        let url = ssmResults[serviceName];
        let source: ServiceEndpoint['source'] = 'ssm';

        if (!url && this.config.enableFallbacks) {
          const envUrl = this.getFromEnvironment(serviceName);
          if (envUrl) {
            url = envUrl;
            source = 'env';
          }
        }

        if (!url && this.config.enableFallbacks) {
          const defaultUrl = this.getDefaultUrl(serviceName);
          if (defaultUrl) {
            url = defaultUrl;
            source = 'default';
          }
        }

        if (url) {
          const endpoint: ServiceEndpoint = {
            url,
            lastUpdated: new Date(),
            source,
          };
          this.cache.set(serviceName, endpoint);
          results[serviceName] = url;
        } else {
          logger.warn('Service URL not found', { serviceName });
        }
      }

      logger.operationSuccess('getServiceUrls', {
        serviceNames,
        foundServices: Object.keys(results),
        missingServices: serviceNames.filter(name => !results[name]),
      });

      return results;
    } catch (error) {
      logger.operationFailure('getServiceUrls', error, { serviceNames });
      throw error;
    }
  }

  /**
   * Clear cache for a specific service or all services
   */
  clearCache(serviceName?: string): void {
    if (serviceName) {
      this.cache.delete(serviceName);
      logger.debug('Cleared cache for service', { serviceName });
    } else {
      this.cache.clear();
      logger.debug('Cleared all service discovery cache');
    }
  }

  /**
   * Get current cache status
   */
  getCacheStatus(): Record<string, ServiceEndpoint> {
    const status: Record<string, ServiceEndpoint> = {};
    for (const [serviceName, endpoint] of this.cache.entries()) {
      status[serviceName] = { ...endpoint };
    }
    return status;
  }

  /**
   * Health check for service discovery
   */
  async healthCheck(): Promise<{ healthy: boolean; details: string }> {
    try {
      // Test SSM connectivity by getting a known parameter
      await this.ssmClient.send(
        new GetParameterCommand({
          Name: '/aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-x86_64-gp2',
        })
      );

      return {
        healthy: true,
        details: 'Service discovery is healthy',
      };
    } catch (error) {
      logger.error('Service discovery health check failed', {
        operation: 'healthCheck',
        error,
      });

      return {
        healthy: false,
        details: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Get cached endpoint if valid
   */
  private getCachedEndpoint(serviceName: string): ServiceEndpoint | null {
    const cached = this.cache.get(serviceName);
    if (!cached) {
      return null;
    }

    const age = Date.now() - cached.lastUpdated.getTime();
    if (age > this.config.cacheTtlMs) {
      this.cache.delete(serviceName);
      return null;
    }

    return cached;
  }

  /**
   * Get service URL from SSM Parameter Store
   */
  private async getFromSSM(serviceName: string): Promise<string | null> {
    try {
      const parameterName = this.getSSMParameterName(serviceName);

      const response = await this.ssmClient.send(
        new GetParameterCommand({
          Name: parameterName,
        })
      );

      return response.Parameter?.Value || null;
    } catch (error) {
      logger.debug('Failed to get service URL from SSM', {
        serviceName,
        error,
      });
      return null;
    }
  }

  /**
   * Get multiple service URLs from SSM in batch
   */
  private async getBatchFromSSM(serviceNames: string[]): Promise<Record<string, string>> {
    try {
      const parameterNames = serviceNames.map(name => this.getSSMParameterName(name));

      const response = await this.ssmClient.send(
        new GetParametersCommand({
          Names: parameterNames,
        })
      );

      const results: Record<string, string> = {};

      if (response.Parameters) {
        for (const param of response.Parameters) {
          if (param.Name && param.Value) {
            const serviceName = this.getServiceNameFromParameter(param.Name);
            if (serviceName) {
              results[serviceName] = param.Value;
            }
          }
        }
      }

      return results;
    } catch (error) {
      logger.debug('Failed to get service URLs from SSM batch request', {
        serviceNames,
        error,
      });
      return {};
    }
  }

  /**
   * Get service URL from environment variables
   */
  private getFromEnvironment(serviceName: string): string | null {
    const envVarName = this.getEnvironmentVariableName(serviceName);
    return process.env[envVarName] || null;
  }

  /**
   * Get default URL for development/fallback
   */
  private getDefaultUrl(serviceName: string): string | null {
    const defaults: Record<string, string> = {
      'content-scheduler': 'http://localhost:4000',
      'token-service': 'http://localhost:4001',
      'publisher': 'http://localhost:4002',
    };

    return defaults[serviceName] || null;
  }

  /**
   * Get SSM parameter name for service
   */
  private getSSMParameterName(serviceName: string): string {
    const environment = process.env.ENVIRONMENT || 'dev';
    return `/postolio/${environment}/services/${serviceName.toUpperCase()}_URL`;
  }

  /**
   * Extract service name from SSM parameter name
   */
  private getServiceNameFromParameter(parameterName: string): string | null {
    const match = parameterName.match(/\/postolio\/[^/]+\/services\/(.+)_URL$/);
    return match ? match[1].toLowerCase().replace('_', '-') : null;
  }

  /**
   * Get environment variable name for service
   */
  private getEnvironmentVariableName(serviceName: string): string {
    return `${serviceName.toUpperCase().replace('-', '_')}_URL`;
  }
}

// Singleton instance for global use
let globalServiceDiscovery: ServiceDiscovery | null = null;

/**
 * Get global service discovery instance
 */
export function getServiceDiscovery(config?: ServiceDiscoveryConfig): ServiceDiscovery {
  if (!globalServiceDiscovery) {
    globalServiceDiscovery = new ServiceDiscovery(config);
  }
  return globalServiceDiscovery;
}

/**
 * Convenience function to get a single service URL
 */
export async function getServiceUrl(serviceName: string): Promise<string> {
  const discovery = getServiceDiscovery();
  return discovery.getServiceUrl(serviceName);
}

/**
 * Convenience function to get multiple service URLs
 */
export async function getServiceUrls(serviceNames: string[]): Promise<Record<string, string>> {
  const discovery = getServiceDiscovery();
  return discovery.getServiceUrls(serviceNames);
}