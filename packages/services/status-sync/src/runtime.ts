import {
  createLambdaPrismaClient,
  type Platform,
  type PrismaClient as LambdaPrismaClient,
} from '@postolio/database/lambda';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { SESClient } from '@aws-sdk/client-ses';
import { Pool } from 'pg';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics } from '@aws-lambda-powertools/metrics';
import { initSentry } from '@postolio/observability';

export const logger = new Logger({ serviceName: 'status-sync' });

export const metrics = new Metrics({
  namespace: 'Postolio/StatusSync',
  serviceName: 'status-sync',
});

initSentry({ serviceName: 'status-sync' });

const secrets = new SecretsManagerClient({});
const ssm = new SSMClient({});
export const sesClient = new SESClient({});

let prisma: LambdaPrismaClient | null = null;
let cachedDbUrl: string | null = null;

export function toDatabasePlatform(platform: string | undefined): Platform | null {
  const normalized = (platform || '').toLowerCase().trim();
  if (!normalized) {
    return null;
  }

  if (normalized === 'twitter') {
    return 'x';
  }

  const validPlatforms = ['instagram', 'facebook', 'linkedin', 'x', 'youtube', 'tiktok'];
  return validPlatforms.includes(normalized) ? (normalized as Platform) : null;
}

function ensureProxyParams(urlString: string): string {
  try {
    const url = new URL(urlString);
    setDefaultQueryParams(url);
    return url.toString();
  } catch {
    return urlString;
  }
}

function setDefaultQueryParams(url: URL): void {
  const defaults = [
    ['schema', 'public'],
    ['pgbouncer', 'true'],
    ['connection_limit', '1'],
    ['sslmode', 'require'],
  ] as const;

  for (const [key, value] of defaults) {
    if (!url.searchParams.has(key)) {
      url.searchParams.set(key, value);
    }
  }
}

async function getDatabaseEndpoints(): Promise<{ endpoint?: string; proxy?: string }> {
  const environment = process.env.ENVIRONMENT || 'dev';
  return {
    endpoint: await getSsmParameter(`/postolio/${environment}/database/endpoint`),
    proxy: await getSsmParameter(`/postolio/${environment}/database/proxy-endpoint`),
  };
}

async function getSsmParameter(name: string): Promise<string | undefined> {
  try {
    const response = await ssm.send(new GetParameterCommand({ Name: name }));
    return response.Parameter?.Value;
  } catch (error) {
    logger.warn('Could not read parameter from SSM', { name, error });
    return undefined;
  }
}

async function getSecretArn(): Promise<string> {
  const envArn = process.env.DB_SECRET_ARN;
  if (envArn) {
    return envArn;
  }

  const environment = process.env.ENVIRONMENT || 'dev';
  const parameterName = `/postolio/${environment}/database/secret-arn`;
  const arn = await getSsmParameter(parameterName);

  if (!arn) {
    logger.warn('Failed to resolve DB secret ARN from SSM', { environment, parameterName });
    throw new Error('DB secret ARN not available');
  }

  return arn;
}

async function getDatabaseUrl(): Promise<string> {
  if (cachedDbUrl) {
    return cachedDbUrl;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not available; use getClient() for AWS connections');
  }

  cachedDbUrl = ensureProxyParams(process.env.DATABASE_URL);
  logger.info('Using DATABASE_URL for local development');
  return cachedDbUrl;
}

export async function getClient(): Promise<LambdaPrismaClient> {
  if (prisma) {
    return prisma;
  }

  prisma = process.env.DATABASE_URL ? await createLocalClient() : await createAwsClient();
  return prisma;
}

async function createLocalClient(): Promise<LambdaPrismaClient> {
  const connectionString = await getDatabaseUrl();
  const { client } = createLambdaPrismaClient({
    connectionString,
    poolConfig: {
      connectionString,
      max: 1,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 10000,
      query_timeout: 30000,
    },
  });

  return client;
}

async function createAwsClient(): Promise<LambdaPrismaClient> {
  const { proxy } = await getDatabaseEndpoints();
  if (!proxy) {
    throw new Error('RDS Proxy endpoint not available');
  }

  const dbName = process.env.DB_NAME || 'postolio';
  const credentials = await getDbCredentials();
  const pool = buildPasswordPool(proxy, dbName, credentials.username, credentials.password);

  await verifyPoolConnection(pool, credentials.username);
  const { client } = createLambdaPrismaClient({ pool });

  logger.info('Connected to database via RDS Proxy with password auth', {
    proxy,
    database: dbName,
  });

  return client;
}

async function getDbCredentials(): Promise<{ username: string; password: string }> {
  const secretId = await getSecretArn();
  const response = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));

  if (!response.SecretString) {
    throw new Error('Empty database secret');
  }

  const parsed = JSON.parse(response.SecretString) as { username?: string; password?: string };
  if (!parsed.username || !parsed.password) {
    throw new Error('Missing credentials in database secret');
  }

  return {
    username: parsed.username,
    password: parsed.password,
  };
}

function buildPasswordPool(
  proxy: string,
  database: string,
  username: string,
  password: string
): Pool {
  const [host, portStr] = proxy.split(':');
  const port = parseInt(portStr || '5432', 10);

  return new Pool({
    host,
    port,
    database,
    user: username,
    password,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 10000,
  });
}

async function verifyPoolConnection(pool: Pool, username: string): Promise<void> {
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    const err = error as { message?: string; code?: string } | undefined;

    logger.error('Password authentication to RDS Proxy failed', {
      userTried: username,
      errorCode: err?.code || 'unknown',
      message: err?.message || 'unknown error',
    });

    throw error;
  }
}
