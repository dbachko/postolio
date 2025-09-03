/**
 * Service Discovery Runtime Client for Lambda Functions
 *
 * FOR LAMBDA RUNTIME USE ONLY - Used at execution time to discover services from AWS Cloud Map
 * For CDK infrastructure service registration, use lib/utils/service-discovery-infrastructure.ts
 *
 * This module provides runtime functions for:
 * - Discovering service endpoints from Cloud Map
 * - Caching discovered services for performance
 * - Fallback to environment variables when Cloud Map is unavailable
 * - Security validation of service names and URLs
 */
declare const ALLOWED_SERVICES: readonly ["token-service", "content-scheduler", "main-app"];
type AllowedService = typeof ALLOWED_SERVICES[number];
/**
 * Discover a service endpoint using AWS Cloud Map with security validation
 *
 * @param serviceName The name of the service to discover (must be allowlisted)
 * @param useCache Whether to use cached results (default: true)
 * @returns The service URL
 *
 * @example
 * ```typescript
 * // In a Lambda function
 * const tokenServiceUrl = await discoverService('token-service');
 * const response = await fetch(`${tokenServiceUrl}/tokens/${userId}`);
 * ```
 */
export declare function discoverService(serviceName: AllowedService, useCache?: boolean): Promise<string>;
/**
 * Clear the service discovery cache
 */
export declare function clearServiceCache(): void;
/**
 * Pre-warm the cache by discovering multiple services
 */
export declare function prewarmServiceDiscovery(serviceNames: AllowedService[]): Promise<void>;
/**
 * Get all cached services (useful for debugging)
 */
export declare function getCachedServices(): Map<string, {
    url: string;
    timestamp: number;
}>;
export {};
