import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { Pool, type PoolConfig } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Prisma } from './lambda-client';
import { PrismaClient as LambdaPrismaClient } from './lambda-client';

export type { Prisma } from './lambda-client';
export * from './lambda-client';

export interface LambdaPrismaClientOptions extends Prisma.PrismaClientOptions {
  connectionString?: string;
  pool?: Pool;
  poolConfig?: PoolConfig;
}

export interface LambdaPrismaInstance {
  client: LambdaPrismaClient;
  pool: Pool;
}

export function createLambdaPrismaClient(
  options: LambdaPrismaClientOptions = {}
): LambdaPrismaInstance {
  const { connectionString, pool, poolConfig, ...prismaOptions } = options;
  const resolvedPool =
    pool ?? new Pool(poolConfig ?? (connectionString ? { connectionString } : undefined));
  const adapter = new PrismaPg(resolvedPool);
  const client = new LambdaPrismaClient({
    ...prismaOptions,
    adapter,
  });

  return { client, pool: resolvedPool };
}

export function buildProxyPoolConfig(
  proxyEndpoint: string,
  database: string,
  credentials: { username: string; password: string }
): PoolConfig {
  const [host, port] = proxyEndpoint.split(':');
  return {
    host,
    port: Number(port) || 5432,
    database,
    user: credentials.username,
    password: credentials.password,
    // RDS Proxy presents a public ACM certificate, which Node's default CAs can verify.
    // DB_TLS_REJECT_UNAUTHORIZED=false is an emergency rollback only.
    ssl: { rejectUnauthorized: process.env.DB_TLS_REJECT_UNAUTHORIZED !== 'false' },
    max: 1,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 10000,
  };
}

async function readParameter(ssm: SSMClient, name: string): Promise<string> {
  const { Parameter } = await ssm.send(new GetParameterCommand({ Name: name }));
  if (!Parameter?.Value) {
    throw new Error(`SSM parameter ${name} is empty`);
  }
  return Parameter.Value;
}

/**
 * Connects with DATABASE_URL when set (local development), otherwise through RDS Proxy
 * using the password from Secrets Manager. Fails if the connection cannot be verified.
 */
export async function connectLambdaDatabase(): Promise<LambdaPrismaClient> {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return createLambdaPrismaClient({ poolConfig: { connectionString, max: 1 } }).client;
  }

  const ssm = new SSMClient({});
  const prefix = `/postolio/${process.env.ENVIRONMENT || 'dev'}/database`;
  const [proxyEndpoint, secretId] = await Promise.all([
    readParameter(ssm, `${prefix}/proxy-endpoint`),
    process.env.DB_SECRET_ARN ?? readParameter(ssm, `${prefix}/secret-arn`),
  ]);

  const { SecretString } = await new SecretsManagerClient({}).send(
    new GetSecretValueCommand({ SecretId: secretId })
  );
  if (!SecretString) {
    throw new Error('Database secret is empty');
  }
  const { username, password } = JSON.parse(SecretString) as {
    username?: string;
    password?: string;
  };
  if (!username || !password) {
    throw new Error('Database secret is missing credentials');
  }

  const pool = new Pool(
    buildProxyPoolConfig(proxyEndpoint, process.env.DB_NAME || 'postolio', { username, password })
  );
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
  return createLambdaPrismaClient({ pool }).client;
}
