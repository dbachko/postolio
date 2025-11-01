import {
  SecretsManagerClient,
  DescribeSecretCommand,
  CreateSecretCommand,
} from '@aws-sdk/client-secrets-manager';
import { randomBytes } from 'crypto';

interface CfnEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResourceProperties: {
    SecretName?: string;
    Description?: string;
  };
  PhysicalResourceId?: string;
}

interface CfnResponse {
  PhysicalResourceId: string;
  Data?: Record<string, string>;
}

const client = new SecretsManagerClient({});

export const handler = async (event: CfnEvent): Promise<CfnResponse> => {
  const name = event.ResourceProperties.SecretName || process.env.SECRET_NAME!;
  const description = event.ResourceProperties.Description || 'Shared JWT secret';

  if (event.RequestType === 'Delete') {
    // Intentionally do nothing; we keep the secret for continuity
    return {
      PhysicalResourceId: event.PhysicalResourceId || name,
    };
  }

  // Try to describe existing secret
  try {
    const desc = await client.send(new DescribeSecretCommand({ SecretId: name }));
    if (!desc.ARN) throw new Error('Secret has no ARN');
    return {
      PhysicalResourceId: desc.ARN,
      Data: { SecretArn: desc.ARN },
    };
  } catch (err: any) {
    const message = String(err?.name || err?.Code || err?.message || 'UnknownError');
    const notFound =
      message.includes('ResourceNotFoundException') || message.includes('ResourceNotFound');
    if (!notFound) {
      throw err;
    }
  }

  // Create a new secret with a strong random value if it does not exist
  const secretValue = {
    purpose: 'api-authentication',
    secret: randomBytes(48).toString('hex'),
  };

  const create = await client.send(
    new CreateSecretCommand({
      Name: name,
      Description: description,
      SecretString: JSON.stringify(secretValue),
    })
  );

  if (!create.ARN) throw new Error('CreateSecret did not return ARN');

  return {
    PhysicalResourceId: create.ARN,
    Data: { SecretArn: create.ARN },
  };
};
