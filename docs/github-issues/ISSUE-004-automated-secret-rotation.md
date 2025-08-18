# [HIGH] Implement Automated Secret Rotation

## 🔐 Security & Compliance Requirement

### Problem
Secrets are **manually managed** with no automatic rotation mechanism. This creates security risks from long-lived credentials and makes compliance (SOC2, ISO 27001) difficult to achieve.

### Security Impact
- **Credential compromise risk** from long-lived secrets
- **Compliance violation** - Most standards require 90-day rotation
- **Manual rotation errors** - Risk of service outage
- **No audit trail** for secret changes
- **Insider threat** - No automatic revocation

### Current State vs Required
```
Current: Static secrets with manual rotation
Required: Automated rotation every 30-90 days
Gap: No rotation Lambda functions or schedule
```

### Required Implementation

#### 1. Database Password Rotation

```typescript
// aws-infrastructure/lib/rotation/database-rotation-stack.ts

import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';

// Database secret with automatic rotation
const dbSecret = new secretsmanager.Secret(this, 'DatabaseSecret', {
  description: 'RDS PostgreSQL credentials',
  generateSecretString: {
    secretStringTemplate: JSON.stringify({
      username: 'postolio_admin',
    }),
    generateStringKey: 'password',
    excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
    passwordLength: 32,
  },
});

// Rotation Lambda function
const rotationLambda = new lambda.Function(this, 'DbRotationLambda', {
  runtime: lambda.Runtime.PYTHON_3_11,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('lambda/rotation/database'),
  environment: {
    SECRETS_MANAGER_ENDPOINT: `https://secretsmanager.${this.region}.amazonaws.com`,
    RDS_ENDPOINT: database.clusterEndpoint.hostname,
  },
  vpc: vpc,
  vpcSubnets: {
    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
  },
  timeout: cdk.Duration.minutes(5),
});

// Configure rotation
dbSecret.addRotationSchedule('DbRotation', {
  automaticallyAfter: cdk.Duration.days(30),
  lambda: rotationLambda,
  vpcSubnets: {
    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
  },
  securityGroup: rotationSecurityGroup,
});

// Grant permissions
dbSecret.grantRead(rotationLambda);
dbSecret.grantWrite(rotationLambda);
database.grantConnect(rotationLambda);
```

#### 2. API Key Rotation

```typescript
// API key rotation for external services
const apiKeySecret = new secretsmanager.Secret(this, 'ApiKeySecret', {
  description: 'External API keys',
  secretString: JSON.stringify({
    openai: '',
    facebook: '',
    instagram: '',
  }),
});

// Rotation Lambda for API keys
const apiKeyRotationLambda = new lambda.Function(this, 'ApiKeyRotation', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'rotate-api-keys.handler',
  code: lambda.Code.fromAsset('lambda/rotation/api-keys'),
  environment: {
    SECRET_ARN: apiKeySecret.secretArn,
    NOTIFICATION_TOPIC: notificationTopic.topicArn,
  },
  timeout: cdk.Duration.minutes(10),
});

// Schedule rotation every 90 days
apiKeySecret.addRotationSchedule('ApiKeyRotation', {
  automaticallyAfter: cdk.Duration.days(90),
  lambda: apiKeyRotationLambda,
});
```

#### 3. Rotation Lambda Implementation

```typescript
// lambda/rotation/database/index.py
import boto3
import json
import logging
import psycopg2
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

secrets_client = boto3.client('secretsmanager')

def handler(event, context):
    """Rotate RDS PostgreSQL password"""
    arn = event['SecretId']
    token = event['Token']
    step = event['Step']
    
    # Get the secret
    metadata = secrets_client.describe_secret(SecretId=arn)
    
    if step == "createSecret":
        create_secret(secrets_client, arn, token)
    elif step == "setSecret":
        set_secret(secrets_client, arn, token)
    elif step == "testSecret":
        test_secret(secrets_client, arn, token)
    elif step == "finishSecret":
        finish_secret(secrets_client, arn, token)
    else:
        raise ValueError(f"Invalid step: {step}")

def create_secret(client, arn, token):
    """Create new secret version"""
    # Get current secret
    current = client.get_secret_value(SecretId=arn, VersionStage="AWSCURRENT")
    secret = json.loads(current['SecretString'])
    
    # Generate new password
    new_password = client.get_random_password(
        PasswordLength=32,
        ExcludeCharacters=' %+~`#$&*()|[]{}:;<>?!\'/@"\\'
    )['RandomPassword']
    
    # Create new version
    secret['password'] = new_password
    client.put_secret_value(
        SecretId=arn,
        ClientRequestToken=token,
        SecretString=json.dumps(secret),
        VersionStages=['AWSPENDING']
    )
    logger.info("createSecret: Created new secret version")

def set_secret(client, arn, token):
    """Set the new password in the database"""
    # Get pending secret
    pending = client.get_secret_value(
        SecretId=arn,
        VersionId=token,
        VersionStage="AWSPENDING"
    )
    secret = json.loads(pending['SecretString'])
    
    # Get current secret for admin connection
    current = client.get_secret_value(
        SecretId=arn,
        VersionStage="AWSCURRENT"
    )
    current_secret = json.loads(current['SecretString'])
    
    # Connect with current password
    conn = psycopg2.connect(
        host=secret['host'],
        port=secret['port'],
        database=secret['database'],
        user=current_secret['username'],
        password=current_secret['password'],
        sslmode='require'
    )
    
    try:
        with conn.cursor() as cursor:
            # Change password
            cursor.execute(
                f"ALTER USER {secret['username']} "
                f"WITH PASSWORD %s",
                (secret['password'],)
            )
            conn.commit()
            logger.info("setSecret: Password updated in database")
    finally:
        conn.close()

def test_secret(client, arn, token):
    """Test the new password"""
    # Get pending secret
    pending = client.get_secret_value(
        SecretId=arn,
        VersionId=token,
        VersionStage="AWSPENDING"
    )
    secret = json.loads(pending['SecretString'])
    
    # Try to connect with new password
    try:
        conn = psycopg2.connect(
            host=secret['host'],
            port=secret['port'],
            database=secret['database'],
            user=secret['username'],
            password=secret['password'],
            sslmode='require'
        )
        conn.close()
        logger.info("testSecret: New password works")
    except Exception as e:
        logger.error(f"testSecret: Failed to connect: {e}")
        raise

def finish_secret(client, arn, token):
    """Finalize the rotation"""
    # Move staging label to current
    client.update_secret_version_stage(
        SecretId=arn,
        VersionStage="AWSCURRENT",
        MoveToVersionId=token,
        RemoveFromVersionId=client.describe_secret(SecretId=arn)['VersionIdsToStages']
    )
    logger.info("finishSecret: Rotation complete")
```

#### 4. Application Integration

```typescript
// Application code to handle rotation
// services/secrets-manager.ts

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { NodeHttpHandler } from '@aws-sdk/node-http-handler';

class SecretsManager {
  private client: SecretsManagerClient;
  private cache: Map<string, { value: any; expiry: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.client = new SecretsManagerClient({
      region: process.env.AWS_REGION,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 5000,
        requestTimeout: 5000,
      }),
    });
  }

  async getSecret(secretName: string): Promise<any> {
    // Check cache
    const cached = this.cache.get(secretName);
    if (cached && cached.expiry > Date.now()) {
      return cached.value;
    }

    try {
      // Fetch from Secrets Manager
      const response = await this.client.send(
        new GetSecretValueCommand({ SecretId: secretName })
      );
      
      const secret = JSON.parse(response.SecretString || '{}');
      
      // Cache the secret
      this.cache.set(secretName, {
        value: secret,
        expiry: Date.now() + this.CACHE_TTL,
      });
      
      return secret;
    } catch (error) {
      // Handle rotation in progress
      if (error.name === 'InvalidRequestException' && 
          error.message.includes('rotation')) {
        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.getSecret(secretName);
      }
      throw error;
    }
  }

  // Clear cache on rotation signal
  clearCache(): void {
    this.cache.clear();
  }
}

// Database connection with rotation support
class DatabaseConnection {
  private pool: Pool | null = null;
  private secretsManager: SecretsManager;

  constructor() {
    this.secretsManager = new SecretsManager();
  }

  async getConnection(): Promise<Pool> {
    if (!this.pool || !await this.isHealthy()) {
      await this.createPool();
    }
    return this.pool!;
  }

  private async createPool(): Promise<void> {
    // Get latest credentials
    const secret = await this.secretsManager.getSecret('postolio/production/database');
    
    // Close existing pool
    if (this.pool) {
      await this.pool.end();
    }

    // Create new pool
    this.pool = new Pool({
      host: secret.host,
      port: secret.port,
      database: secret.database,
      user: secret.username,
      password: secret.password,
      ssl: { rejectUnauthorized: true },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Handle errors
    this.pool.on('error', (err) => {
      console.error('Database pool error:', err);
      this.pool = null;
    });
  }

  private async isHealthy(): Promise<boolean> {
    if (!this.pool) return false;
    
    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      return true;
    } catch {
      return false;
    }
  }
}
```

### Monitoring & Alerting

```typescript
// CloudWatch alarms for rotation
const rotationFailureAlarm = new cloudwatch.Alarm(this, 'RotationFailure', {
  metric: new cloudwatch.Metric({
    namespace: 'AWS/SecretsManager',
    metricName: 'RotationFailed',
    dimensionsMap: {
      SecretName: dbSecret.secretName,
    },
  }),
  threshold: 1,
  evaluationPeriods: 1,
});

// SNS notification on failure
rotationFailureAlarm.addAlarmAction(
  new cloudwatch_actions.SnsAction(alertTopic)
);
```

### Testing Requirements

- [ ] Test database password rotation
- [ ] Test API key rotation
- [ ] Test application handles rotation
- [ ] Test rotation failure recovery
- [ ] Verify no service interruption
- [ ] Test rollback on rotation failure

### Success Criteria

- [ ] All secrets rotate automatically
- [ ] Zero downtime during rotation
- [ ] Rotation failures alert ops team
- [ ] Applications handle rotation gracefully
- [ ] Audit trail for all rotations
- [ ] Compliance requirements met

### Rotation Schedule

| Secret Type | Rotation Period | Compliance Requirement |
|------------|----------------|----------------------|
| Database passwords | 30 days | PCI-DSS, SOC2 |
| API keys | 90 days | Best practice |
| JWT signing keys | 90 days | Security best practice |
| Encryption keys | 365 days | GDPR, HIPAA |

### Files to Create/Modify

1. **aws-infrastructure/lib/rotation/**
   - Create rotation stack
   - Add rotation Lambdas
   - Configure schedules

2. **lambda/rotation/**
   - Database rotation function
   - API key rotation function
   - JWT key rotation function

3. **src/services/secrets-manager.ts**
   - Add rotation handling
   - Implement caching with TTL
   - Handle rotation errors

### Estimated Effort

- **Development**: 3-4 days
- **Testing**: 2 days
- **Documentation**: 1 day
- **Total**: 1 week

### References

- [AWS Secrets Manager Rotation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html)
- [RDS Password Rotation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets-rds.html)
- [Rotation Lambda Functions](https://github.com/aws-samples/aws-secrets-manager-rotation-lambdas)

### Priority

**🟡 HIGH** - Security compliance requirement

### Labels

`high-priority`, `security`, `secrets`, `compliance`, `automation`