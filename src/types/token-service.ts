export interface TokenMetadata {
  pageId?: string;
  accountId?: string;
  profileData?: any;
  [key: string]: any;
}

export interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  metadata?: TokenMetadata;
}

export interface StoreTokenParams {
  userId: string;
  brandId: string;
  platform: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  metadata?: TokenMetadata;
}

export interface TokenServiceConfig {
  apiUrl: string;
  region?: string;
  timeout?: number;
  maxRetries?: number;
}

export type Platform = 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'linkedin';