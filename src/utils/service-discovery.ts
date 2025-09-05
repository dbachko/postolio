/**
 * Service Discovery Utilities
 * Common utilities for service discovery configuration and checks
 */

/**
 * Check if AWS Cloud Map service discovery is configured
 * @returns true if Cloud Map namespace ID and name are both configured
 */
export function isCloudMapConfigured(): boolean {
  return !!(process.env.CLOUDMAP_NAMESPACE_ID && process.env.CLOUDMAP_NAMESPACE_NAME);
}

/**
 * Check if a URL is a localhost URL that should be replaced with service discovery
 * @param url - The URL to check
 * @returns true if the URL is localhost or a default local URL
 */
export function isLocalUrl(url: string): boolean {
  return url.includes('localhost') || url.includes('127.0.0.1') || url === 'http://localhost:4001';
}

/**
 * Check if service discovery should be used based on Cloud Map configuration and URL
 * @param currentUrl - The current URL being used
 * @param explicitUrl - Whether an explicit URL was provided in configuration
 * @returns true if service discovery should be attempted
 */
export function shouldUseServiceDiscovery(currentUrl: string, explicitUrl?: string): boolean {
  // Use service discovery if:
  // 1. Cloud Map is configured AND
  // 2. Either no explicit URL was provided OR the URL is a local default
  return isCloudMapConfigured() && (!explicitUrl || isLocalUrl(currentUrl));
}