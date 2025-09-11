/**
 * CSRF Configuration
 * Centralized configuration for CSRF protection
 */

export interface CSRFConfig {
  enabled: boolean;
  cookieName: string;
  headerName: string;
  tokenLength: number;
  tokenExpiry: number;
  sameSite: 'strict' | 'lax' | 'none';
  secure: boolean;
  httpOnly: boolean;
  skipPaths: string[];
  skipMethods: string[];
  useRedis: boolean;
  rotateOnAuth: boolean;
}

const isDevelopment = process.env.NODE_ENV !== 'production';
const isDisabled = process.env.DISABLE_CSRF === 'true';

export const csrfConfig: CSRFConfig = {
  // Core settings
  enabled: !isDisabled || !isDevelopment,
  cookieName: process.env.CSRF_COOKIE_NAME || 'csrf-token',
  headerName: process.env.CSRF_HEADER_NAME || 'x-csrf-token',
  tokenLength: 32,
  tokenExpiry: 3600, // 1 hour
  
  // Cookie settings
  sameSite: isDevelopment ? 'lax' : 'strict',
  secure: !isDevelopment,
  httpOnly: false, // Must be false for double-submit pattern
  
  // Skip configuration
  skipMethods: ['GET', 'HEAD', 'OPTIONS'],
  skipPaths: [
    // Authentication endpoints
    '/api/auth/register',
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/refresh',
    '/api/auth/verify-email',
    '/api/auth/password-reset',
    
    // OAuth callbacks (external origins)
    '/api/auth/google/verify',
    '/api/auth/google/callback',
    '/api/auth/facebook/callback',
    '/api/auth/facebook/verify',
    '/api/auth/instagram/callback',
    
    // Magic links
    '/api/auth/magic-link/request',
    '/api/auth/magic-link/send',
    '/api/auth/magic-link/verify',
    
    // System endpoints
    '/api/csrf-token',
    '/api/health',
    '/api/monitoring',
    '/api/webhooks',
  ],
  
  // Advanced settings
  useRedis: true, // Use Redis for stateful token storage
  rotateOnAuth: true, // Rotate token on login/logout
};

// Pattern matchers for dynamic paths
export const csrfPatterns = {
  isOAuthCallback: (path: string) => /\/(callback|oauth)/i.test(path),
  isWebhook: (path: string) => path.startsWith('/api/webhooks/'),
  isPublicAsset: (path: string) => /\.(js|css|png|jpg|jpeg|gif|svg|ico)$/i.test(path),
};

// Export helper to check if path should skip CSRF
export function shouldSkipCSRF(method: string, path: string): boolean {
  // Check if CSRF is disabled
  if (!csrfConfig.enabled) return true;
  
  // Check method
  if (csrfConfig.skipMethods.includes(method)) return true;
  
  // Check exact path match
  if (csrfConfig.skipPaths.some(skipPath => path.startsWith(skipPath))) return true;
  
  // Check patterns
  if (csrfPatterns.isOAuthCallback(path)) return true;
  if (csrfPatterns.isWebhook(path)) return true;
  if (csrfPatterns.isPublicAsset(path)) return true;
  
  return false;
}