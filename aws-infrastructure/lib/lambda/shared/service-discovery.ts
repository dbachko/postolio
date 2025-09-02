/**
 * Runtime service discovery client for Lambda functions
 * Provides a lightweight implementation for discovering services via AWS Cloud Map
 */

import { ServiceDiscoveryClient, DiscoverInstancesCommand } from '@aws-sdk/client-servicediscovery';
import { Logger } from '@aws-lambda-powertools/logger';

// Security: Allowlisted services to prevent unauthorized discovery
const ALLOWED_SERVICES = ['token-service', 'content-scheduler', 'main-app'] as const;
type AllowedService = typeof ALLOWED_SERVICES[number];

// Singleton instances
let serviceDiscoveryClient: ServiceDiscoveryClient | null = null;
let logger: Logger | null = null;

// Cache for discovered services
const serviceCache = new Map<string, { url: string; timestamp: number }>();
const CACHE_TTL = parseInt(process.env.SERVICE_DISCOVERY_CACHE_TTL || '30000', 10); // Default 30 seconds

/**
 * Get or create the service discovery client
 */
function getClient(): ServiceDiscoveryClient {
  if (!serviceDiscoveryClient) {
    serviceDiscoveryClient = new ServiceDiscoveryClient({});
  }
  return serviceDiscoveryClient;
}

/**
 * Get or create logger instance
 */
function getLogger(): Logger {
  if (!logger) {
    logger = new Logger({ serviceName: process.env.AWS_LAMBDA_FUNCTION_NAME || 'service-discovery' });
  }
  return logger;
}

/**
 * Validates service name against allowlist
 */
function validateServiceName(serviceName: string): serviceName is AllowedService {
  return (ALLOWED_SERVICES as readonly string[]).includes(serviceName);
}

/**
 * Validates a discovered URL to prevent SSRF attacks
 */
function validateServiceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    
    // Only allow HTTPS in production
    if (process.env.ENVIRONMENT === 'prod' && parsed.protocol !== 'https:') {
      return false;
    }
    
    // Allow HTTP for local development
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Discover a service endpoint using AWS Cloud Map with security validation
 * @param serviceName The name of the service to discover (must be allowlisted)
 * @param useCache Whether to use cached results (default: true)
 * @returns The service URL
 */
export async function discoverService(serviceName: AllowedService, useCache: boolean = true): Promise<string> {
  const log = getLogger();
  
  // Security: Validate service name against allowlist
  if (!validateServiceName(serviceName)) {
    log.error('Unauthorized service discovery attempt', { serviceName });
    throw new Error('Service access denied');
  }
  
  // Check cache first
  if (useCache) {
    const cached = serviceCache.get(serviceName);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      log.debug('Using cached service URL', { serviceName, url: cached.url });
      return cached.url;
    }
  }
  
  try {
    // Use service discovery if enabled
    if (process.env.SERVICE_DISCOVERY_ENABLED === 'true' && process.env.CLOUDMAP_NAMESPACE_NAME) {
      const client = getClient();
      
      const response = await client.send(new DiscoverInstancesCommand({
        NamespaceName: process.env.CLOUDMAP_NAMESPACE_NAME,
        ServiceName: serviceName,
        MaxResults: 10,
        HealthStatus: 'HEALTHY',
      }));
      
      if (response.Instances && response.Instances.length > 0) {
        const instance = response.Instances[0];
        const url = instance.Attributes?.url || 
                   `http://${instance.Attributes?.AWS_INSTANCE_IPV4}:${instance.Attributes?.AWS_INSTANCE_PORT || '80'}`;
        
        // Security: Validate discovered URL
        if (!validateServiceUrl(url)) {
          log.error('Invalid service URL discovered', { serviceName, url });
          throw new Error(`Invalid service URL for ${serviceName}`);
        }
        
        // Update cache
        serviceCache.set(serviceName, {
          url,
          timestamp: Date.now(),
        });
        
        log.info('Service discovered via Cloud Map', { serviceName, url });
        return url;
      }
      
      log.warn('No healthy instances found via service discovery', { serviceName });
    }
  } catch (error) {
    log.warn('Service discovery failed, falling back to environment variable', {
      serviceName,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
  
  // Fallback to environment variable
  const envVarName = `${serviceName.toUpperCase().replace(/-/g, '_')}_URL`;
  const fallbackUrl = process.env[envVarName];
  
  if (fallbackUrl) {
    // Security: Validate fallback URL
    if (!validateServiceUrl(fallbackUrl)) {
      log.error('Invalid fallback URL', { serviceName, url: fallbackUrl });
      throw new Error(`Invalid fallback URL for ${serviceName}`);
    }
    
    log.info('Using fallback URL from environment variable', { serviceName, url: fallbackUrl });
    return fallbackUrl;
  }
  
  throw new Error(`Service ${serviceName} not available: neither discovery nor fallback URL configured`);
}

/**
 * Clear the service discovery cache
 */
export function clearServiceCache(): void {
  serviceCache.clear();
}

/**
 * Pre-warm the cache by discovering multiple services
 */
export async function prewarmServiceDiscovery(serviceNames: AllowedService[]): Promise<void> {
  await Promise.all(serviceNames.map(name => discoverService(name, false)));
}

/**
 * Get all cached services (useful for debugging)
 */
export function getCachedServices(): Map<string, { url: string; timestamp: number }> {
  return new Map(serviceCache);
}