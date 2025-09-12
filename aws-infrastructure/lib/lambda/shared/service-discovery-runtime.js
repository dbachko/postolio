"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.discoverService = discoverService;
exports.clearServiceCache = clearServiceCache;
exports.prewarmServiceDiscovery = prewarmServiceDiscovery;
exports.getCachedServices = getCachedServices;
const client_servicediscovery_1 = require("@aws-sdk/client-servicediscovery");
const logger_1 = require("@aws-lambda-powertools/logger");
// Security: Allowlisted services to prevent unauthorized discovery
const ALLOWED_SERVICES = ['token-service', 'content-scheduler', 'main-app'];
// Singleton instances
let serviceDiscoveryClient = null;
let logger = null;
// Cache for discovered services
const serviceCache = new Map();
const CACHE_TTL = parseInt(process.env.SERVICE_DISCOVERY_CACHE_TTL || '30000', 10); // Default 30 seconds
/**
 * Get or create the service discovery client
 */
function getClient() {
    if (!serviceDiscoveryClient) {
        serviceDiscoveryClient = new client_servicediscovery_1.ServiceDiscoveryClient({});
    }
    return serviceDiscoveryClient;
}
/**
 * Get or create logger instance
 */
function getLogger() {
    if (!logger) {
        logger = new logger_1.Logger({ serviceName: process.env.AWS_LAMBDA_FUNCTION_NAME || 'service-discovery' });
    }
    return logger;
}
/**
 * Validates service name against allowlist
 */
function validateServiceName(serviceName) {
    return ALLOWED_SERVICES.includes(serviceName);
}
/**
 * Validates a discovered URL to prevent SSRF attacks
 */
function validateServiceUrl(url) {
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
    }
    catch {
        return false;
    }
}
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
async function discoverService(serviceName, useCache = true) {
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
        // Use service discovery if Cloud Map is configured
        if (process.env.CLOUDMAP_NAMESPACE_ID && process.env.CLOUDMAP_NAMESPACE_NAME) {
            const client = getClient();
            const response = await client.send(new client_servicediscovery_1.DiscoverInstancesCommand({
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
    }
    catch (error) {
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
function clearServiceCache() {
    serviceCache.clear();
}
/**
 * Pre-warm the cache by discovering multiple services
 */
async function prewarmServiceDiscovery(serviceNames) {
    await Promise.all(serviceNames.map(name => discoverService(name, false)));
}
/**
 * Get all cached services (useful for debugging)
 */
function getCachedServices() {
    return new Map(serviceCache);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmljZS1kaXNjb3ZlcnktcnVudGltZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInNlcnZpY2UtZGlzY292ZXJ5LXJ1bnRpbWUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7Ozs7OztHQVdHOztBQWlGSCwwQ0E0RUM7QUFLRCw4Q0FFQztBQUtELDBEQUVDO0FBS0QsOENBRUM7QUFoTEQsOEVBQW9HO0FBQ3BHLDBEQUF1RDtBQUV2RCxtRUFBbUU7QUFDbkUsTUFBTSxnQkFBZ0IsR0FBRyxDQUFDLGVBQWUsRUFBRSxtQkFBbUIsRUFBRSxVQUFVLENBQVUsQ0FBQztBQUdyRixzQkFBc0I7QUFDdEIsSUFBSSxzQkFBc0IsR0FBa0MsSUFBSSxDQUFDO0FBQ2pFLElBQUksTUFBTSxHQUFrQixJQUFJLENBQUM7QUFFakMsZ0NBQWdDO0FBQ2hDLE1BQU0sWUFBWSxHQUFHLElBQUksR0FBRyxFQUE4QyxDQUFDO0FBQzNFLE1BQU0sU0FBUyxHQUFHLFFBQVEsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLDJCQUEyQixJQUFJLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLHFCQUFxQjtBQUV6Rzs7R0FFRztBQUNILFNBQVMsU0FBUztJQUNoQixJQUFJLENBQUMsc0JBQXNCLEVBQUUsQ0FBQztRQUM1QixzQkFBc0IsR0FBRyxJQUFJLGdEQUFzQixDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQzFELENBQUM7SUFDRCxPQUFPLHNCQUFzQixDQUFDO0FBQ2hDLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQVMsU0FBUztJQUNoQixJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7UUFDWixNQUFNLEdBQUcsSUFBSSxlQUFNLENBQUMsRUFBRSxXQUFXLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyx3QkFBd0IsSUFBSSxtQkFBbUIsRUFBRSxDQUFDLENBQUM7SUFDcEcsQ0FBQztJQUNELE9BQU8sTUFBTSxDQUFDO0FBQ2hCLENBQUM7QUFFRDs7R0FF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QkFBc0IsRUFBRSxFQUFFLFdBQVcsRUFBRSxHQUFHLEVBQUUsV0FBVyxFQUFFLENBQUMsQ0FBQztZQUNyRSxNQUFNLElBQUksS0FBSyxDQUFDLDRCQUE0QixXQUFXLEVBQUUsQ0FBQyxDQUFDO1FBQzdELENBQUM7UUFFRCxHQUFHLENBQUMsSUFBSSxDQUFDLDhDQUE4QyxFQUFFLEVBQUUsV0FBVyxFQUFFLEdBQUcsRUFBRSxXQUFXLEVBQUUsQ0FBQyxDQUFDO1FBQzVGLE9BQU8sV0FBVyxDQUFDO0lBQ3JCLENBQUM7SUFFRCxNQUFNLElBQUksS0FBSyxDQUFDLFdBQVcsV0FBVywrREFBK0QsQ0FBQyxDQUFDO0FBQ3pHLENBQUM7QUFFRDs7R0FFRztBQUNILFNBQWdCLGlCQUFpQjtJQUMvQixZQUFZLENBQUMsS0FBSyxFQUFFLENBQUM7QUFDdkIsQ0FBQztBQUVEOztHQUVHO0FBQ0ksS0FBSyxVQUFVLHVCQUF1QixDQUFDLFlBQThCO0lBQzFFLE1BQU0sT0FBTyxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsZUFBZSxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFDNUUsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBZ0IsaUJBQWlCO0lBQy9CLE9BQU8sSUFBSSxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUM7QUFDL0IsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogU2VydmljZSBEaXNjb3ZlcnkgUnVudGltZSBDbGllbnQgZm9yIExhbWJkYSBGdW5jdGlvbnNcbiAqIFxuICogRk9SIExBTUJEQSBSVU5USU1FIFVTRSBPTkxZIC0gVXNlZCBhdCBleGVjdXRpb24gdGltZSB0byBkaXNjb3ZlciBzZXJ2aWNlcyBmcm9tIEFXUyBDbG91ZCBNYXBcbiAqIEZvciBDREsgaW5mcmFzdHJ1Y3R1cmUgc2VydmljZSByZWdpc3RyYXRpb24sIHVzZSBsaWIvdXRpbHMvc2VydmljZS1kaXNjb3ZlcnktaW5mcmFzdHJ1Y3R1cmUudHNcbiAqIFxuICogVGhpcyBtb2R1bGUgcHJvdmlkZXMgcnVudGltZSBmdW5jdGlvbnMgZm9yOlxuICogLSBEaXNjb3ZlcmluZyBzZXJ2aWNlIGVuZHBvaW50cyBmcm9tIENsb3VkIE1hcFxuICogLSBDYWNoaW5nIGRpc2NvdmVyZWQgc2VydmljZXMgZm9yIHBlcmZvcm1hbmNlXG4gKiAtIEZhbGxiYWNrIHRvIGVudmlyb25tZW50IHZhcmlhYmxlcyB3aGVuIENsb3VkIE1hcCBpcyB1bmF2YWlsYWJsZVxuICogLSBTZWN1cml0eSB2YWxpZGF0aW9uIG9mIHNlcnZpY2UgbmFtZXMgYW5kIFVSTHNcbiAqL1xuXG5pbXBvcnQgeyBTZXJ2aWNlRGlzY292ZXJ5Q2xpZW50LCBEaXNjb3Zlckluc3RhbmNlc0NvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtc2VydmljZWRpc2NvdmVyeSc7XG5pbXBvcnQgeyBMb2dnZXIgfSBmcm9tICdAYXdzLWxhbWJkYS1wb3dlcnRvb2xzL2xvZ2dlcic7XG5cbi8vIFNlY3VyaXR5OiBBbGxvd2xpc3RlZCBzZXJ2aWNlcyB0byBwcmV2ZW50IHVuYXV0aG9yaXplZCBkaXNjb3ZlcnlcbmNvbnN0IEFMTE9XRURfU0VSVklDRVMgPSBbJ3Rva2VuLXNlcnZpY2UnLCAnY29udGVudC1zY2hlZHVsZXInLCAnbWFpbi1hcHAnXSBhcyBjb25zdDtcbnR5cGUgQWxsb3dlZFNlcnZpY2UgPSB0eXBlb2YgQUxMT1dFRF9TRVJWSUNFU1tudW1iZXJdO1xuXG4vLyBTaW5nbGV0b24gaW5zdGFuY2VzXG5sZXQgc2VydmljZURpc2NvdmVyeUNsaWVudDogU2VydmljZURpc2NvdmVyeUNsaWVudCB8IG51bGwgPSBudWxsO1xubGV0IGxvZ2dlcjogTG9nZ2VyIHwgbnVsbCA9IG51bGw7XG5cbi8vIENhY2hlIGZvciBkaXNjb3ZlcmVkIHNlcnZpY2VzXG5jb25zdCBzZXJ2aWNlQ2FjaGUgPSBuZXcgTWFwPHN0cmluZywgeyB1cmw6IHN0cmluZzsgdGltZXN0YW1wOiBudW1iZXIgfT4oKTtcbmNvbnN0IENBQ0hFX1RUTCA9IHBhcnNlSW50KHByb2Nlc3MuZW52LlNFUlZJQ0VfRElTQ09WRVJZX0NBQ0hFX1RUTCB8fCAnMzAwMDAnLCAxMCk7IC8vIERlZmF1bHQgMzAgc2Vjb25kc1xuXG4vKipcbiAqIEdldCBvciBjcmVhdGUgdGhlIHNlcnZpY2UgZGlzY292ZXJ5IGNsaWVudFxuICovXG5mdW5jdGlvbiBnZXRDbGllbnQoKTogU2VydmljZURpc2NvdmVyeUNsaWVudCB7XG4gIGlmICghc2VydmljZURpc2NvdmVyeUNsaWVudCkge1xuICAgIHNlcnZpY2VEaXNjb3ZlcnlDbGllbnQgPSBuZXcgU2VydmljZURpc2NvdmVyeUNsaWVudCh7fSk7XG4gIH1cbiAgcmV0dXJuIHNlcnZpY2VEaXNjb3ZlcnlDbGllbnQ7XG59XG5cbi8qKlxuICogR2V0IG9yIGNyZWF0ZSBsb2dnZXIgaW5zdGFuY2VcbiAqL1xuZnVuY3Rpb24gZ2V0TG9nZ2VyKCk6IExvZ2dlciB7XG4gIGlmICghbG9nZ2VyKSB7XG4gICAgbG9nZ2VyID0gbmV3IExvZ2dlcih7IHNlcnZpY2VOYW1lOiBwcm9jZXNzLmVudi5BV1NfTEFNQkRBX0ZVTkNUSU9OX05BTUUgfHwgJ3NlcnZpY2UtZGlzY292ZXJ5JyB9KTtcbiAgfVxuICByZXR1cm4gbG9nZ2VyO1xufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBzZXJ2aWNlIG5hbWUgYWdhaW5zdCBhbGxvd2xpc3RcbiAqL1xuZnVuY3Rpb24gdmFsaWRhdGVTZXJ2aWNlTmFtZShzZXJ2aWNlTmFtZTogc3RyaW5nKTogc2VydmljZU5hbWUgaXMgQWxsb3dlZFNlcnZpY2Uge1xuICByZXR1cm4gKEFMTE9XRURfU0VSVklDRVMgYXMgcmVhZG9ubHkgc3RyaW5nW10pLmluY2x1ZGVzKHNlcnZpY2VOYW1lKTtcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgYSBkaXNjb3ZlcmVkIFVSTCB0byBwcmV2ZW50IFNTUkYgYXR0YWNrc1xuICovXG5mdW5jdGlvbiB2YWxpZGF0ZVNlcnZpY2VVcmwodXJsOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWQgPSBuZXcgVVJMKHVybCk7XG4gICAgXG4gICAgLy8gT25seSBhbGxvdyBIVFRQUyBpbiBwcm9kdWN0aW9uXG4gICAgaWYgKHByb2Nlc3MuZW52LkVOVklST05NRU5UID09PSAncHJvZCcgJiYgcGFyc2VkLnByb3RvY29sICE9PSAnaHR0cHM6Jykge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBcbiAgICAvLyBBbGxvdyBIVFRQIGZvciBsb2NhbCBkZXZlbG9wbWVudFxuICAgIGlmICghWydodHRwOicsICdodHRwczonXS5pbmNsdWRlcyhwYXJzZWQucHJvdG9jb2wpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIFxuICAgIHJldHVybiB0cnVlO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBEaXNjb3ZlciBhIHNlcnZpY2UgZW5kcG9pbnQgdXNpbmcgQVdTIENsb3VkIE1hcCB3aXRoIHNlY3VyaXR5IHZhbGlkYXRpb25cbiAqIFxuICogQHBhcmFtIHNlcnZpY2VOYW1lIFRoZSBuYW1lIG9mIHRoZSBzZXJ2aWNlIHRvIGRpc2NvdmVyIChtdXN0IGJlIGFsbG93bGlzdGVkKVxuICogQHBhcmFtIHVzZUNhY2hlIFdoZXRoZXIgdG8gdXNlIGNhY2hlZCByZXN1bHRzIChkZWZhdWx0OiB0cnVlKVxuICogQHJldHVybnMgVGhlIHNlcnZpY2UgVVJMXG4gKiBcbiAqIEBleGFtcGxlXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBJbiBhIExhbWJkYSBmdW5jdGlvblxuICogY29uc3QgdG9rZW5TZXJ2aWNlVXJsID0gYXdhaXQgZGlzY292ZXJTZXJ2aWNlKCd0b2tlbi1zZXJ2aWNlJyk7XG4gKiBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKGAke3Rva2VuU2VydmljZVVybH0vdG9rZW5zLyR7dXNlcklkfWApO1xuICogYGBgXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkaXNjb3ZlclNlcnZpY2Uoc2VydmljZU5hbWU6IEFsbG93ZWRTZXJ2aWNlLCB1c2VDYWNoZTogYm9vbGVhbiA9IHRydWUpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBsb2cgPSBnZXRMb2dnZXIoKTtcbiAgXG4gIC8vIFNlY3VyaXR5OiBWYWxpZGF0ZSBzZXJ2aWNlIG5hbWUgYWdhaW5zdCBhbGxvd2xpc3RcbiAgaWYgKCF2YWxpZGF0ZVNlcnZpY2VOYW1lKHNlcnZpY2VOYW1lKSkge1xuICAgIGxvZy5lcnJvcignVW5hdXRob3JpemVkIHNlcnZpY2UgZGlzY292ZXJ5IGF0dGVtcHQnLCB7IHNlcnZpY2VOYW1lIH0pO1xuICAgIHRocm93IG5ldyBFcnJvcignU2VydmljZSBhY2Nlc3MgZGVuaWVkJyk7XG4gIH1cbiAgXG4gIC8vIENoZWNrIGNhY2hlIGZpcnN0XG4gIGlmICh1c2VDYWNoZSkge1xuICAgIGNvbnN0IGNhY2hlZCA9IHNlcnZpY2VDYWNoZS5nZXQoc2VydmljZU5hbWUpO1xuICAgIGlmIChjYWNoZWQgJiYgRGF0ZS5ub3coKSAtIGNhY2hlZC50aW1lc3RhbXAgPCBDQUNIRV9UVEwpIHtcbiAgICAgIGxvZy5kZWJ1ZygnVXNpbmcgY2FjaGVkIHNlcnZpY2UgVVJMJywgeyBzZXJ2aWNlTmFtZSwgdXJsOiBjYWNoZWQudXJsIH0pO1xuICAgICAgcmV0dXJuIGNhY2hlZC51cmw7XG4gICAgfVxuICB9XG4gIFxuICB0cnkge1xuICAgIC8vIFVzZSBzZXJ2aWNlIGRpc2NvdmVyeSBpZiBDbG91ZCBNYXAgaXMgY29uZmlndXJlZFxuICAgIGlmIChwcm9jZXNzLmVudi5DTE9VRE1BUF9OQU1FU1BBQ0VfSUQgJiYgcHJvY2Vzcy5lbnYuQ0xPVURNQVBfTkFNRVNQQUNFX05BTUUpIHtcbiAgICAgIGNvbnN0IGNsaWVudCA9IGdldENsaWVudCgpO1xuICAgICAgXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGNsaWVudC5zZW5kKG5ldyBEaXNjb3Zlckluc3RhbmNlc0NvbW1hbmQoe1xuICAgICAgICBOYW1lc3BhY2VOYW1lOiBwcm9jZXNzLmVudi5DTE9VRE1BUF9OQU1FU1BBQ0VfTkFNRSxcbiAgICAgICAgU2VydmljZU5hbWU6IHNlcnZpY2VOYW1lLFxuICAgICAgICBNYXhSZXN1bHRzOiAxMCxcbiAgICAgICAgSGVhbHRoU3RhdHVzOiAnSEVBTFRIWScsXG4gICAgICB9KSk7XG4gICAgICBcbiAgICAgIGlmIChyZXNwb25zZS5JbnN0YW5jZXMgJiYgcmVzcG9uc2UuSW5zdGFuY2VzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgaW5zdGFuY2UgPSByZXNwb25zZS5JbnN0YW5jZXNbMF07XG4gICAgICAgIGNvbnN0IHVybCA9IGluc3RhbmNlLkF0dHJpYnV0ZXM/LnVybCB8fCBcbiAgICAgICAgICAgICAgICAgICBgaHR0cDovLyR7aW5zdGFuY2UuQXR0cmlidXRlcz8uQVdTX0lOU1RBTkNFX0lQVjR9OiR7aW5zdGFuY2UuQXR0cmlidXRlcz8uQVdTX0lOU1RBTkNFX1BPUlQgfHwgJzgwJ31gO1xuICAgICAgICBcbiAgICAgICAgLy8gU2VjdXJpdHk6IFZhbGlkYXRlIGRpc2NvdmVyZWQgVVJMXG4gICAgICAgIGlmICghdmFsaWRhdGVTZXJ2aWNlVXJsKHVybCkpIHtcbiAgICAgICAgICBsb2cuZXJyb3IoJ0ludmFsaWQgc2VydmljZSBVUkwgZGlzY292ZXJlZCcsIHsgc2VydmljZU5hbWUsIHVybCB9KTtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgc2VydmljZSBVUkwgZm9yICR7c2VydmljZU5hbWV9YCk7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIC8vIFVwZGF0ZSBjYWNoZVxuICAgICAgICBzZXJ2aWNlQ2FjaGUuc2V0KHNlcnZpY2VOYW1lLCB7XG4gICAgICAgICAgdXJsLFxuICAgICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgfSk7XG4gICAgICAgIFxuICAgICAgICBsb2cuaW5mbygnU2VydmljZSBkaXNjb3ZlcmVkIHZpYSBDbG91ZCBNYXAnLCB7IHNlcnZpY2VOYW1lLCB1cmwgfSk7XG4gICAgICAgIHJldHVybiB1cmw7XG4gICAgICB9XG4gICAgICBcbiAgICAgIGxvZy53YXJuKCdObyBoZWFsdGh5IGluc3RhbmNlcyBmb3VuZCB2aWEgc2VydmljZSBkaXNjb3ZlcnknLCB7IHNlcnZpY2VOYW1lIH0pO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBsb2cud2FybignU2VydmljZSBkaXNjb3ZlcnkgZmFpbGVkLCBmYWxsaW5nIGJhY2sgdG8gZW52aXJvbm1lbnQgdmFyaWFibGUnLCB7XG4gICAgICBzZXJ2aWNlTmFtZSxcbiAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyxcbiAgICB9KTtcbiAgfVxuICBcbiAgLy8gRmFsbGJhY2sgdG8gZW52aXJvbm1lbnQgdmFyaWFibGVcbiAgY29uc3QgZW52VmFyTmFtZSA9IGAke3NlcnZpY2VOYW1lLnRvVXBwZXJDYXNlKCkucmVwbGFjZSgvLS9nLCAnXycpfV9VUkxgO1xuICBjb25zdCBmYWxsYmFja1VybCA9IHByb2Nlc3MuZW52W2VudlZhck5hbWVdO1xuICBcbiAgaWYgKGZhbGxiYWNrVXJsKSB7XG4gICAgLy8gU2VjdXJpdHk6IFZhbGlkYXRlIGZhbGxiYWNrIFVSTFxuICAgIGlmICghdmFsaWRhdGVTZXJ2aWNlVXJsKGZhbGxiYWNrVXJsKSkge1xuICAgICAgbG9nLmVycm9yKCdJbnZhbGlkIGZhbGxiYWNrIFVSTCcsIHsgc2VydmljZU5hbWUsIHVybDogZmFsbGJhY2tVcmwgfSk7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgZmFsbGJhY2sgVVJMIGZvciAke3NlcnZpY2VOYW1lfWApO1xuICAgIH1cbiAgICBcbiAgICBsb2cuaW5mbygnVXNpbmcgZmFsbGJhY2sgVVJMIGZyb20gZW52aXJvbm1lbnQgdmFyaWFibGUnLCB7IHNlcnZpY2VOYW1lLCB1cmw6IGZhbGxiYWNrVXJsIH0pO1xuICAgIHJldHVybiBmYWxsYmFja1VybDtcbiAgfVxuICBcbiAgdGhyb3cgbmV3IEVycm9yKGBTZXJ2aWNlICR7c2VydmljZU5hbWV9IG5vdCBhdmFpbGFibGU6IG5laXRoZXIgZGlzY292ZXJ5IG5vciBmYWxsYmFjayBVUkwgY29uZmlndXJlZGApO1xufVxuXG4vKipcbiAqIENsZWFyIHRoZSBzZXJ2aWNlIGRpc2NvdmVyeSBjYWNoZVxuICovXG5leHBvcnQgZnVuY3Rpb24gY2xlYXJTZXJ2aWNlQ2FjaGUoKTogdm9pZCB7XG4gIHNlcnZpY2VDYWNoZS5jbGVhcigpO1xufVxuXG4vKipcbiAqIFByZS13YXJtIHRoZSBjYWNoZSBieSBkaXNjb3ZlcmluZyBtdWx0aXBsZSBzZXJ2aWNlc1xuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcHJld2FybVNlcnZpY2VEaXNjb3Zlcnkoc2VydmljZU5hbWVzOiBBbGxvd2VkU2VydmljZVtdKTogUHJvbWlzZTx2b2lkPiB7XG4gIGF3YWl0IFByb21pc2UuYWxsKHNlcnZpY2VOYW1lcy5tYXAobmFtZSA9PiBkaXNjb3ZlclNlcnZpY2UobmFtZSwgZmFsc2UpKSk7XG59XG5cbi8qKlxuICogR2V0IGFsbCBjYWNoZWQgc2VydmljZXMgKHVzZWZ1bCBmb3IgZGVidWdnaW5nKVxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0Q2FjaGVkU2VydmljZXMoKTogTWFwPHN0cmluZywgeyB1cmw6IHN0cmluZzsgdGltZXN0YW1wOiBudW1iZXIgfT4ge1xuICByZXR1cm4gbmV3IE1hcChzZXJ2aWNlQ2FjaGUpO1xufSJdfQ==