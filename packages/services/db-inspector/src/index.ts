import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Pool } from 'pg';

const ssm = new SSMClient({});
const secrets = new SecretsManagerClient({});

let pool: Pool | null = null;
let cachedDbConfig: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} | null = null;

async function getParam(name: string): Promise<string> {
  const res = await ssm.send(new GetParameterCommand({ Name: name }));
  if (!res.Parameter?.Value) throw new Error(`Missing SSM parameter: ${name}`);
  return res.Parameter.Value;
}

function ensureProxyParams(urlString: string): string {
  try {
    const url = new URL(urlString);
    if (!url.searchParams.has('schema')) url.searchParams.set('schema', 'public');
    if (!url.searchParams.has('pgbouncer')) url.searchParams.set('pgbouncer', 'true');
    if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '1');
    if (!url.searchParams.has('sslmode')) url.searchParams.set('sslmode', 'require');
    return url.toString();
  } catch {
    return urlString;
  }
}

async function getDbConfig() {
  if (cachedDbConfig) return cachedDbConfig;
  const env = process.env.ENVIRONMENT || 'dev';
  // Use direct RDS endpoint (not proxy) to avoid IAM auth requirements
  const endpoint = await getParam(`/postolio/${env}/database/endpoint`);
  const secretArn = await getParam(`/postolio/${env}/database/secret-arn`);
  const secretRes = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!secretRes.SecretString) throw new Error('Empty database secret');
  const creds = JSON.parse(secretRes.SecretString) as { username: string; password: string };
  const dbName = 'postolio';
  const [host, portStr] = endpoint.split(':');
  cachedDbConfig = {
    host,
    port: Number(portStr || '5432'),
    user: creds.username,
    password: creds.password,
    database: dbName,
  };
  return cachedDbConfig;
}

async function getPool() {
  if (pool) return pool;
  const cfg = await getDbConfig();
  const region = process.env.AWS_REGION || 'us-east-1';
  // Fetch RDS CA bundle for proper TLS verification
  const caPem = await fetch(
    `https://truststore.pki.rds.amazonaws.com/${region}/${region}-bundle.pem`
  ).then(async (r) => {
    if (!r.ok) throw new Error(`Failed to fetch RDS CA bundle: ${r.status}`);
    return await r.text();
  });

  pool = new Pool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    max: 1,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: true, ca: caPem },
  });
  return pool;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  // Dev safety
  if ((process.env.ENVIRONMENT || 'dev') === 'prod') {
    return { statusCode: 404, body: 'Not found' };
  }

  try {
    const query = event.queryStringParameters || {};
    const contentId = query.contentId;
    const client = await getPool();

    if (contentId) {
      const { rows } = await client.query(
        'SELECT id, "brandId", caption, "s3ImageKey", "imageRegion", "scheduledAt", status, "createdAt", "updatedAt" FROM "content" WHERE id = $1',
        [contentId]
      );
      const rec = rows[0] || null;
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: rec }),
      };
    }

    const take = Math.min(Math.max(parseInt(query.limit || '10', 10) || 10, 1), 100);
    const countRes = await client.query(
      'SELECT COUNT(*)::int AS c FROM "content" WHERE "s3ImageKey" IS NOT NULL'
    );
    const count = (countRes.rows[0]?.c as number) || 0;
    const rowsRes = await client.query(
      'SELECT id, "s3ImageKey", "createdAt" FROM "content" WHERE "s3ImageKey" IS NOT NULL ORDER BY "createdAt" DESC LIMIT $1',
      [take]
    );
    const rows = rowsRes.rows;
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ count, sample: rows }),
    };
  } catch (err) {
    console.error('DB inspector error:', err);
    return { statusCode: 500, body: 'Inspector error' };
  }
};
