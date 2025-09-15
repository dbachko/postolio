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
import { NagSuppressions } from 'cdk-nag';
import { OAuthConfig } from '../utils/oauth-config';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { ParameterNames, type Environment } from '@postolio/service-parameters';

export interface TokenServiceStackProps extends cdk.StackProps, OAuthConfig {
  environment: 'dev' | 'staging' | 'prod';
  alertEmail?: string;
}

export class TokenServiceStack extends cdk.Stack {
  public readonly apiUrl: string;
  public readonly functionUrl: string;
  public readonly tableName: string;
  public readonly kmsKeyId: string;

  constructor(scope: Construct, id: string, props: TokenServiceStackProps) {
    super(scope, id, props);

    const { environment, alertEmail } = props;

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
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
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
      entry: path.join(__dirname, '../../../../services/token-service/src/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: environment === 'prod' ? 1024 : 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        TOKENS_TABLE: tokensTable.tableName,
        KMS_KEY_ID: encryptionKey.keyId,
        NODE_ENV: environment,
        // Public OAuth IDs from props (passed via GitHub environment variables)
        FACEBOOK_APP_ID: props.facebookAppId || process.env.FACEBOOK_APP_ID || '',
        INSTAGRAM_APP_ID: props.instagramAppId || process.env.INSTAGRAM_APP_ID || '',
        LINKEDIN_CLIENT_ID: props.linkedinClientId || process.env.LINKEDIN_CLIENT_ID || '',
        TIKTOK_CLIENT_KEY: props.tiktokClientKey || process.env.TIKTOK_CLIENT_KEY || '',
        // OAuth secrets will be retrieved from Secrets Manager at runtime
        // Not passed as environment variables for security
      },
      bundling: {
        nodeModules: ['@prisma/client', 'prisma'],
      },
    });

    // Grant permissions
    tokensTable.grantReadWriteData(tokenServiceLambda);
    encryptionKey.grantEncryptDecrypt(tokenServiceLambda);

    // Grant SSM Parameter Store read permissions for service discovery replacement
    tokenServiceLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/services/*`,
        ],
      })
    );

    // Grant Lambda Function URL invocation permissions for service-to-service calls
    tokenServiceLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunctionUrl'],
        resources: [
          `arn:aws:lambda:${this.region}:${this.account}:function:postolio-*-${environment}`,
          `arn:aws:lambda:${this.region}:${this.account}:function:*-${environment}-*`,
        ],
      })
    );

    // Add Lambda Function URL for direct service-to-service communication
    const functionUrl = tokenServiceLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      cors: {
        allowCredentials: true,
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedOrigins: ['*'],
        allowedHeaders: ['*'],
      },
    });

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

    // Legacy endpoints (for backward compatibility)
    tokens.addMethod('POST', integration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    }); // Store or get token (deprecated)
    tokens.addMethod('DELETE', integration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    }); // Delete token (deprecated)

    const refresh = tokens.addResource('refresh');
    refresh.addMethod('POST', integration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    }); // Refresh token (deprecated)

    // New RESTful endpoints
    // Support for /tokens/batch
    const batch = tokens.addResource('batch');
    batch.addMethod('POST', integration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    }); // Batch get tokens

    // Support for /tokens/{userId}
    const userId = tokens.addResource('{userId}');
    userId.addMethod('GET', integration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    }); // List all user tokens

    // Support for /tokens/{userId}/{platform}
    const platform = userId.addResource('{platform}');
    platform.addMethod('GET', integration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    }); // List platform tokens

    // Support for /tokens/{userId}/{platform}/{brandId}
    const brandId = platform.addResource('{brandId}');
    brandId.addMethod('GET', integration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    }); // Get token
    brandId.addMethod('PUT', integration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    }); // Store/update token
    brandId.addMethod('DELETE', integration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    }); // Delete token

    // Support for /tokens/{userId}/{platform}/{brandId}/validate
    const validate = brandId.addResource('validate');
    validate.addMethod('POST', integration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    }); // Validate token

    // Support for /tokens/{userId}/{platform}/{brandId}/refresh
    const refreshNew = brandId.addResource('refresh');
    refreshNew.addMethod('POST', integration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    }); // Refresh token (new endpoint)

    // Support for /tokens/{userId}/{platform}/{brandId}/rotate
    const rotate = brandId.addResource('rotate');
    rotate.addMethod('POST', integration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    }); // Rotate token

    const health = api.root.addResource('health');
    health.addMethod('GET', integration); // Health check - no auth required

    const metrics = api.root.addResource('metrics');
    metrics.addMethod('GET', integration); // Metrics - no auth required

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
    this.functionUrl = functionUrl.url;
    this.tableName = tokensTable.tableName;
    this.kmsKeyId = encryptionKey.keyId;

    new cdk.CfnOutput(this, 'TokenServiceApiUrl', {
      value: this.apiUrl,
      description: 'Token Service API URL (legacy API Gateway)',
      // No export needed - services use Cloud Map for discovery
    });

    // Output Lambda Function URL for service-to-service communication
    new cdk.CfnOutput(this, 'TokenServiceFunctionUrl', {
      value: functionUrl.url,
      description: 'Token Service Lambda Function URL for direct service-to-service calls',
      exportName: `${this.stackName}-FunctionUrl`,
    });

    // Store Lambda Function URL in SSM Parameter Store for service discovery replacement
    new ssm.StringParameter(this, 'TokenServiceFunctionUrlParameter', {
      parameterName: ParameterNames.getParameterName(
        'TOKEN_SERVICE_URL',
        environment as Environment
      ),
      stringValue: functionUrl.url,
      description: 'Token Service Lambda Function URL for service-to-service communication',
      tier: ssm.ParameterTier.STANDARD,
    });

    // Store API Gateway ID in SSM Parameter Store for cross-service access (legacy)
    new ssm.StringParameter(this, 'TokenServiceApiIdParameter', {
      parameterName: `/postolio/${environment}/token-service/api-gateway-id`,
      stringValue: api.restApiId,
      description: 'Token Service API Gateway ID for cross-service IAM permissions (legacy)',
      tier: ssm.ParameterTier.STANDARD,
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
    this.applyCdkNagSuppressions(tokensTable, tokenServiceLambda, api, environment);
  }

  private applyCdkNagSuppressions(
    tokensTable: dynamodb.Table,
    tokenServiceLambda: NodejsFunction,
    api: apigateway.RestApi,
    environment: string
  ): void {
    // DynamoDB suppressions
    NagSuppressions.addResourceSuppressions(tokensTable, [
      {
        id: 'AwsSolutions-DDB3',
        reason:
          'Point-in-time recovery is enabled for production only to optimize costs in dev/staging environments',
      },
    ]);

    // Lambda suppressions
    NagSuppressions.addResourceSuppressions(
      tokenServiceLambda,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'AWSLambdaBasicExecutionRole is required for Lambda CloudWatch logging',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
          ],
        },
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'Wildcard permissions are required for DynamoDB index operations, KMS key operations, SSM parameter access, and Lambda Function URL invocation',
          appliesTo: [
            'Resource::*',
            'Resource::<TokensTable6C9B5BC6.Arn>/index/*',
            'Action::kms:GenerateDataKey*',
            'Action::kms:ReEncrypt*',
            `Resource::arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/services/*`,
            `Resource::arn:aws:lambda:${this.region}:${this.account}:function:postolio-*-${environment}`,
            `Resource::arn:aws:lambda:${this.region}:${this.account}:function:*-${environment}-*`,
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
  }
}
