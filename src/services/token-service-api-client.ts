/**
 * Token Service API Client
 * Client for calling the Token Service API (not direct DynamoDB access)
 */

import axios, { AxiosInstance } from 'axios'
import { aws4Interceptor } from 'aws4-axios'

interface TokenData {
  accessToken: string
  refreshToken?: string
  expiresAt?: string
  platform: 'instagram' | 'facebook' | 'linkedin' | 'tiktok'
  metadata?: {
    pageId?: string
    accountId?: string
    scopes?: string[]
  }
}

interface StoreTokenRequest {
  userId: string
  brandId: string
  platform: string
  accessToken: string
  refreshToken?: string
  expiresAt?: string
  metadata?: {
    pageId?: string
    accountId?: string
    scopes?: string[]
  }
}

interface GetTokenRequest {
  userId: string
  brandId: string
  platform: string
}

interface GetTokenResponse {
  accessToken: string
  refreshToken?: string
  expiresAt?: string
  metadata?: {
    pageId?: string
    accountId?: string
    scopes?: string[]
  }
}

export class TokenServiceApiClient {
  private client: AxiosInstance
  private static instance: TokenServiceApiClient | null = null

  constructor() {
    const baseURL = process.env.TOKEN_SERVICE_API_URL || 
                   process.env.PLATFORM_API_URL ||
                   `https://api-${process.env.ENVIRONMENT || 'dev'}.postolio.example/platform`

    this.client = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    // Add AWS Signature V4 for IAM authentication if running in AWS
    if (process.env.AWS_EXECUTION_ENV || process.env.AWS_REGION) {
      const interceptor = aws4Interceptor({
        options: {
          region: process.env.AWS_REGION || 'us-east-1',
          service: 'execute-api',
        },
        instance: this.client,
      })
      
      // aws4-axios directly returns the interceptor function
      this.client.interceptors.request.use(interceptor)
    }

    // Add request/response logging
    this.client.interceptors.request.use(
      (config) => {
        console.log(`Token Service API Request: ${config.method?.toUpperCase()} ${config.url}`)
        return config
      },
      (error) => {
        console.error('Token Service API Request Error:', error)
        return Promise.reject(error)
      }
    )

    this.client.interceptors.response.use(
      (response) => {
        console.log(`Token Service API Response: ${response.status}`)
        return response
      },
      (error) => {
        console.error('Token Service API Response Error:', error.response?.status, error.response?.data)
        return Promise.reject(error)
      }
    )
  }

  /**
   * Get singleton instance
   */
  static getInstance(): TokenServiceApiClient {
    if (!TokenServiceApiClient.instance) {
      TokenServiceApiClient.instance = new TokenServiceApiClient()
    }
    return TokenServiceApiClient.instance
  }

  /**
   * Store OAuth token via Token Service API
   */
  async storeToken(request: StoreTokenRequest): Promise<void> {
    console.log(`Storing ${request.platform} token for brand ${request.brandId} via Token Service API`)

    try {
      await this.client.post('/tokens', request)
      console.log(`Successfully stored ${request.platform} token for brand ${request.brandId}`)
    } catch (error: any) {
      console.error('Failed to store token via API:', error.response?.data || error.message)
      throw new Error(
        `Failed to store token: ${error.response?.data?.error || error.message}`
      )
    }
  }

  /**
   * Retrieve OAuth token via Token Service API
   */
  async getToken(request: GetTokenRequest): Promise<GetTokenResponse | null> {
    console.log(`Retrieving ${request.platform} token for brand ${request.brandId} via Token Service API`)

    try {
      const response = await this.client.post('/tokens/get', request)
      
      if (!response.data) {
        console.log(`No ${request.platform} token found for brand ${request.brandId}`)
        return null
      }

      return response.data
    } catch (error: any) {
      if (error.response?.status === 404) {
        console.log(`No ${request.platform} token found for brand ${request.brandId}`)
        return null
      }
      
      console.error('Failed to retrieve token via API:', error.response?.data || error.message)
      throw new Error(
        `Failed to retrieve token: ${error.response?.data?.error || error.message}`
      )
    }
  }

  /**
   * Delete OAuth token via Token Service API
   */
  async deleteToken(request: GetTokenRequest): Promise<void> {
    console.log(`Deleting ${request.platform} token for brand ${request.brandId} via Token Service API`)

    try {
      await this.client.post('/tokens/delete', request)
      console.log(`Successfully deleted ${request.platform} token for brand ${request.brandId}`)
    } catch (error: any) {
      console.error('Failed to delete token via API:', error.response?.data || error.message)
      throw new Error(
        `Failed to delete token: ${error.response?.data?.error || error.message}`
      )
    }
  }

  /**
   * Refresh OAuth token via Token Service API
   */
  async refreshToken(request: GetTokenRequest): Promise<GetTokenResponse | null> {
    console.log(`Refreshing ${request.platform} token for brand ${request.brandId} via Token Service API`)

    try {
      const response = await this.client.post('/tokens/refresh', request)
      
      if (!response.data) {
        console.log(`Failed to refresh ${request.platform} token for brand ${request.brandId}`)
        return null
      }

      return response.data
    } catch (error: any) {
      console.error('Failed to refresh token via API:', error.response?.data || error.message)
      throw new Error(
        `Failed to refresh token: ${error.response?.data?.error || error.message}`
      )
    }
  }

  /**
   * Check if token needs refresh
   */
  async checkTokenExpiry(request: GetTokenRequest): Promise<{
    needsRefresh: boolean
    expiresAt?: string
  }> {
    console.log(`Checking ${request.platform} token expiry for brand ${request.brandId}`)

    try {
      const response = await this.client.post('/tokens/check-expiry', request)
      return response.data
    } catch (error: any) {
      console.error('Failed to check token expiry:', error.response?.data || error.message)
      return { needsRefresh: false }
    }
  }
}

// Export singleton instance
export const tokenServiceApiClient = TokenServiceApiClient.getInstance()