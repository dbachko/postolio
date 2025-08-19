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
    // Load credentials from environment variables
    if (process.env.SCHEDULER_CLIENT_ID && process.env.SCHEDULER_CLIENT_SECRET) {
      this.credentials = {
        clientId: process.env.SCHEDULER_CLIENT_ID,
        clientSecret: process.env.SCHEDULER_CLIENT_SECRET,
        userPoolId: process.env.SCHEDULER_USER_POOL_ID || '',
      };
    }
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
    
    try {
      // Get the AWS region from environment
      const region = process.env.AWS_REGION || 'us-east-1';
      
      // Construct the Cognito domain (format: postolio-scheduler-{env})
      const environment = process.env.ENVIRONMENT || 'dev';
      const cognitoDomain = `postolio-scheduler-${environment}`;
      
      // Construct the token endpoint URL
      const tokenEndpoint = `https://${cognitoDomain}.auth.${region}.amazoncognito.com/oauth2/token`;
      
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
      console.error('Failed to get Cognito access token:', error);
      
      // Log more details for debugging
      if (axios.isAxiosError(error)) {
        console.error('Response data:', error.response?.data);
        console.error('Response status:', error.response?.status);
      }
      
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