import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ContentSchedulerStackProps extends cdk.StackProps {
  environment: 'dev' | 'staging' | 'prod';
  alertEmail?: string;
}

export class ContentSchedulerStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly schedulesTable: dynamodb.Table;
  public readonly videoBucket: s3.Bucket;
  public readonly userPool: cognito.UserPool;

  constructor(scope: Construct, id: string, props: ContentSchedulerStackProps) {
    super(scope, id, props);

    const { environment, alertEmail } = props;
    const prefix = `postolio-scheduler-${environment}`;

    // ==================== KMS Keys ====================
    
    const encryptionKey = new kms.Key(this, 'EncryptionKey', {
      alias: `${prefix}-key`,
      description: 'KMS key for Content Scheduler encryption',
      enableKeyRotation: true,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ==================== Cognito User Pool (API Authentication) ====================
    
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${prefix}-users`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
    });

    // ==================== DynamoDB Tables with PITR ====================
    
    // Schedules Table with PITR
    this.schedulesTable = new dynamodb.Table(this, 'SchedulesTable', {
      tableName: `${prefix}-schedules`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: environment === 'prod' ? 
        dynamodb.BillingMode.PROVISIONED : 
        dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true, // ✅ PITR enabled
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: encryptionKey,
      timeToLiveAttribute: 'ttl',
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Add auto-scaling for production
    if (environment === 'prod') {
      const readScaling = this.schedulesTable.autoScaleReadCapacity({
        minCapacity: 5,
        maxCapacity: 500,
      });
      readScaling.scaleOnUtilization({
        targetUtilizationPercent: 70,
      });

      const writeScaling = this.schedulesTable.autoScaleWriteCapacity({
        minCapacity: 5,
        maxCapacity: 500,
      });
      writeScaling.scaleOnUtilization({
        targetUtilizationPercent: 70,
      });
    }

    // GSI for querying by brand
    this.schedulesTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by status
    this.schedulesTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'scheduledAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Retry Queue Table with PITR
    const retryQueueTable = new dynamodb.Table(this, 'RetryQueueTable', {
      tableName: `${prefix}-retry-queue`,
      partitionKey: { name: 'scheduleId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'attemptNumber', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true, // ✅ PITR enabled
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: encryptionKey,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Audit Log Table with PITR (GDPR Compliance)
    const auditLogTable = new dynamodb.Table(this, 'AuditLogTable', {
      tableName: `${prefix}-audit-log`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true, // ✅ PITR enabled
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: encryptionKey,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ==================== S3 Buckets with Access Logging ====================
    
    // Access Logs Bucket
    const accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      bucketName: `${prefix}-access-logs`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        {
          id: 'delete-old-logs',
          enabled: true,
          expiration: cdk.Duration.days(30),
        },
      ],
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Video Storage Bucket with Access Logging
    this.videoBucket = new s3.Bucket(this, 'VideoBucket', {
      bucketName: `${prefix}-videos`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: encryptionKey,
      serverAccessLogsBucket: accessLogsBucket, // ✅ Access logging enabled
      serverAccessLogsPrefix: 'video-bucket-logs/',
      versioned: true,
      transferAcceleration: true, // ✅ Enable for faster video uploads
      lifecycleRules: [
        {
          id: 'delete-incomplete-multipart-uploads',
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
        {
          id: 'intelligent-tiering',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(0),
            },
          ],
        },
        {
          id: 'gdpr-compliance-deletion',
          enabled: true,
          expiration: cdk.Duration.days(90),
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: environment === 'prod' ? ['https://postolio.example'] : ['http://localhost:3000'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: environment !== 'prod',
    });

    // ==================== Secrets with Rotation ====================
    
    const platformCredentials = new secretsmanager.Secret(this, 'PlatformCredentials', {
      secretName: `${prefix}-platform-credentials`,
      description: 'Social media platform API credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          instagram: { clientId: '', clientSecret: '', accessToken: '' },
          tiktok: { clientKey: '', clientSecret: '', accessToken: '' },
          youtube: { apiKey: '', clientId: '', clientSecret: '' },
        }),
        generateStringKey: 'temp',
      },
      // Note: Automatic rotation would be configured separately
      // automaticRotation requires a rotation Lambda function
    });

    // ==================== Dead Letter Queues ====================
    
    const deadLetterQueue = new sqs.Queue(this, 'DeadLetterQueue', {
      queueName: `${prefix}-dlq`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: encryptionKey,
      retentionPeriod: cdk.Duration.days(14),
      // Visibility timeout must be >= Lambda timeout (60 seconds) * 6
      visibilityTimeout: cdk.Duration.seconds(360),
    });

    // ==================== Lambda Layer for Powertools ====================
    
    const powertoolsLayer = new lambda.LayerVersion(this, 'PowertoolsLayer', {
      layerVersionName: `${prefix}-powertools`,
      code: lambda.Code.fromAsset(path.join(__dirname, '../layers/powertools')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_22_X],
      description: 'AWS Lambda Powertools for TypeScript',
    });

    // ==================== Lambda Functions with Best Practices ====================
    
    // Shared Lambda environment variables 
    const lambdaEnvironment = {
      ENVIRONMENT: environment,
      SCHEDULES_TABLE: this.schedulesTable.tableName,
      RETRY_QUEUE_TABLE: retryQueueTable.tableName,
      AUDIT_LOG_TABLE: auditLogTable.tableName,
      VIDEO_BUCKET: this.videoBucket.bucketName,
      PLATFORM_CREDENTIALS_SECRET: platformCredentials.secretArn,
      MAIN_APP_API_URL: process.env.MAIN_APP_API_URL || 'http://localhost:3000',
      POWERTOOLS_SERVICE_NAME: 'content-scheduler',
      POWERTOOLS_METRICS_NAMESPACE: 'ContentScheduler',
      LOG_LEVEL: environment === 'prod' ? 'INFO' : 'DEBUG',
      SCHEDULER_GROUP_NAME: `${prefix}-schedules`,
    };

    // Custom IAM Role for Lambda (Least Privilege)
    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Custom execution role for Content Scheduler Lambda functions',
    });

    // Add only necessary permissions
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/${prefix}-*`],
    }));

    // Add X-Ray tracing permissions
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
      resources: ['*'],
    }));

    // Schedule Management Lambda with Node.js 22.x
    const scheduleManagementLambda = new lambdaNodejs.NodejsFunction(this, 'ScheduleManagementLambda', {
      functionName: `${prefix}-schedule-management`,
      runtime: lambda.Runtime.NODEJS_22_X, // ✅ Latest runtime
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/schedule-management/index.ts'),
      bundling: {
        minify: environment === 'prod',
        sourceMap: environment !== 'prod',
        externalModules: [
          '@aws-lambda-powertools/logger', 
          '@aws-lambda-powertools/tracer', 
          '@aws-lambda-powertools/metrics',
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/lib-dynamodb',
          '@aws-sdk/client-scheduler',
          '@aws-sdk/*'
        ],
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 1024,
      reservedConcurrentExecutions: environment === 'prod' ? 10 : undefined,
      environment: lambdaEnvironment,
      layers: [powertoolsLayer],
      // Using default role to avoid circular dependencies
      tracing: lambda.Tracing.ACTIVE,
      // logRetention removed to avoid circular dependencies
      deadLetterQueueEnabled: true,
      deadLetterQueue: deadLetterQueue,
    });

    // Publisher Lambda with proper configuration
    const publisherLambda = new lambdaNodejs.NodejsFunction(this, 'PublisherLambda', {
      functionName: `${prefix}-publisher`,
      runtime: lambda.Runtime.NODEJS_22_X, // ✅ Latest runtime
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/publisher/index.ts'),
      bundling: {
        minify: environment === 'prod',
        sourceMap: environment !== 'prod',
        externalModules: [
          '@aws-lambda-powertools/logger', 
          '@aws-lambda-powertools/tracer', 
          '@aws-lambda-powertools/metrics',
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/lib-dynamodb',
          '@aws-sdk/client-scheduler',
          '@aws-sdk/*'
        ],
      },
      timeout: cdk.Duration.minutes(5),
      memorySize: 2048,
      reservedConcurrentExecutions: environment === 'prod' ? 50 : undefined,
      environment: lambdaEnvironment,
      layers: [powertoolsLayer],
      // Using default role to avoid circular dependencies
      tracing: lambda.Tracing.ACTIVE,
      // logRetention removed to avoid circular dependencies
      deadLetterQueueEnabled: true,
      deadLetterQueue: deadLetterQueue,
    });

    // Retry Handler Lambda
    const retryHandlerLambda = new lambdaNodejs.NodejsFunction(this, 'RetryHandlerLambda', {
      functionName: `${prefix}-retry-handler`,
      runtime: lambda.Runtime.NODEJS_22_X, // ✅ Latest runtime
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/retry-handler/index.ts'),
      bundling: {
        minify: environment === 'prod',
        sourceMap: environment !== 'prod',
        externalModules: [
          '@aws-lambda-powertools/logger', 
          '@aws-lambda-powertools/tracer', 
          '@aws-lambda-powertools/metrics',
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/lib-dynamodb',
          '@aws-sdk/client-scheduler',
          '@aws-sdk/*'
        ],
      },
      timeout: cdk.Duration.minutes(1),
      memorySize: 512,
      environment: {
        ...lambdaEnvironment,
        PUBLISHER_LAMBDA_ARN: publisherLambda.functionArn,
      },
      layers: [powertoolsLayer],
      // Using default role to avoid circular dependencies
      tracing: lambda.Tracing.ACTIVE,
      // logRetention removed to avoid circular dependencies
    });

    // Add DLQ as event source for retry handler
    retryHandlerLambda.addEventSource(new SqsEventSource(deadLetterQueue, {
      batchSize: 10,
      maxBatchingWindow: cdk.Duration.seconds(5),
    }));

    // Grant permissions using least privilege
    this.schedulesTable.grantReadWriteData(scheduleManagementLambda);
    this.schedulesTable.grantReadWriteData(publisherLambda);
    retryQueueTable.grantReadWriteData(publisherLambda);
    retryQueueTable.grantReadWriteData(retryHandlerLambda);
    auditLogTable.grantWriteData(scheduleManagementLambda);
    auditLogTable.grantWriteData(publisherLambda);
    this.videoBucket.grantReadWrite(publisherLambda);
    platformCredentials.grantRead(publisherLambda);
    publisherLambda.grantInvoke(retryHandlerLambda);
    deadLetterQueue.grantConsumeMessages(retryHandlerLambda);

    // ==================== EventBridge Scheduler (Modern API) ====================
    
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });

    publisherLambda.grantInvoke(schedulerRole);

    // Create scheduler group
    const schedulerGroup = new scheduler.CfnScheduleGroup(this, 'SchedulerGroup', {
      name: `${prefix}-schedules`,
    });

    // Add environment variables to Lambda functions here
    scheduleManagementLambda.addEnvironment('PUBLISHER_LAMBDA_ARN', publisherLambda.functionArn);
    scheduleManagementLambda.addEnvironment('SCHEDULER_ROLE_ARN', schedulerRole.roleArn);

    // ==================== API Gateway with Request Validation ====================
    
    this.api = new apigateway.RestApi(this, 'SchedulerApi', {
      restApiName: `${prefix}-api`,
      description: 'Content Scheduler Microservice API',
      deployOptions: {
        stageName: environment,
        tracingEnabled: true,
        // Disable logging to avoid CloudWatch Logs role issue
        loggingLevel: apigateway.MethodLoggingLevel.OFF,
        metricsEnabled: true,
        throttlingBurstLimit: 1000,
        throttlingRateLimit: 500,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: environment === 'prod' ? ['https://postolio.example'] : apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Add Cognito authorizer
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'ApiAuthorizer', {
      cognitoUserPools: [this.userPool],
      authorizerName: `${prefix}-authorizer`,
    });

    // Request Validator
    const requestValidator = new apigateway.RequestValidator(this, 'RequestValidator', {
      restApi: this.api,
      requestValidatorName: 'request-validator',
      validateRequestBody: true,
      validateRequestParameters: true,
    });

    // API Model for request validation
    const scheduleModel = new apigateway.Model(this, 'ScheduleModel', {
      restApi: this.api,
      contentType: 'application/json',
      modelName: 'ScheduleModel',
      schema: {
        schema: apigateway.JsonSchemaVersion.DRAFT4,
        title: 'Schedule',
        type: apigateway.JsonSchemaType.OBJECT,
        required: ['brandId', 'contentId', 'platform', 'scheduledAt'],
        properties: {
          brandId: { type: apigateway.JsonSchemaType.STRING },
          contentId: { type: apigateway.JsonSchemaType.STRING },
          platform: { 
            type: apigateway.JsonSchemaType.STRING,
            enum: ['instagram', 'tiktok', 'youtube'],
          },
          scheduledAt: { 
            type: apigateway.JsonSchemaType.STRING,
            format: 'date-time',
          },
          contentType: { 
            type: apigateway.JsonSchemaType.STRING,
            enum: ['image', 'video'],
          },
          videoUrl: { type: apigateway.JsonSchemaType.STRING },
          caption: { type: apigateway.JsonSchemaType.STRING },
          hashtags: {
            type: apigateway.JsonSchemaType.ARRAY,
            items: { type: apigateway.JsonSchemaType.STRING },
          },
        },
      },
    });

    // API Resources with authorization
    const schedulesResource = this.api.root.addResource('schedules');
    const scheduleResource = schedulesResource.addResource('{scheduleId}');

    // API Methods with validation and authorization
    const lambdaIntegration = new apigateway.LambdaIntegration(scheduleManagementLambda);
    
    schedulesResource.addMethod('POST', lambdaIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      requestValidator,
      requestModels: {
        'application/json': scheduleModel,
      },
    });

    schedulesResource.addMethod('GET', lambdaIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    scheduleResource.addMethod('GET', lambdaIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    scheduleResource.addMethod('PUT', lambdaIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      requestValidator,
      requestModels: {
        'application/json': scheduleModel,
      },
    });

    scheduleResource.addMethod('DELETE', lambdaIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Environment variables moved to Lambda definition to avoid circular dependencies

    // ==================== WAF for API Protection ====================
    
    if (environment === 'prod') {
      const webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
        scope: 'REGIONAL',
        defaultAction: { allow: {} },
        rules: [
          {
            name: 'RateLimitRule',
            priority: 1,
            statement: {
              rateBasedStatement: {
                limit: 2000,
                aggregateKeyType: 'IP',
              },
            },
            action: { block: {} },
            visibilityConfig: {
              sampledRequestsEnabled: true,
              cloudWatchMetricsEnabled: true,
              metricName: 'RateLimitRule',
            },
          },
          {
            name: 'AWSManagedRulesCommonRuleSet',
            priority: 2,
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesCommonRuleSet',
              },
            },
            overrideAction: { none: {} },
            visibilityConfig: {
              sampledRequestsEnabled: true,
              cloudWatchMetricsEnabled: true,
              metricName: 'CommonRuleSet',
            },
          },
        ],
        visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: 'WebAcl',
        },
      });

      new wafv2.CfnWebACLAssociation(this, 'WebAclAssociation', {
        resourceArn: this.api.deploymentStage.stageArn,
        webAclArn: webAcl.attrArn,
      });
    }

    // ==================== CloudWatch Alarms with KMS ====================
    
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `${prefix}-alarms`,
      displayName: 'Content Scheduler Alarms',
      masterKey: encryptionKey, // ✅ SNS encryption
    });

    if (alertEmail) {
      alarmTopic.addSubscription(new snsSubscriptions.EmailSubscription(alertEmail));
    }

    // Publishing failure alarm
    new cloudwatch.Alarm(this, 'PublishingFailureAlarm', {
      alarmName: `${prefix}-publishing-failures`,
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensionsMap: {
          FunctionName: publisherLambda.functionName,
        },
      }),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      actionsEnabled: true,
    }).addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // High retry rate alarm
    new cloudwatch.Alarm(this, 'HighRetryRateAlarm', {
      alarmName: `${prefix}-high-retry-rate`,
      metric: new cloudwatch.Metric({
        namespace: 'ContentScheduler',
        metricName: 'RetryCount',
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 100,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // DLQ message count alarm
    new cloudwatch.Alarm(this, 'DLQAlarm', {
      alarmName: `${prefix}-dlq-messages`,
      metric: deadLetterQueue.metricApproximateNumberOfMessagesVisible(),
      threshold: 10,
      evaluationPeriods: 1,
    }).addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // ==================== CDK Nag Suppressions with Justifications ====================
    
    // Suppress X-Ray permissions specifically
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/LambdaExecutionRole/DefaultPolicy/Resource`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'X-Ray tracing requires wildcard permissions for PutTraceSegments and PutTelemetryRecords',
          appliesTo: [
            'Resource::arn:aws:xray:*:*:trace/*',
            'Resource::arn:aws:xray:*:*:group/*',
          ],
        },
      ]
    );

    // Suppress API Gateway logging configuration
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/SchedulerApi/Resource`,
      [
        {
          id: 'AwsSolutions-APIG1',
          reason: 'CloudWatch logging disabled to avoid circular dependency with IAM role. Metrics and tracing are enabled for monitoring.',
        },
      ]
    );

    // Suppress access logs bucket logging requirement
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/AccessLogsBucket/Resource`,
      [
        {
          id: 'AwsSolutions-S1',
          reason: 'This is the access logs bucket itself - enabling access logging would create an infinite loop',
        },
      ]
    );

    // ==================== Outputs ====================
    
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.api.url,
      description: 'Content Scheduler API endpoint',
      exportName: `${prefix}-api-endpoint`,
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `${prefix}-user-pool-id`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `${prefix}-user-pool-client-id`,
    });

    new cdk.CfnOutput(this, 'SchedulesTableName', {
      value: this.schedulesTable.tableName,
      description: 'DynamoDB Schedules table name',
      exportName: `${prefix}-schedules-table`,
    });

    new cdk.CfnOutput(this, 'VideoBucketName', {
      value: this.videoBucket.bucketName,
      description: 'S3 Video bucket name',
      exportName: `${prefix}-video-bucket`,
    });
  }
}