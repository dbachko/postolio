/**
 * CSRF Token Manager for Frontend
 * Handles token lifecycle with proper error handling and retry logic
 */

interface CSRFTokenResponse {
  token: string;
  expiresIn: number;
}

export class CSRFManager {
  private static instance: CSRFManager;
  private tokenPromise: Promise<string | null> | null = null;
  private tokenExpiry: number = 0;
  private retryCount: number = 0;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff
  
  // Configuration
  private readonly config = {
    cookieName: 'csrf-token',
    headerName: 'X-CSRF-Token',
    endpoint: '/api/csrf-token',
    refreshBuffer: 60000, // Refresh 1 minute before expiry
  };

  private constructor() {}

  static getInstance(): CSRFManager {
    if (!CSRFManager.instance) {
      CSRFManager.instance = new CSRFManager();
    }
    return CSRFManager.instance;
  }

  /**
   * Get CSRF token from cookie
   */
  private getTokenFromCookie(): string | null {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === this.config.cookieName) {
        return decodeURIComponent(value);
      }
    }
    return null;
  }

  /**
   * Check if token needs refresh
   */
  private needsRefresh(): boolean {
    // Check if token exists in cookie
    const cookieToken = this.getTokenFromCookie();
    if (!cookieToken) return true;
    
    // Check if we know the expiry and it's approaching
    if (this.tokenExpiry > 0) {
      const timeUntilExpiry = this.tokenExpiry - Date.now();
      return timeUntilExpiry < this.config.refreshBuffer;
    }
    
    return false;
  }

  /**
   * Fetch new CSRF token from server
   */
  private async fetchToken(): Promise<string | null> {
    try {
      const response = await fetch(this.config.endpoint, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch CSRF token: ${response.status}`);
      }

      const data: CSRFTokenResponse = await response.json();
      
      // Update expiry tracking
      this.tokenExpiry = Date.now() + (data.expiresIn * 1000);
      this.retryCount = 0; // Reset retry count on success
      
      return data.token;
    } catch (error) {
      console.error('CSRF token fetch error:', error);
      
      // Implement retry with exponential backoff
      if (this.retryCount < this.MAX_RETRIES) {
        const delay = this.RETRY_DELAYS[this.retryCount] || 5000;
        this.retryCount++;
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.fetchToken();
      }
      
      throw error;
    }
  }

  /**
   * Ensure we have a valid CSRF token
   */
  async ensureToken(): Promise<string | null> {
    // If already fetching, wait for that promise
    if (this.tokenPromise) {
      return this.tokenPromise;
    }

    // Check if we need to refresh
    if (!this.needsRefresh()) {
      const token = this.getTokenFromCookie();
      if (token) return token;
    }

    // Fetch new token
    this.tokenPromise = this.fetchToken();
    
    try {
      const token = await this.tokenPromise;
      return token;
    } finally {
      this.tokenPromise = null;
    }
  }

  /**
   * Get headers for a request including CSRF token
   */
  async getHeaders(existingHeaders: Record<string, string> = {}): Promise<Record<string, string>> {
    const token = await this.ensureToken();
    
    if (token) {
      return {
        ...existingHeaders,
        [this.config.headerName]: token,
      };
    }
    
    return existingHeaders;
  }

  /**
   * Clear token (useful on logout)
   */
  clearToken(): void {
    // Clear cookie by setting it with past expiry
    document.cookie = `${this.config.cookieName}=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT`;
    this.tokenExpiry = 0;
    this.tokenPromise = null;
  }

  /**
   * Handle CSRF error response
   */
  async handleCSRFError(): Promise<boolean> {
    // Clear existing token
    this.clearToken();
    
    // Try to get a new token
    try {
      const newToken = await this.fetchToken();
      return !!newToken;
    } catch (error) {
      console.error('Failed to refresh CSRF token after error:', error);
      return false;
    }
  }
}