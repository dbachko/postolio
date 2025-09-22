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
import * as path from 'path';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { NagSuppressions } from 'cdk-nag';
import { OAuthConfig } from '../utils/oauth-config';
import { ParameterNames, type Environment } from '@postolio/service-parameters';

export interface AuthStackProps extends cdk.StackProps, OAuthConfig {
  environment: 'dev' | 'staging' | 'prod';
  alertEmail?: string;
}

export class AuthStack extends cdk.Stack {
  public readonly tokenServiceUrl: string;
  public readonly tokenTable: dynamodb.Table;
  public readonly encryptionKey: kms.Key;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { environment, alertEmail } = props;
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
      pointInTimeRecovery: environment === 'prod',
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

    // ==================== SNS Topic for Alerts ====================
    const alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: `${prefix}-alerts`,
      displayName: `Auth Stack Alerts - ${environment}`,
    });

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
              actions: [
                'ssm:GetParameter',
                'ssm:PutParameter',
              ],
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
      entry: path.join(__dirname, '../../lib/lambdas/token-service/index.ts'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      role: tokenServiceRole,
      environment: {
        NODE_ENV: environment,
        SERVICE_NAME: 'token-service',
        ENVIRONMENT: environment,
        LOG_LEVEL: environment === 'prod' ? 'info' : 'debug',
        AWS_REGION: this.region,
        TOKENS_TABLE_NAME: this.tokenTable.tableName,
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
      logRetention: logs.RetentionDays.TWO_WEEKS,
      tracing: lambda.Tracing.ACTIVE,
    });

    // Create Function URL for the token service
    const tokenServiceUrl = tokenServiceFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      cors: {
        allowCredentials: true,
        allowedOrigins: ['*'], // Restrict in production
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['*'],
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

    // ==================== SSM Parameters for Service Discovery ====================
    new ssm.StringParameter(this, 'TokenServiceUrlParameter', {
      parameterName: ParameterNames.tokenServiceUrl(environment as Environment),
      stringValue: this.tokenServiceUrl,
      description: 'Token Service Function URL',
    });

    new ssm.StringParameter(this, 'TokenTableNameParameter', {
      parameterName: ParameterNames.tokenTableName(environment as Environment),
      stringValue: this.tokenTable.tableName,
      description: 'Token Service DynamoDB Table Name',
    });

    new ssm.StringParameter(this, 'AuthEncryptionKeyParameter', {
      parameterName: ParameterNames.authEncryptionKey(environment as Environment),
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
      ],
      true
    );

    NagSuppressions.addResourceSuppressions(
      this,
      [
        {
          id: 'AwsSolutions-L1',
          reason: 'Using latest stable Node.js runtime for Lambda functions',
        },
      ],
      true
    );
  }
}