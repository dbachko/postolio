/**
 * Service Discovery Client
 * Runtime client for discovering services via AWS Cloud Map
 */

import { ServiceDiscoveryClient, DiscoverInstancesCommand, RegisterInstanceCommand, DeregisterInstanceCommand } from '@aws-sdk/client-servicediscovery';
import { isCloudMapConfigured } from './service-discovery.js';

export interface ServiceEndpoint {
  url: string;
  instanceId: string;
  attributes: Record<string, string>;
  healthy: boolean;
}

export class ServiceDiscovery {
  private client: ServiceDiscoveryClient;
  private cache: Map<string, { endpoints: ServiceEndpoint[], timestamp: number }> = new Map();
  private readonly CACHE_TTL = 30000; // 30 seconds
  private readonly namespaceId: string;
  private readonly namespaceName: string;

  constructor() {
    this.client = new ServiceDiscoveryClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });

    this.namespaceId = process.env.CLOUDMAP_NAMESPACE_ID || '';
    this.namespaceName = process.env.CLOUDMAP_NAMESPACE_NAME || 'postolio-dev.local';

    if (!this.namespaceId) {
      console.warn('Cloud Map namespace ID not configured. Service discovery disabled.');
    }
  }

  /**
   * Discover service endpoints by name
   */
  async discover(serviceName: string, useCache: boolean = true): Promise<ServiceEndpoint[]> {
    // Check cache first
    if (useCache) {
      const cached = this.cache.get(serviceName);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.endpoints;
      }
    }

    try {
      const response = await this.client.send(new DiscoverInstancesCommand({
        NamespaceName: this.namespaceName,
        ServiceName: serviceName,
        MaxResults: 10,
        HealthStatus: 'HEALTHY', // Only return healthy instances
      }));

      const endpoints: ServiceEndpoint[] = (response.Instances || []).map(instance => ({
        url: instance.Attributes?.url || 
             `http://${instance.Attributes?.AWS_INSTANCE_IPV4}:${instance.Attributes?.AWS_INSTANCE_PORT || '80'}`,
        instanceId: instance.InstanceId || '',
        attributes: instance.Attributes || {},
        healthy: instance.HealthStatus === 'HEALTHY',
      }));

      // Update cache
      this.cache.set(serviceName, {
        endpoints,
        timestamp: Date.now(),
      });

      return endpoints;
    } catch (error) {
      console.error(`Failed to discover service ${serviceName}:`, error);
      
      // Return cached value if available, even if expired
      const cached = this.cache.get(serviceName);
      if (cached) {
        console.log(`Using expired cache for ${serviceName}`);
        return cached.endpoints;
      }
      
      throw error;
    }
  }

  /**
   * Get a single service endpoint (with automatic failover)
   */
  async getServiceUrl(serviceName: string): Promise<string> {
    const endpoints = await this.discover(serviceName);
    
    if (endpoints.length === 0) {
      // Fallback to environment variable if service discovery fails
      const envVarName = `${serviceName.toUpperCase().replace(/-/g, '_')}_URL`;
      const fallbackUrl = process.env[envVarName];
      
      if (fallbackUrl) {
        try {
          new URL(fallbackUrl); // Validate URL format
          console.log(`Using fallback URL for ${serviceName}: ${fallbackUrl}`);
          return fallbackUrl;
        } catch (urlError) {
          const errorDetails = urlError instanceof Error ? urlError.message : 'Invalid URL format';
          console.error(`Invalid fallback URL for ${serviceName}: ${fallbackUrl}. Error: ${errorDetails}`);
          throw new Error(
            `Invalid fallback URL for service '${serviceName}': ${fallbackUrl}. ` +
            `URL validation failed: ${errorDetails}. ` +
            `Ensure the URL includes protocol (http:// or https://) and is properly formatted.`
          );
        }
      }
      
      throw new Error(`No endpoints found for service: ${serviceName}`);
    }

    // Return first healthy endpoint
    // In production, could implement round-robin or random selection
    const endpoint = endpoints[0];
    if (!endpoint) {
      throw new Error(`No valid endpoint found for service: ${serviceName}`);
    }
    return endpoint.url;
  }

  /**
   * Register this service instance with Cloud Map
   * Used by services on startup
   */
  async registerSelf(
    serviceName: string,
    instanceId: string,
    attributes: Record<string, string>
  ): Promise<void> {
    if (!this.namespaceId) {
      console.log('Service discovery not configured, skipping registration');
      return;
    }

    try {
      await this.client.send(new RegisterInstanceCommand({
        ServiceId: serviceName,
        InstanceId: instanceId,
        Attributes: attributes,
      }));
      
      console.log(`Registered ${serviceName} instance ${instanceId} with Cloud Map`);
    } catch (error) {
      console.error('Failed to register with Cloud Map:', error);
      // Don't throw - service can still run without registration
    }
  }

  /**
   * Deregister this service instance from Cloud Map
   * Used on service shutdown
   */
  async deregisterSelf(serviceName: string, instanceId: string): Promise<void> {
    if (!this.namespaceId) {
      return;
    }

    try {
      await this.client.send(new DeregisterInstanceCommand({
        ServiceId: serviceName,
        InstanceId: instanceId,
      }));
      
      console.log(`Deregistered ${serviceName} instance ${instanceId} from Cloud Map`);
    } catch (error) {
      console.error('Failed to deregister from Cloud Map:', error);
    }
  }

  /**
   * Clear cache for a specific service or all services
   */
  clearCache(serviceName?: string): void {
    if (serviceName) {
      this.cache.delete(serviceName);
    } else {
      this.cache.clear();
    }
  }
}

// Singleton instance
let serviceDiscovery: ServiceDiscovery | null = null;

/**
 * Get or create the service discovery client singleton
 */
export function getServiceDiscovery(): ServiceDiscovery {
  if (!serviceDiscovery) {
    serviceDiscovery = new ServiceDiscovery();
  }
  return serviceDiscovery;
}

/**
 * Helper to call another service with automatic discovery
 */
export async function callService(
  serviceName: string,
  path: string,
  options?: globalThis.RequestInit
): Promise<Response> {
  const discovery = getServiceDiscovery();
  const serviceUrl = await discovery.getServiceUrl(serviceName);
  
  const url = `${serviceUrl}${path}`;
  console.log(`Calling service: ${serviceName} at ${url}`);
  
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}

/**
 * Service names enum for type safety
 */
export const SERVICES = {
  TOKEN_SERVICE: 'token-service',
  CONTENT_SCHEDULER: 'content-scheduler',
  MAIN_APP: 'main-app',
  PUBLISHER: 'publisher',
} as const;

export type ServiceName = typeof SERVICES[keyof typeof SERVICES];