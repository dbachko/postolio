/**
 * Cognito OAuth Client Credentials Authentication
 * For service-to-service authentication with ContentScheduler
 */

import axios from 'axios';

interface CognitoCredentials {
  clientId: string;
  clientSecret: string;
  userPoolId: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export class CognitoAuthClient {
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private credentials: CognitoCredentials | null = null;
  
  constructor() {
    // Load credentials from environment variables with validation
    const clientId = process.env.SCHEDULER_CLIENT_ID;
    const clientSecret = process.env.SCHEDULER_CLIENT_SECRET;
    const userPoolId = process.env.SCHEDULER_USER_POOL_ID;
    
    if (clientId && clientSecret) {
      // Validate format of credentials
      if (!userPoolId || !userPoolId.match(/^[\w-]+_[0-9a-zA-Z]+$/)) {
        console.warn('Invalid or missing SCHEDULER_USER_POOL_ID format. Expected format: region_id (e.g., us-east-1_abc123)');
      }
      
      this.credentials = {
        clientId,
        clientSecret,
        userPoolId: userPoolId || '',
      };
    }
  }
  
  /**
   * Cleanup method for long-running processes
   */
  cleanup(): void {
    this.accessToken = null;
    this.tokenExpiry = null;
  }
  
  /**
   * Get an access token using client credentials flow
   */
  async getAccessToken(): Promise<string | null> {
    // If no credentials configured, return null (fallback to no auth)
    if (!this.credentials) {
      console.log('No Cognito credentials configured for scheduler');
      return null;
    }
    
    // Check if we have a valid cached token
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }
    
    // Construct the token endpoint URL outside try block for error handler access
    const region = process.env.AWS_REGION || 'us-east-1';
    const environment = process.env.ENVIRONMENT || 'dev';
    const cognitoDomain = `postolio-scheduler-${environment}`;
    const tokenEndpoint = `https://${cognitoDomain}.auth.${region}.amazoncognito.com/oauth2/token`;
    
    try {
      // Request new token using client credentials grant
      const response = await axios.post<TokenResponse>(
        tokenEndpoint,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
          scope: 'scheduler/admin', // Request admin scope
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
      
      // Cache the token
      this.accessToken = response.data.access_token;
      
      // Set expiry with 5-minute buffer
      const expiresIn = response.data.expires_in - 300;
      this.tokenExpiry = new Date(Date.now() + expiresIn * 1000);
      
      console.log('Successfully obtained Cognito access token for scheduler');
      return this.accessToken;
    } catch (error) {
      const errorMessage = 'Failed to get Cognito access token';
      
      // Structured error logging with context
      if (axios.isAxiosError(error)) {
        const errorDetails = {
          message: errorMessage,
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          endpoint: tokenEndpoint,
        };
        
        console.error('Cognito authentication error:', errorDetails);
        
        // Check if error is retryable
        if (error.response?.status && [429, 500, 502, 503, 504].includes(error.response.status)) {
          console.info('Error is potentially retryable. Consider implementing retry logic.');
        }
      } else {
        console.error(errorMessage, error);
      }
      
      // Return null but log that authentication will be skipped
      console.warn('Proceeding without scheduler authentication. Some features may be unavailable.');
      return null;
    }
  }
  
  /**
   * Get authorization headers for API requests
   */
  async getAuthHeaders(): Promise<{ Authorization?: string }> {
    const token = await this.getAccessToken();
    
    if (token) {
      return {
        Authorization: `Bearer ${token}`,
      };
    }
    
    return {};
  }
}

// Export singleton instance
export const cognitoAuthClient = new CognitoAuthClient();

// Cleanup on process termination
process.on('SIGTERM', () => {
  cognitoAuthClient.cleanup();
});

process.on('SIGINT', () => {
  cognitoAuthClient.cleanup();
});