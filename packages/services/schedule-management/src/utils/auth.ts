/**
 * Authentication utilities for schedule-management Lambda
 * Verifies JWT tokens and extracts user information
 */

import type { APIGatewayProxyEvent, APIGatewayProxyEventV2 } from 'aws-lambda';
import * as jwt from 'jsonwebtoken';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'schedule-management-auth' });

export interface AuthenticatedUser {
  userId: string;
  email?: string;
}

export class AuthenticationError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 401
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

type NormalizedHeaders = Record<string, string | undefined>;

interface IamRequestContext {
  iamContext: Record<string, string> | null;
  accountId?: string;
}

interface IamUserContextHeaders {
  userIdHeader?: string;
  emailHeader?: string;
}

function normalizeHeaders(
  headers: Record<string, string | undefined> | null | undefined
): NormalizedHeaders {
  if (!headers) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
}

function authenticateWithBearer(authHeader: string | undefined): AuthenticatedUser | null {
  const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
  if (!bearerMatch) {
    return null;
  }

  const token = bearerMatch[1];
  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      logger.error('JWT_SECRET not configured');
      throw new Error('Authentication service misconfigured');
    }

    const decoded = jwt.verify(token, jwtSecret) as {
      userId?: string;
      id?: string;
      email?: string;
    };
    const userId = decoded.userId || decoded.id;
    if (!userId) {
      logger.warn('Token missing userId field', { decoded });
      throw new AuthenticationError('Invalid token payload');
    }

    logger.info('Successfully authenticated user', { userId, source: 'jwt' });
    return {
      userId,
      email: decoded.email,
    };
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      logger.warn('JWT verification failed', { error: error.message });
      throw new AuthenticationError('Invalid or expired token');
    }
    throw error;
  }
}

function resolveIamRequestContext(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2
): IamRequestContext {
  const requestContext = (event as APIGatewayProxyEventV2).requestContext || {};
  return {
    iamContext:
      (requestContext as { authorizer?: { iam?: Record<string, string> } }).authorizer?.iam ||
      (requestContext as { identity?: Record<string, string> }).identity ||
      null,
    accountId: (requestContext as { accountId?: string }).accountId,
  };
}

function isIamAuthenticatedRequest(
  iamContext: Record<string, string> | null,
  _accountId: string | undefined
): boolean {
  if (iamContext?.userArn || iamContext?.accessKey) {
    return true;
  }

  return false;
}

function resolveIamUserContextHeaders(normalizedHeaders: NormalizedHeaders): IamUserContextHeaders {
  const userIdHeader =
    normalizedHeaders['x-user-context'] ||
    normalizedHeaders['x-user-id'] ||
    normalizedHeaders['user-id'];
  const emailHeader = normalizedHeaders['x-user-email'];

  return {
    userIdHeader,
    emailHeader,
  };
}

function authenticateWithIam(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
  normalizedHeaders: NormalizedHeaders
): AuthenticatedUser | null {
  const { iamContext, accountId } = resolveIamRequestContext(event);
  if (!isIamAuthenticatedRequest(iamContext, accountId)) {
    return null;
  }

  const { userIdHeader, emailHeader } = resolveIamUserContextHeaders(normalizedHeaders);

  if (!userIdHeader) {
    logger.warn('IAM-authenticated request missing user context header', {
      accountId,
      iamUserArn: iamContext?.userArn,
    });
    throw new AuthenticationError('Missing user context for IAM authenticated request');
  }

  logger.info('Authenticated via IAM', {
    userId: userIdHeader,
    iamUserArn: iamContext?.userArn,
    accountId,
  });

  return {
    userId: userIdHeader,
    email: typeof emailHeader === 'string' ? emailHeader : undefined,
  };
}

/**
 * Extract and verify JWT token from request
 * @throws AuthenticationError if token is missing or invalid
 */
export function authenticateRequest(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2
): AuthenticatedUser {
  const normalizedHeaders = normalizeHeaders(event.headers);
  const authHeader = normalizedHeaders['authorization'];
  const bearerUser = authenticateWithBearer(authHeader);
  if (bearerUser) {
    return bearerUser;
  }

  // 2) Internal path: AWS_IAM-authenticated Function URL / API Gateway calls
  if (authHeader) {
    logger.info('Received non-Bearer Authorization header; treating as IAM-signed request', {
      scheme: authHeader.split(' ')[0],
    });
  }
  const iamUser = authenticateWithIam(event, normalizedHeaders);
  if (iamUser) {
    return iamUser;
  }

  logger.warn('Missing Authorization header and no IAM context; rejecting request');
  throw new AuthenticationError('Missing Authorization header');
}
