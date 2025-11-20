/**
 * Authentication utilities for schedule-management Lambda
 * Verifies JWT tokens and extracts user information
 */

import { APIGatewayProxyEvent, APIGatewayProxyEventV2 } from 'aws-lambda';
import * as jwt from 'jsonwebtoken';
import { Logger } from '@aws-lambda-powertools/logger';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { createLambdaPrismaClient, PrismaClient } from '@postolio/database/lambda';

const logger = new Logger({ serviceName: 'schedule-management-auth' });
const secretsManager = new SecretsManagerClient({});
const ssm = new SSMClient({});

let prismaClient: PrismaClient | null = null;

export interface AuthenticatedUser {
  userId: string;
  email?: string;
}

export class AuthenticationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 401
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
  const authHeader = headers['Authorization'] || headers['authorization'];

  if (!authHeader) {
    logger.warn('Missing Authorization header');
    throw new AuthenticationError('Missing Authorization header');
  }

  // Extract Bearer token
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    logger.warn('Invalid Authorization header format');
    throw new AuthenticationError('Invalid Authorization header format');
  }

  const token = tokenMatch[1];

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

    logger.info('Successfully authenticated user', { userId });

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

async function getDatabaseConnectionString(): Promise<string | null> {
  const env = process.env.ENVIRONMENT || process.env.NODE_ENV || 'dev';
  const secretArn = process.env.DB_SECRET_ARN;

  if (!secretArn) {
    logger.error('DB_SECRET_ARN not configured');
    return null;
  }

  try {
    const [secret, proxyEndpoint, directEndpoint] = await Promise.all([
      secretsManager.send(new GetSecretValueCommand({ SecretId: secretArn })),
      ssm
        .send(
          new GetParameterCommand({
            Name: `/postolio/${env}/database/proxy-endpoint`,
            WithDecryption: false,
          })
        )
        .catch(() => null),
      ssm
        .send(
          new GetParameterCommand({
            Name: `/postolio/${env}/database/endpoint`,
            WithDecryption: false,
          })
        )
        .catch(() => null),
    ]);

    const secretString = secret.SecretString ? JSON.parse(secret.SecretString) : {};
    const username = secretString.username as string | undefined;
    const password = secretString.password as string | undefined;
    const dbname =
      (secretString.dbname as string | undefined) ||
      (secretString.dbInstanceIdentifier as string | undefined) ||
      'postolio';
    const port = (secretString.port as number | undefined) || 5432;

    const hostFromParam =
      proxyEndpoint?.Parameter?.Value ||
      directEndpoint?.Parameter?.Value ||
      (secretString.host as string | undefined);

    if (!username || !password || !hostFromParam) {
      logger.error('Missing database credentials', {
        hasUsername: !!username,
        hasPassword: !!password,
        hostFromParam,
      });
      return null;
    }

    const encodedPassword = encodeURIComponent(password);
    const hostWithPort = hostFromParam.includes(':') ? hostFromParam : `${hostFromParam}:${port}`;
    const connectionString = `postgresql://${encodeURIComponent(username)}:${encodedPassword}@${hostWithPort}/${dbname}`;

    return connectionString;
  } catch (error) {
    logger.error('Failed to build database connection string', { error });
    return null;
  }
}

async function getPrismaClient(): Promise<PrismaClient | null> {
  if (prismaClient) return prismaClient;

  const connectionString = await getDatabaseConnectionString();
  if (!connectionString) {
    return null;
  }

  try {
    const { client } = createLambdaPrismaClient({ connectionString });
    prismaClient = client;
    return prismaClient;
  } catch (error) {
    logger.error('Failed to initialize Prisma client', { error });
    return null;
  }
}

/**
 * Verify that the user owns the specified brand
 * This is a critical security check to prevent unauthorized access
 */
export async function verifyBrandOwnership(brandId: string, userId: string): Promise<boolean> {
  try {
    const prisma = await getPrismaClient();
    if (!prisma) {
      logger.error('Prisma client not available for ownership verification');
      return false;
    }

    const brand = await prisma.brand.findFirst({
      where: {
        id: brandId,
        userId: userId,
      },
      select: { id: true },
    });

    return !!brand;
  } catch (error) {
    logger.error('Failed to verify brand ownership', { error, brandId, userId });
    return false;
  }
}
