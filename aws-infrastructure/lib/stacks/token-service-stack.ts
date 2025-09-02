/**
 * Token Service CDK Stack
 * Deploys DynamoDB, KMS, Lambda, and API Gateway for OAuth token management
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwactions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as path from 'path';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { ServiceDiscoveryManager, registerLambdaService, getServiceDiscoveryEnvVars } from '../utils/service-discovery-infrastructure';
import { NagSuppressions } from 'cdk-nag';

export interface TokenServiceStackProps extends cdk.StackProps {
  environment: 'dev' | 'staging' | 'prod';
  alertEmail?: string;
  serviceDiscoveryNamespaceId?: string; // Use shared namespace
}

export class TokenServiceStack extends cdk.Stack {
  public readonly apiUrl: string;
  public readonly tableName: string;
  public readonly kmsKeyId: string;

  constructor(scope: Construct, id: string, props: TokenServiceStackProps) {
    super(scope, id, props);

    const { environment, alertEmail, serviceDiscoveryNamespaceId } = props;

    // Use shared Service Discovery namespace
    const serviceDiscovery = new ServiceDiscoveryManager(this, 'ServiceDiscovery', {
      environment,
      existingNamespaceId: serviceDiscoveryNamespaceId || cdk.Fn.importValue(`ServiceDiscovery-${environment}-NamespaceId`),
    });

    // Create KMS key for token encryption
    const encryptionKey = new kms.Key(this, 'TokenEncryptionKey', {
      description: `Token Service encryption key - ${environment}`,
      enableKeyRotation: true,
      alias: `alias/token-service-${environment}`,
    });

    // Create DynamoDB table for tokens
    const tokensTable = new dynamodb.Table(this, 'TokensTable', {
      tableName: `token-service-${environment}`,
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
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: environment === 'prod',
      removalPolicy: environment === 'prod' 
        ? cdk.RemovalPolicy.RETAIN 
        : cdk.RemovalPolicy.DESTROY,
    });

    // Add GSI for querying by expiry
    tokensTable.addGlobalSecondaryIndex({
      indexName: 'by-expiry',
      partitionKey: {
        name: 'platform',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'expiresAt',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Create Lambda function
    const tokenServiceLambda = new NodejsFunction(this, 'TokenServiceFunction', {
      functionName: `token-service-${environment}`,
      entry: path.join(__dirname, '../lambda/token-service/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: environment === 'prod' ? 1024 : 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        TOKENS_TABLE: tokensTable.tableName,
        KMS_KEY_ID: encryptionKey.keyId,
        NODE_ENV: environment,
        ...getServiceDiscoveryEnvVars(serviceDiscovery.getClientConfig()),
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
      tracing: lambda.Tracing.ACTIVE,
    });

    // Grant permissions
    tokensTable.grantReadWriteData(tokenServiceLambda);
    encryptionKey.grantEncryptDecrypt(tokenServiceLambda);

    // Create API Gateway
    const api = new apigateway.RestApi(this, 'TokenServiceApi', {
      restApiName: `token-service-${environment}`,
      description: 'Token Service API for OAuth token management',
      deployOptions: {
        stageName: environment,
        tracingEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: environment !== 'prod',
        metricsEnabled: true,
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Lambda integration
    const integration = new apigateway.LambdaIntegration(tokenServiceLambda, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
    });

    // API routes with IAM authentication
    const tokens = api.root.addResource('tokens');
    tokens.addMethod('POST', integration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    }); // Store or get token
    tokens.addMethod('DELETE', integration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    }); // Delete token

    const refresh = tokens.addResource('refresh');
    refresh.addMethod('POST', integration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    }); // Refresh token

    const health = api.root.addResource('health');
    health.addMethod('GET', integration); // Health check - no auth required

    // Register Token Service with Cloud Map
    registerLambdaService(
      serviceDiscovery,
      'token-service',
      api.url,
      environment
    );

    // CloudWatch Alarms
    const errorAlarm = new cloudwatch.Alarm(this, 'TokenServiceErrors', {
      alarmName: `token-service-errors-${environment}`,
      metric: tokenServiceLambda.metricErrors(),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const throttleAlarm = new cloudwatch.Alarm(this, 'TokenServiceThrottles', {
      alarmName: `token-service-throttles-${environment}`,
      metric: tokenServiceLambda.metricThrottles(),
      threshold: 10,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // SNS Topic for alarms (if email provided)
    if (alertEmail) {
      const alarmTopic = new sns.Topic(this, 'TokenServiceAlarms', {
        topicName: `token-service-alarms-${environment}`,
        displayName: 'Token Service Alarms',
      });

      alarmTopic.addSubscription(new subscriptions.EmailSubscription(alertEmail));

      errorAlarm.addAlarmAction(new cwactions.SnsAction(alarmTopic));
      throttleAlarm.addAlarmAction(new cwactions.SnsAction(alarmTopic));
    }

    // Outputs
    this.apiUrl = api.url;
    this.tableName = tokensTable.tableName;
    this.kmsKeyId = encryptionKey.keyId;

    new cdk.CfnOutput(this, 'TokenServiceApiUrl', {
      value: this.apiUrl,
      description: 'Token Service API URL',
      // No export needed - services use Cloud Map for discovery
    });

    new cdk.CfnOutput(this, 'TokenServiceTableName', {
      value: this.tableName,
      description: 'DynamoDB table name',
      exportName: `${this.stackName}-TableName`,
    });

    // Tags
    cdk.Tags.of(this).add('Service', 'TokenService');
    cdk.Tags.of(this).add('Environment', environment);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    // Apply CDK Nag suppressions
    this.applyCdkNagSuppressions(tokensTable, tokenServiceLambda, api);
  }

  private applyCdkNagSuppressions(
    tokensTable: dynamodb.Table,
    tokenServiceLambda: NodejsFunction,
    api: apigateway.RestApi
  ): void {
    // DynamoDB suppressions
    NagSuppressions.addResourceSuppressions(tokensTable, [
      {
        id: 'AwsSolutions-DDB3',
        reason: 'Point-in-time recovery is enabled for production only to optimize costs in dev/staging environments',
      },
    ]);

    // Lambda suppressions
    NagSuppressions.addResourceSuppressions(
      tokenServiceLambda,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'AWSLambdaBasicExecutionRole is required for Lambda CloudWatch logging',
          appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
        },
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Wildcard permissions are required for DynamoDB index operations and KMS key operations',
          appliesTo: [
            'Resource::*',
            'Resource::<TokensTable6C9B5BC6.Arn>/index/*',
            'Action::kms:GenerateDataKey*',
            'Action::kms:ReEncrypt*',
          ],
        },
        {
          id: 'AwsSolutions-L1',
          reason: 'Using Node.js 20.x which is the current LTS version and actively maintained',
        },
      ],
      true // Apply to all children
    );

    // API Gateway suppressions
    NagSuppressions.addResourceSuppressions(
      api,
      [
        {
          id: 'AwsSolutions-APIG2',
          reason: 'Request validation handled at Lambda level for flexibility',
        },
        {
          id: 'AwsSolutions-APIG1',
          reason: 'Access logging configured via deployOptions with CloudWatch integration',
        },
        {
          id: 'AwsSolutions-APIG3',
          reason: 'WAF not required for internal service-to-service communication in VPC',
        },
        {
          id: 'AwsSolutions-APIG4',
          reason: 'Service uses API key authentication for service-to-service communication',
        },
        {
          id: 'AwsSolutions-COG4',
          reason: 'Cognito not applicable for internal service-to-service API',
        },
      ],
      true // Apply to all children
    );

    // LogRetention Lambda suppressions (auto-generated by CDK)
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/LogRetentionaae0aa3c5b4d4f87b02d85b201efdd8a/ServiceRole/Resource`,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'LogRetention Lambda auto-generated by CDK with managed policy',
          appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
        },
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/LogRetentionaae0aa3c5b4d4f87b02d85b201efdd8a/ServiceRole/DefaultPolicy/Resource`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'LogRetention Lambda requires wildcard for CloudWatch Logs operations',
          appliesTo: ['Resource::*'],
        },
      ]
    );
  }
}