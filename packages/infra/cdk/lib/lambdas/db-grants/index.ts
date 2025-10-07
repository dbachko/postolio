import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { Pool } from 'pg';

type CfnEvent = {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResourceProperties?: Record<string, unknown>;
};

const secrets = new SecretsManagerClient({});
const ssm = new SSMClient({});

async function getDbConnection() {
  const environment = process.env.ENVIRONMENT || 'dev';
  const dbName = process.env.DB_NAME || 'postolio';

  // Resolve DB secret
  const secretArn = process.env.DB_SECRET_ARN ||
    (await ssm.send(new GetParameterCommand({ Name: `/postolio/${environment}/database/secret-arn` }))).Parameter?.Value;
  if (!secretArn) throw new Error('DB secret ARN not available');

  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!secret.SecretString) throw new Error('DB secret value is empty');
  const creds = JSON.parse(secret.SecretString);
  const user: string = creds.username;
  const password: string = creds.password;
  if (!user || !password) throw new Error('DB secret missing username/password');

  // Prefer Proxy endpoint if available
  const proxyParam = await ssm
    .send(new GetParameterCommand({ Name: `/postolio/${environment}/database/proxy-endpoint` }))
    .catch(() => undefined);
  const endpointParam = await ssm
    .send(new GetParameterCommand({ Name: `/postolio/${environment}/database/endpoint` }))
    .catch(() => undefined);

  const socket = proxyParam?.Parameter?.Value || endpointParam?.Parameter?.Value;
  if (!socket) throw new Error('No database endpoint or proxy endpoint available from SSM');

  const [host, portStr] = socket.split(':');
  const port = parseInt(portStr || '5432', 10);

  const pool = new Pool({
    host,
    port,
    user,
    password,
    database: dbName,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 10000,
  });

  return { pool };
}

export const handler = async (event: CfnEvent) => {
  const requestType = event.RequestType;
  if (requestType === 'Delete') {
    return { PhysicalResourceId: 'DbIamGrant', Status: 'SUCCESS' };
  }

  const targetUser = (process.env.TARGET_DB_USER || 'postgres').replace(/"/g, '');

  const { pool } = await getDbConnection();
  try {
    // Ensure role exists (managed by RDS). Attempt grant idempotently.
    await pool.query(`GRANT rds_iam TO ${targetUser === 'postgres' ? 'postgres' : '"' + targetUser + '"'}`);
  } catch (err: any) {
    const msg = (err?.message as string) || '';
    // Ignore if already granted
    if (!/is already a member of role/.test(msg)) {
      throw err;
    }
  } finally {
    await pool.end().catch(() => undefined);
  }

  return {
    PhysicalResourceId: 'DbIamGrant',
    Status: 'SUCCESS',
  };
};

