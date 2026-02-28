export type TokenMetadata = Record<string, unknown>;

export interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  metadata?: TokenMetadata;
  tokenVersion?: number;
  lastRefreshed?: string;
  rotationCount?: number;
}

export interface StoreTokenRequest {
  userId: string;
  brandId: string;
  platform: string;
  socialAccountId?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  metadata?: TokenMetadata;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  operation: string;
  userId: string;
  brandId: string;
  platform: string;
  requestId: string;
  correlationId: string;
  ipAddress?: string;
  userAgent?: string;
  result: 'success' | 'failure';
  errorCode?: string;
  errorMessage?: string;
  metadata?: TokenMetadata;
}

export interface RequestContext {
  requestId: string;
  correlationId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface TokenLookupRequest {
  userId: string;
  brandId: string;
  platform: string;
  socialAccountId?: string;
}

export interface PathParameters {
  userId?: string;
  platform?: string;
  brandId?: string;
  socialAccountId?: string;
  action?: string;
}
