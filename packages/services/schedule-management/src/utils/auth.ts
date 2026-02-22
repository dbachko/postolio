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

/**
 * Extract and verify JWT token from request
 * @throws AuthenticationError if token is missing or invalid
 */
export function authenticateRequest(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2
): AuthenticatedUser {
  const headers = event.headers || {};
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  const authHeader = normalizedHeaders['authorization'];

  const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);

  // 1) Primary path: Bearer token from end-user
  if (bearerMatch) {
    const token = bearerMatch[1];
    try {
      // Get JWT secret from environment
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        logger.error('JWT_SECRET not configured');
        throw new Error('Authentication service misconfigured');
      }

      // Verify and decode token
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

  // 2) Internal path: AWS_IAM-authenticated Function URL / API Gateway calls
  if (authHeader && !bearerMatch) {
    logger.info('Received non-Bearer Authorization header; treating as IAM-signed request', {
      scheme: authHeader.split(' ')[0],
    });
  }
  const requestContext = (event as APIGatewayProxyEventV2).requestContext || {};
  const iamContext =
    (requestContext as { authorizer?: { iam?: Record<string, string> } }).authorizer?.iam ||
    (requestContext as { identity?: Record<string, string> }).identity ||
    null;

  const accountId = (requestContext as { accountId?: string }).accountId;
  const isIamRequest =
    !!iamContext?.userArn || !!iamContext?.accessKey || (!!accountId && accountId !== 'anonymous');

  if (isIamRequest) {
    const userIdHeader =
      normalizedHeaders['x-user-context'] ||
      normalizedHeaders['x-user-id'] ||
      normalizedHeaders['user-id'];
    const emailHeader = normalizedHeaders['x-user-email'];

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

  logger.warn('Missing Authorization header and no IAM context; rejecting request');
  throw new AuthenticationError('Missing Authorization header');
}
