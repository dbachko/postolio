/**
 * Auth Stack - Token Service and Authentication Infrastructure
 * Groups authentication-related microservices into a single logical stack
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwactions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as path from 'path';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { NagSuppressions } from 'cdk-nag';
import { OAuthConfig } from '../utils/oauth-config';

export interface AuthStackProps extends cdk.StackProps, OAuthConfig {
  environment: 'dev' | 'staging' | 'prod';
  alertEmail?: string;
  domainName?: string;
}

export class AuthStack extends cdk.Stack {
  public readonly tokenServiceUrl: string;
  public readonly tokenTable: dynamodb.Table;
  public readonly encryptionKey: kms.Key;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { environment, alertEmail, domainName } = props;
    const prefix = `postolio-${environment}-auth`;

    // ==================== KMS Key for Token Encryption ====================
    this.encryptionKey = new kms.Key(this, 'TokenEncryptionKey', {
      description: `Auth services encryption key - ${environment}`,
      enableKeyRotation: true,
      alias: `alias/${prefix}-encryption`,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ==================== DynamoDB Table for Tokens ====================
    this.tokenTable = new dynamodb.Table(this, 'TokensTable', {
      tableName: `${prefix}-tokens`,
      partitionKey: {
        name: 'pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: environment === 'prod',
      },
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // Add GSI for efficient token lookups
    this.tokenTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: {
        name: 'gsi1pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'gsi1sk',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // ==================== DynamoDB Table for Audit Logs ====================
    const auditTable = new dynamodb.Table(this, 'AuditLogsTable', {
      tableName: `${prefix}-audit-logs`,
      partitionKey: {
        name: 'pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: false, // Not needed for audit logs with TTL
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // Suppress PITR requirement for audit logs
    NagSuppressions.addResourceSuppressions(auditTable, [
      {
        id: 'AwsSolutions-DDB3',
        reason: 'Audit logs use TTL for retention and do not require point-in-time recovery',
      },
    ]);

    // ==================== DynamoDB Table for Rate Limiting ====================
    const rateLimitTable = new dynamodb.Table(this, 'RateLimitTable', {
      tableName: `${prefix}-rate-limits`,
      partitionKey: {
        name: 'pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: false, // Not needed for ephemeral rate limit data
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // Suppress PITR requirement for rate limit table
    NagSuppressions.addResourceSuppressions(rateLimitTable, [
      {
        id: 'AwsSolutions-DDB3',
        reason:
          'Rate limit table stores ephemeral data with TTL and does not require point-in-time recovery',
      },
    ]);

    // ==================== SNS Topic for Alerts ====================
    const alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: `${prefix}-alerts`,
      displayName: `Auth Stack Alerts - ${environment}`,
    });

    // Add topic policy to require SSL for publishers (CDK NAG AwsSolutions-SNS3)
    alertTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSSLRequestsOnly',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['sns:Publish'],
        resources: [alertTopic.topicArn],
        conditions: {
          Bool: {
            'aws:SecureTransport': 'false',
          },
        },
      })
    );

    if (alertEmail) {
      alertTopic.addSubscription(new subscriptions.EmailSubscription(alertEmail));
    }

    // ==================== Lambda Function Role ====================
    const tokenServiceRole = new iam.Role(this, 'TokenServiceRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        TokenServicePolicy: new iam.PolicyDocument({
          statements: [
            // DynamoDB permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem',
                'dynamodb:Query',
                'dynamodb:Scan',
              ],
              resources: [
                this.tokenTable.tableArn,
                `${this.tokenTable.tableArn}/index/*`,
                auditTable.tableArn,
                rateLimitTable.tableArn,
              ],
            }),
            // KMS permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'kms:Encrypt',
                'kms:Decrypt',
                'kms:ReEncrypt*',
                'kms:GenerateDataKey',
                'kms:DescribeKey',
              ],
              resources: [this.encryptionKey.keyArn],
            }),
            // SSM permissions for service discovery
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['ssm:GetParameter', 'ssm:PutParameter'],
              resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/auth/*`,
              ],
            }),
          ],
        }),
      },
    });

    // ==================== Token Service Lambda Function ====================
    const tokenServiceFunction = new NodejsFunction(this, 'TokenServiceFunction', {
      functionName: `${prefix}-token-service`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      entry: path.join(__dirname, '../../../../services/token-service/src/index.ts'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      role: tokenServiceRole,
      environment: {
        NODE_ENV: environment,
        SERVICE_NAME: 'token-service',
        ENVIRONMENT: environment,
        LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
        // AWS_REGION is automatically provided by Lambda runtime
        TOKENS_TABLE: this.tokenTable.tableName,
        AUDIT_TABLE: auditTable.tableName,
        RATE_LIMIT_TABLE: rateLimitTable.tableName,
        KMS_KEY_ID: this.encryptionKey.keyId,
        FACEBOOK_APP_ID: props.facebookAppId || '',
        FACEBOOK_APP_SECRET: props.facebookAppSecret || '',
        INSTAGRAM_APP_ID: props.instagramAppId || '',
        INSTAGRAM_APP_SECRET: props.instagramAppSecret || '',
        LINKEDIN_CLIENT_ID: props.linkedinClientId || '',
        LINKEDIN_CLIENT_SECRET: props.linkedinClientSecret || '',
        TIKTOK_CLIENT_KEY: props.tiktokClientKey || '',
        TIKTOK_CLIENT_SECRET: props.tiktokClientSecret || '',
        GOOGLE_CLIENT_ID: props.googleClientId || '',
        GOOGLE_CLIENT_SECRET: props.googleClientSecret || '',
      },
      logGroup: logs.LogGroup.fromLogGroupName(
        this,
        'TokenServiceLogGroup',
        `/aws/lambda/${prefix}-token-service`
      ),
      tracing: lambda.Tracing.ACTIVE,
    });

    // Create Function URL for the token service
    // CORS origins based on environment
    // Note: dev environment is treated as production for security (deployed to AWS)
    const corsOrigins =
      environment === 'prod' || environment === 'dev'
        ? [
            'https://postolio.example', // Production frontend
            `https://${domainName}`, // Configured API domain (if set)
          ].filter((origin) => origin && !origin.includes('undefined'))
        : [
            // Staging/local development only
            'http://localhost:5173', // Local Vite dev server
            'https://localhost:5173',
            'http://ai.localhost:5173',
            'https://ai.localhost:5173',
            'http://localhost:3000', // Local API server
            'https://localhost:3000',
          ];

    const tokenServiceUrl = tokenServiceFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      cors: {
        allowCredentials: true,
        allowedOrigins: corsOrigins,
        allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.PUT, lambda.HttpMethod.POST],
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'X-Correlation-ID',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
      },
    });

    this.tokenServiceUrl = tokenServiceUrl.url;

    // ==================== CloudWatch Monitoring ====================
    // Error rate alarm
    const errorMetric = tokenServiceFunction.metricErrors({
      period: cdk.Duration.minutes(5),
    });

    const errorAlarm = new cloudwatch.Alarm(this, 'TokenServiceErrorAlarm', {
      alarmName: `${prefix}-token-service-errors`,
      metric: errorMetric,
      threshold: 5,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Token service error rate too high',
    });

    errorAlarm.addAlarmAction(new cwactions.SnsAction(alertTopic));

    // Duration alarm
    const durationMetric = tokenServiceFunction.metricDuration({
      period: cdk.Duration.minutes(5),
    });

    const durationAlarm = new cloudwatch.Alarm(this, 'TokenServiceDurationAlarm', {
      alarmName: `${prefix}-token-service-duration`,
      metric: durationMetric,
      threshold: 15000, // 15 seconds
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Token service duration too high',
    });

    durationAlarm.addAlarmAction(new cwactions.SnsAction(alertTopic));

    // ==================== Import VPC Configuration from Foundation Stack ====================
    let vpc: ec2.IVpc | undefined;
    let lambdaSecurityGroup: ec2.ISecurityGroup | undefined;
    let vpcConfig: ec2.SubnetSelection | undefined;
    let databaseSecretArn: string | undefined;

    try {
      // Import VPC from Foundation stack via context lookup (stable and synth-safe)
      const vpcId = ssm.StringParameter.valueFromLookup(this, `/postolio/${environment}/vpc/id`);
      const lambdaSecurityGroupId = ssm.StringParameter.valueFromLookup(
        this,
        `/postolio/${environment}/security-groups/lambda`
      );
      databaseSecretArn = ssm.StringParameter.valueFromLookup(
        this,
        `/postolio/${environment}/database/secret-arn`
      );

      const hasFoundationResources = vpcId && lambdaSecurityGroupId && databaseSecretArn;
      if (hasFoundationResources) {
        vpc = ec2.Vpc.fromLookup(this, 'FoundationVpc', { vpcId });
        lambdaSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
          this,
          'LambdaSecurityGroup',
          lambdaSecurityGroupId
        );
        vpcConfig = { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };
        console.log(`Using VPC configuration from Foundation stack for environment ${environment}`);
      }
    } catch (error) {
      console.log(
        `VPC import skipped or failed; session-cleanup Lambda will not be created for ${environment}. Error: ${error}`
      );
    }

    // ==================== Session Cleanup Lambda (Conditional on VPC) ====================
    if (vpc && lambdaSecurityGroup && vpcConfig && databaseSecretArn) {
      const sessionCleanupRole = new iam.Role(this, 'SessionCleanupRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AWSLambdaVPCAccessExecutionRole'
          ),
        ],
        inlinePolicies: {
          SessionCleanupPolicy: new iam.PolicyDocument({
            statements: [
              // Secrets Manager permissions for database credentials
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['secretsmanager:GetSecretValue'],
                resources: [databaseSecretArn],
              }),
              // CloudWatch Metrics permissions
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['cloudwatch:PutMetricData'],
                resources: ['*'],
                conditions: {
                  StringEquals: {
                    'cloudwatch:namespace': 'SessionManagement',
                  },
                },
              }),
              // X-Ray tracing permissions
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
                resources: ['*'],
              }),
            ],
          }),
        },
      });

      const sessionCleanupFunction = new NodejsFunction(this, 'SessionCleanupFunction', {
        functionName: `${prefix}-session-cleanup`,
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: 'index.handler',
        entry: path.join(__dirname, '../../../../services/session-cleanup/src/index.ts'),
        timeout: cdk.Duration.minutes(10),
        memorySize: 512,
        role: sessionCleanupRole,
        vpc: vpc,
        vpcSubnets: vpcConfig,
        securityGroups: [lambdaSecurityGroup],
        bundling: {
          commandHooks: {
            afterBundling(inputDir: string, outputDir: string): string[] {
              return [
                `mkdir -p ${outputDir}/lambda-client`,
                `cp -vr ${inputDir}/packages/libs/database/lambda-client/. ${outputDir}/lambda-client/ || true`,
              ];
            },
            beforeBundling(): string[] {
              return [];
            },
            beforeInstall(): string[] {
              return [];
            },
          },
          nodeModules: ['pg', '@prisma/adapter-pg'],
        },
        environment: {
          NODE_ENV: environment,
          SERVICE_NAME: 'session-cleanup',
          ENVIRONMENT: environment,
          LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
          DB_SECRET_ARN: databaseSecretArn,
        },
        tracing: lambda.Tracing.ACTIVE,
      });

      // EventBridge schedule for daily cleanup at 2 AM
      const sessionCleanupRule = new events.Rule(this, 'SessionCleanupRule', {
        ruleName: `${prefix}-session-cleanup-rule`,
        description: 'Trigger session cleanup daily at 2 AM',
        schedule: events.Schedule.cron({
          hour: '2',
          minute: '0',
        }),
      });

      sessionCleanupRule.addTarget(new targets.LambdaFunction(sessionCleanupFunction));

      // CloudWatch monitoring - error rate alarm
      const sessionCleanupErrorMetric = sessionCleanupFunction.metricErrors({
        period: cdk.Duration.minutes(5),
      });

      const sessionCleanupErrorAlarm = new cloudwatch.Alarm(this, 'SessionCleanupErrorAlarm', {
        alarmName: `${prefix}-session-cleanup-errors`,
        metric: sessionCleanupErrorMetric,
        threshold: 5,
        evaluationPeriods: 2,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: 'Session cleanup error rate too high',
      });

      sessionCleanupErrorAlarm.addAlarmAction(new cwactions.SnsAction(alertTopic));

      // CloudWatch monitoring - duration alarm
      const sessionCleanupDurationMetric = sessionCleanupFunction.metricDuration({
        period: cdk.Duration.minutes(5),
      });

      const sessionCleanupDurationAlarm = new cloudwatch.Alarm(
        this,
        'SessionCleanupDurationAlarm',
        {
          alarmName: `${prefix}-session-cleanup-duration`,
          metric: sessionCleanupDurationMetric,
          threshold: 540000, // 9 minutes (timeout is 10 minutes)
          evaluationPeriods: 2,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
          alarmDescription: 'Session cleanup duration approaching timeout',
        }
      );

      sessionCleanupDurationAlarm.addAlarmAction(new cwactions.SnsAction(alertTopic));

      // CDK NAG suppressions for session cleanup role
      NagSuppressions.addResourceSuppressions(
        sessionCleanupRole,
        [
          {
            id: 'AwsSolutions-IAM4',
            reason:
              'AWS managed policies (AWSLambdaBasicExecutionRole, AWSLambdaVPCAccessExecutionRole) are standard for Lambda functions in VPC',
            appliesTo: [
              'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
              'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole',
            ],
          },
          {
            id: 'AwsSolutions-IAM5',
            reason:
              'Wildcard permissions required for CloudWatch Metrics (scoped to namespace) and X-Ray tracing',
            appliesTo: ['Resource::*'],
          },
        ],
        true
      );

      console.log(`Session cleanup Lambda configured for environment ${environment}`);
    } else {
      console.log(
        `Session cleanup Lambda skipped for ${environment} - Foundation stack resources not available`
      );
    }

    // ==================== SSM Parameters for Service Discovery ====================
    new ssm.StringParameter(this, 'TokenServiceUrlParameter', {
      parameterName: `/postolio/${environment}/auth/token-service-url`,
      stringValue: this.tokenServiceUrl,
      description: 'Token Service Function URL',
    });

    // Expose Token Service Function ARN for IAM-based callers (Function URL with AWS_IAM)
    new ssm.StringParameter(this, 'TokenServiceArnParameter', {
      parameterName: `/postolio/${environment}/auth/token-service-arn`,
      stringValue: tokenServiceFunction.functionArn,
      description: 'Token Service Lambda Function ARN',
    });

    new ssm.StringParameter(this, 'TokenTableNameParameter', {
      parameterName: `/postolio/${environment}/auth/token-table-name`,
      stringValue: this.tokenTable.tableName,
      description: 'Token Service DynamoDB Table Name',
    });

    // Expose Audit Logs table name for cross-stack use (e.g., publisher)
    new ssm.StringParameter(this, 'AuditTableNameParameter', {
      parameterName: `/postolio/${environment}/auth/audit-table-name`,
      stringValue: auditTable.tableName,
      description: 'Audit Logs DynamoDB Table Name',
    });

    new ssm.StringParameter(this, 'AuthEncryptionKeyParameter', {
      parameterName: `/postolio/${environment}/auth/encryption-key-id`,
      stringValue: this.encryptionKey.keyId,
      description: 'Auth Stack KMS Encryption Key ID',
    });

    // ==================== Stack Outputs ====================
    new cdk.CfnOutput(this, 'TokenServiceUrl', {
      value: this.tokenServiceUrl,
      description: 'Token Service Function URL',
      exportName: `${prefix}-token-service-url`,
    });

    new cdk.CfnOutput(this, 'TokenTableName', {
      value: this.tokenTable.tableName,
      description: 'Token Service DynamoDB Table Name',
      exportName: `${prefix}-token-table-name`,
    });

    new cdk.CfnOutput(this, 'EncryptionKeyId', {
      value: this.encryptionKey.keyId,
      description: 'Auth Stack KMS Encryption Key ID',
      exportName: `${prefix}-encryption-key-id`,
    });

    // ==================== CDK NAG Suppressions ====================
    NagSuppressions.addResourceSuppressions(
      tokenServiceRole,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Lambda execution role requires broad permissions for DynamoDB operations',
        },
        {
          id: 'AwsSolutions-IAM4',
          reason:
            'AWS managed policy AWSLambdaBasicExecutionRole is standard for Lambda functions and provides minimal CloudWatch Logs permissions',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
          ],
        },
      ],
      true
    );

    // Suppress DynamoDB PITR requirement for non-prod environments
    if (environment !== 'prod') {
      NagSuppressions.addResourceSuppressions(this.tokenTable, [
        {
          id: 'AwsSolutions-DDB3',
          reason:
            'Point-in-time recovery is only enabled for production environment to reduce costs in dev/staging',
        },
      ]);
    }

    // Suppress log retention function IAM issues (created automatically by CDK)
    NagSuppressions.addResourceSuppressions(
      this,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason:
            'Log retention function uses AWS managed policy for CloudWatch Logs access - this is standard CDK behavior',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
          ],
        },
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'Log retention function requires wildcard permissions for CloudWatch Logs management - this is standard CDK behavior',
          appliesTo: ['Resource::*'],
        },
        {
          id: 'AwsSolutions-L1',
          reason: 'Using latest stable Node.js runtime for Lambda functions',
        },
      ],
      true
    );
  }
}
