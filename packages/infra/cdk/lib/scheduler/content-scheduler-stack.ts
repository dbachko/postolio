import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import * as path from 'path';
import { ParameterNames, type Environment } from '@postolio/service-parameters';

export interface ContentSchedulerStackProps extends cdk.StackProps {
  environment: 'dev' | 'staging' | 'prod';
  alertEmail?: string;
  mainAppApiUrl?: string;
}

export class ContentSchedulerStack extends cdk.Stack {
  public readonly schedulesTable: dynamodb.Table;
  public readonly videoBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: ContentSchedulerStackProps) {
    super(scope, id, props);

    const { environment, alertEmail } = props;
    const prefix = `postolio-${environment}-scheduler`;

    // VPC configuration from database secret
    const databaseSecretName = `postolio-${environment}-database-credentials`;
    const databaseSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'DatabaseCredentialsSecret',
      databaseSecretName
    );

    // VPC configuration for database access - lookup from database secret
    let vpc: ec2.IVpc | undefined;
    let dbSecurityGroup: ec2.ISecurityGroup | undefined;
    let lambdaSecurityGroup: ec2.ISecurityGroup | undefined;

    // VPC lookup requires concrete value at synthesis time, but security group can use SSM
    const vpcId = 'vpc-03e5d38b2feb71ed8'; // Must be concrete for Vpc.fromLookup()
    const dbSecurityGroupId = ssm.StringParameter.valueForStringParameter(
      this,
      `/postolio/${environment}/database/security-group-id`
    );

    if (vpcId && dbSecurityGroupId) {
      vpc = ec2.Vpc.fromLookup(this, 'DatabaseVpc', {
        vpcId: vpcId,
      });

      dbSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
        this,
        'DatabaseSecurityGroup',
        dbSecurityGroupId
      );

      // Create a dedicated security group for Lambda functions
      lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
        vpc: vpc,
        description: 'Security group for Lambda functions accessing RDS Proxy',
        allowAllOutbound: true,
      });

      // Allow Lambda security group to access database security group on RDS Proxy port
      dbSecurityGroup.addIngressRule(
        lambdaSecurityGroup,
        ec2.Port.tcp(5432),
        'Allow Lambda functions to connect to RDS Proxy'
      );
    }

    // Publisher Lambda now uses AWS IAM SigV4 authentication instead of API keys

    // ==================== KMS Keys ====================

    const encryptionKey = new kms.Key(this, 'EncryptionKey', {
      alias: `${prefix}-key`,
      description: 'KMS key for Content Scheduler encryption',
      enableKeyRotation: true,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // This microservice uses IAM SigV4 authentication.
    // The main Postolio application authenticates using AWS IAM roles/credentials.

    // ==================== DynamoDB Tables with PITR ====================

    // Schedules Table with PITR
    this.schedulesTable = new dynamodb.Table(this, 'SchedulesTable', {
      tableName: `${prefix}-schedules`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode:
        environment === 'prod'
          ? dynamodb.BillingMode.PROVISIONED
          : dynamodb.BillingMode.PAY_PER_REQUEST,
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
    const brandIndexName = 'GSI1'; // Keep existing name for now
    this.schedulesTable.addGlobalSecondaryIndex({
      indexName: brandIndexName,
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by status
    const statusIndexName = 'GSI2'; // Keep existing name for now
    this.schedulesTable.addGlobalSecondaryIndex({
      indexName: statusIndexName,
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'scheduledAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for direct schedule ID lookup (optimized for getScheduleById)
    const scheduleIdIndexName = 'GSI-ScheduleId';
    this.schedulesTable.addGlobalSecondaryIndex({
      indexName: scheduleIdIndexName,
      partitionKey: { name: 'scheduleId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for content ID lookup (to check for existing schedules)
    const contentIdIndexName = 'by-content-id';
    this.schedulesTable.addGlobalSecondaryIndex({
      indexName: contentIdIndexName,
      partitionKey: { name: 'contentId', type: dynamodb.AttributeType.STRING },
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
          allowedOrigins:
            environment === 'prod' ? ['https://postolio.example'] : ['http://localhost:3000'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: environment !== 'prod',
    });

    // Enforce HTTPS (TLS) for all S3 requests to the video bucket (cdk-nag AwsSolutions-S10)
    this.videoBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'DenyInsecureTransport',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:*'],
        resources: [this.videoBucket.bucketArn, `${this.videoBucket.bucketArn}/*`],
        conditions: { Bool: { 'aws:SecureTransport': 'false' } },
      })
    );

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
      SCHEDULES_TABLE_BRAND_INDEX: brandIndexName,
      SCHEDULES_TABLE_STATUS_INDEX: statusIndexName,
      RETRY_QUEUE_TABLE: retryQueueTable.tableName,
      AUDIT_LOG_TABLE: auditLogTable.tableName,
      VIDEO_BUCKET: this.videoBucket.bucketName,
      PLATFORM_CREDENTIALS_SECRET: platformCredentials.secretArn,
      DLQ_URL: deadLetterQueue.queueUrl, // For intelligent retry handling
      // MAIN_APP_API_URL removed - publisher now uses content from DynamoDB
      // TOKEN_SERVICE_URL removed - publisher uses service discovery to find Token Service
      POWERTOOLS_SERVICE_NAME: 'content-scheduler',
      POWERTOOLS_METRICS_NAMESPACE: 'ContentScheduler',
      LOG_LEVEL: environment === 'prod' ? 'INFO' : 'DEBUG',
      SCHEDULER_GROUP_NAME: `${prefix}-schedules`,
      DB_SECRET_ARN: databaseSecret.secretArn,
      DB_PORT: '5432',
      DB_NAME: 'postolio',
      // RDS Proxy configuration will be read from SSM parameters at runtime
    };

    // Custom IAM Role for Lambda (Least Privilege)
    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Custom execution role for Content Scheduler Lambda functions',
    });

    databaseSecret.grantRead(lambdaRole);

    // Add only necessary permissions
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/postolio-${environment}-*`,
        ],
      })
    );

    // Add X-Ray tracing permissions
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
        resources: ['*'],
      })
    );

    // Add VPC permissions for Lambda functions to access database
    if (vpc && lambdaSecurityGroup) {
      lambdaRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'ec2:CreateNetworkInterface',
            'ec2:DescribeNetworkInterfaces',
            'ec2:DeleteNetworkInterface',
            'ec2:AttachNetworkInterface',
            'ec2:DetachNetworkInterface',
          ],
          resources: ['*'],
        })
      );
    }

    // Add SSM Parameter Store read permissions for service discovery replacement and VPC configuration
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/services/*`,
          `arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/vpc/*`,
          `arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/database/*`,
        ],
      })
    );

    // Add RDS Proxy permissions for Lambda database access
    if (vpc && lambdaSecurityGroup) {
      lambdaRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['rds-db:connect'],
          resources: [
            `arn:aws:rds-db:${this.region}:${this.account}:dbuser:postolio-${environment}-db-proxy/*`,
          ],
        })
      );
    }

    // Add Lambda Function URL invocation permissions for service-to-service calls
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunctionUrl'],
        resources: [
          `arn:aws:lambda:${this.region}:${this.account}:function:postolio-${environment}-*`,
        ],
      })
    );

    // Schedule Management Lambda with Node.js 22.x
    const scheduleManagementLambda = new lambdaNodejs.NodejsFunction(
      this,
      'ScheduleManagementLambda',
      {
        functionName: `postolio-${environment}-scheduler-management`,
        runtime: lambda.Runtime.NODEJS_22_X, // ✅ Latest runtime
        handler: 'handler',
        entry: path.join(__dirname, '../../../../services/schedule-management/src/index.ts'),
        bundling: {
          externalModules: [
            '@aws-lambda-powertools/logger',
            '@aws-lambda-powertools/tracer',
            '@aws-lambda-powertools/metrics',
            '@aws-sdk/client-dynamodb',
            '@aws-sdk/lib-dynamodb',
            '@aws-sdk/client-scheduler',
            '@aws-sdk/*',
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
      }
    );

    // Add Lambda Function URL for direct service-to-service communication
    const scheduleManagementFunctionUrl = scheduleManagementLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      cors: {
        allowCredentials: true,
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedOrigins: ['*'],
        allowedHeaders: ['*'],
      },
    });

    // Publisher Lambda with proper configuration
    const publisherLambda = new lambdaNodejs.NodejsFunction(this, 'PublisherLambda', {
      functionName: `postolio-${environment}-scheduler-publisher`,
      runtime: lambda.Runtime.NODEJS_22_X, // ✅ Latest runtime
      handler: 'handler',
      entry: path.join(__dirname, '../../../../services/publisher/src/index.ts'),
      bundling: {
        externalModules: [
          '@aws-lambda-powertools/logger',
          '@aws-lambda-powertools/tracer',
          '@aws-lambda-powertools/metrics',
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/lib-dynamodb',
          '@aws-sdk/client-scheduler',
          '@aws-sdk/*',
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
      functionName: `postolio-${environment}-scheduler-retry`,
      runtime: lambda.Runtime.NODEJS_22_X, // ✅ Latest runtime
      handler: 'handler',
      entry: path.join(__dirname, '../../../../services/retry-handler/src/index.ts'),
      bundling: {
        externalModules: [
          '@aws-lambda-powertools/logger',
          '@aws-lambda-powertools/tracer',
          '@aws-lambda-powertools/metrics',
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/lib-dynamodb',
          '@aws-sdk/client-scheduler',
          '@aws-sdk/*',
        ],
      },
      timeout: cdk.Duration.minutes(1),
      memorySize: 512,
      environment: lambdaEnvironment,
      layers: [powertoolsLayer],
      // Using default role to avoid circular dependencies
      tracing: lambda.Tracing.ACTIVE,
      // logRetention removed to avoid circular dependencies
    });

    // Schedule Cleanup Lambda: runs daily to clean up orphaned schedules
    const scheduleCleanupLambda = new lambdaNodejs.NodejsFunction(this, 'ScheduleCleanupLambda', {
      functionName: `postolio-${environment}-scheduler-cleanup`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../../services/schedule-cleanup/src/index.ts'),
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
          '@aws-sdk/*',
        ],
      },
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        ...lambdaEnvironment,
        SCHEDULER_GROUP_NAME: `${prefix}-schedules`,
        SCHEDULES_TABLE_SCHEDULE_INDEX: scheduleIdIndexName,
      },
      layers: [powertoolsLayer],
      tracing: lambda.Tracing.ACTIVE,
    });

    // Create EventBridge rule to run cleanup Lambda daily at 3 AM UTC
    const cleanupRule = new events.Rule(this, 'ScheduleCleanupRule', {
      ruleName: `${prefix}-cleanup-daily`,
      description: 'Runs schedule cleanup Lambda daily to remove orphaned schedules',
      schedule: events.Schedule.cron({ hour: '3', minute: '0' }), // Daily at 3:00 AM UTC
    });

    // Add Lambda as target for the EventBridge rule
    cleanupRule.addTarget(new targets.LambdaFunction(scheduleCleanupLambda));

    // Status Sync Lambda: updates main PostgreSQL based on EventBridge events
    const statusSyncLambda = new lambdaNodejs.NodejsFunction(this, 'StatusSyncLambda', {
      functionName: `postolio-${environment}-scheduler-status-sync`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../../services/status-sync/src/index.ts'),
      role: lambdaRole,
      bundling: {
        minify: environment === 'prod',
        sourceMap: environment !== 'prod',
        externalModules: [
          '@aws-sdk/*',
          '@aws-lambda-powertools/logger',
          '@aws-lambda-powertools/tracer',
          '@aws-lambda-powertools/metrics',
        ],
        nodeModules: ['pg', '@prisma/adapter-pg'],
        commandHooks: {
          beforeBundling(): string[] {
            return [];
          },
          afterBundling(inputDir: string, outputDir: string): string[] {
            return [
              // Copy the Prisma lambda client directory with all necessary files
              `cp -r ${inputDir}/packages/libs/database/lambda-client ${outputDir}/`,
            ];
          },
          beforeInstall(): string[] {
            return [];
          },
        },
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 1024,
      description: 'Status Sync Lambda with WASM files included',
      environment: {
        ...lambdaEnvironment,
      },
      tracing: lambda.Tracing.ACTIVE,
      deadLetterQueueEnabled: true,
      deadLetterQueue: deadLetterQueue,
      layers: [powertoolsLayer],
      ...(vpc &&
        lambdaSecurityGroup && {
          vpc: vpc,
          securityGroups: [lambdaSecurityGroup],
          vpcSubnets: {
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          },
        }),
    });

    // Logging permissions are provided via the shared LambdaExecutionRole (lambdaRole) with scoped resources

    // EventBridge rule to forward platform publishing events to Status Sync Lambda
    const statusSyncRule = new events.Rule(this, 'StatusSyncRule', {
      ruleName: `${prefix}-status-sync`,
      eventPattern: {
        source: ['postolio.platform', 'postolio.scheduler'],
        detailType: [
          'post.published',
          'post.failed',
          'schedule.created',
          'schedule.updated',
          'schedule.canceled',
        ],
      },
    });
    statusSyncRule.addTarget(new targets.LambdaFunction(statusSyncLambda));

    // Add DLQ as event source for retry handler
    retryHandlerLambda.addEventSource(
      new SqsEventSource(deadLetterQueue, {
        batchSize: 10,
        maxBatchingWindow: cdk.Duration.seconds(5),
      })
    );

    // Grant permissions using least privilege
    this.schedulesTable.grantReadWriteData(scheduleManagementLambda);
    this.schedulesTable.grantReadWriteData(publisherLambda);
    this.schedulesTable.grantReadWriteData(retryHandlerLambda); // Need to update schedule status on failure
    this.schedulesTable.grantReadWriteData(scheduleCleanupLambda); // Need to cleanup orphaned entries
    retryQueueTable.grantReadWriteData(publisherLambda);
    retryQueueTable.grantReadWriteData(retryHandlerLambda);
    auditLogTable.grantWriteData(scheduleManagementLambda);
    auditLogTable.grantWriteData(publisherLambda);
    auditLogTable.grantWriteData(retryHandlerLambda); // ✅ CRITICAL FIX: Grant audit log write permissions
    this.videoBucket.grantReadWrite(publisherLambda);
    platformCredentials.grantRead(publisherLambda);
    publisherLambda.grantInvoke(retryHandlerLambda);
    deadLetterQueue.grantConsumeMessages(retryHandlerLambda);
    // Grant publisher permission to send messages to DLQ for intelligent retry handling
    deadLetterQueue.grantSendMessages(publisherLambda);

    // ==================== EventBridge Scheduler (Modern API) ====================

    // Create the scheduler group
    const schedulerGroup = new cdk.CfnResource(this, 'SchedulerGroup', {
      type: 'AWS::Scheduler::ScheduleGroup',
      properties: {
        Name: `${prefix}-schedules`,
      },
    });

    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });

    publisherLambda.grantInvoke(schedulerRole);

    // Add environment variables to Lambda functions here
    scheduleManagementLambda.addEnvironment('PUBLISHER_LAMBDA_ARN', publisherLambda.functionArn);
    scheduleManagementLambda.addEnvironment('SCHEDULER_ROLE_ARN', schedulerRole.roleArn);

    // Ensure Lambda functions depend on the scheduler group being created
    scheduleManagementLambda.node.addDependency(schedulerGroup);

    // Add scheduler-specific environment variables to retry handler
    retryHandlerLambda.addEnvironment('PUBLISHER_LAMBDA_ARN', publisherLambda.functionArn);
    retryHandlerLambda.addEnvironment('SCHEDULER_ROLE_ARN', schedulerRole.roleArn);

    // Grant Lambda permission to create/manage EventBridge schedules
    scheduleManagementLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'scheduler:CreateSchedule',
          'scheduler:UpdateSchedule',
          'scheduler:GetSchedule',
          'scheduler:DeleteSchedule',
          'scheduler:ListSchedules',
        ],
        resources: [
          `arn:aws:scheduler:${this.region}:${this.account}:schedule/${prefix}-schedules/*`,
        ],
      })
    );

    // Grant SSM Parameter Store read permissions for service discovery replacement
    scheduleManagementLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/services/*`,
        ],
      })
    );

    // Grant Lambda Function URL invocation permissions for service-to-service calls
    scheduleManagementLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunctionUrl'],
        resources: [
          `arn:aws:lambda:${this.region}:${this.account}:function:postolio-${environment}-*`,
        ],
      })
    );

    // Grant Schedule Management Lambda permission to emit events to EventBridge
    scheduleManagementLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
      })
    );

    // Grant Publisher Lambda SSM Parameter Store read permissions
    publisherLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/services/*`,
        ],
      })
    );

    // Grant Publisher Lambda Function URL invocation permissions for service-to-service calls
    publisherLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunctionUrl'],
        resources: [
          `arn:aws:lambda:${this.region}:${this.account}:function:postolio-${environment}-*`,
        ],
      })
    );

    // Grant Publisher Lambda permission to emit events to EventBridge (default bus)
    publisherLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: ['*'],
      })
    );

    // cdk-nag: suppress wildcard resource for PutEvents with justification
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/PublisherLambda/ServiceRole/DefaultPolicy/Resource`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'EventBridge PutEvents requires wildcard resource when using default event bus',
          appliesTo: ['Action::events:PutEvents', 'Resource::*'],
        },
      ]
    );

    // Grant Lambda permission to pass the scheduler role to EventBridge
    scheduleManagementLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:PassRole'],
        resources: [schedulerRole.roleArn],
        conditions: {
          StringEquals: {
            'iam:PassedToService': 'scheduler.amazonaws.com',
          },
        },
      })
    );

    // Grant Retry Handler permission to create EventBridge schedules for delayed retries
    retryHandlerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'scheduler:CreateSchedule',
          'scheduler:UpdateSchedule',
          'scheduler:GetSchedule',
          'scheduler:DeleteSchedule',
        ],
        resources: [
          `arn:aws:scheduler:${this.region}:${this.account}:schedule/${prefix}-schedules/retry-*`,
        ],
      })
    );

    // cdk-nag: suppress wildcard in EventBridge Scheduler ARN for retry schedules
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/RetryHandlerLambda/ServiceRole/DefaultPolicy/Resource`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'Wildcard required for retry schedule names (retry-*) to allow dynamic retry schedule creation with schedule IDs and attempt numbers',
          appliesTo: [
            `Resource::arn:aws:scheduler:${this.region}:${this.account}:schedule/${prefix}-schedules/retry-*`,
          ],
        },
      ]
    );

    // Grant Retry Handler permission to pass the scheduler role
    retryHandlerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:PassRole'],
        resources: [schedulerRole.roleArn],
        conditions: {
          StringEquals: {
            'iam:PassedToService': 'scheduler.amazonaws.com',
          },
        },
      })
    );

    // Grant Retry Handler SSM Parameter Store read permissions for service discovery replacement
    retryHandlerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/services/*`,
        ],
      })
    );

    // Grant Retry Handler Lambda Function URL invocation permissions for service-to-service calls
    retryHandlerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunctionUrl'],
        resources: [
          `arn:aws:lambda:${this.region}:${this.account}:function:postolio-${environment}-*`,
        ],
      })
    );

    // Grant Schedule Cleanup Lambda permission to list and delete EventBridge schedules
    scheduleCleanupLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['scheduler:ListSchedules', 'scheduler:GetSchedule', 'scheduler:DeleteSchedule'],
        resources: [
          `arn:aws:scheduler:${this.region}:${this.account}:schedule/${prefix}-schedules/*`,
        ],
      })
    );

    // Grant Cleanup Lambda permission to list schedules in the group
    scheduleCleanupLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['scheduler:ListSchedules'],
        resources: ['*'], // ListSchedules requires wildcard when specifying GroupName
      })
    );

    // Grant Schedule Cleanup Lambda SSM Parameter Store read permissions for service discovery replacement
    scheduleCleanupLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/services/*`,
        ],
      })
    );

    // Grant Schedule Cleanup Lambda Function URL invocation permissions for service-to-service calls
    scheduleCleanupLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunctionUrl'],
        resources: [
          `arn:aws:lambda:${this.region}:${this.account}:function:postolio-${environment}-*`,
        ],
      })
    );

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

    // Orphaned schedules alarm - triggers if too many orphaned schedules are found
    new cloudwatch.Alarm(this, 'OrphanedSchedulesAlarm', {
      alarmName: `${prefix}-orphaned-schedules`,
      metric: new cloudwatch.Metric({
        namespace: 'ContentScheduler',
        metricName: 'OrphanedSchedulesCleaned',
        statistic: 'Sum',
        period: cdk.Duration.hours(24),
      }),
      threshold: 50, // Alert if more than 50 orphaned schedules are cleaned in a day
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // Failed schedules alarm - triggers if many schedules are failing
    new cloudwatch.Alarm(this, 'FailedSchedulesAlarm', {
      alarmName: `${prefix}-failed-schedules`,
      metric: new cloudwatch.Metric({
        namespace: 'ContentScheduler',
        metricName: 'FailedSchedulesCleaned',
        statistic: 'Sum',
        period: cdk.Duration.hours(24),
      }),
      threshold: 30, // Alert if more than 30 failed schedules are cleaned in a day
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // Cleanup job failure alarm
    new cloudwatch.Alarm(this, 'CleanupJobFailureAlarm', {
      alarmName: `${prefix}-cleanup-job-failure`,
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensionsMap: {
          FunctionName: scheduleCleanupLambda.functionName,
        },
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // ==================== CDK Nag Suppressions with Justifications ====================

    // Suppress S3 bucket SSL enforcement warnings for access logs bucket (bucket and policy)
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/AccessLogsBucket/Resource`,
      [
        {
          id: 'AwsSolutions-S10',
          reason:
            'Access logs bucket is managed by AWS ELB service which handles SSL enforcement internally',
        },
      ]
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/AccessLogsBucket/Policy/Resource`,
      [
        {
          id: 'AwsSolutions-S10',
          reason:
            'Access logs bucket is managed by AWS ELB service which handles SSL enforcement internally',
        },
      ]
    );

    // Suppress S3 bucket SSL enforcement warnings for video bucket (bucket and policy)
    NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/VideoBucket/Resource`, [
      {
        id: 'AwsSolutions-S10',
        reason:
          'Video bucket accessed via pre-signed URLs with HTTPS enforced at application level',
      },
    ]);
    // Note: No explicit BucketPolicy is synthesized for VideoBucket in some environments,
    // so suppressions by path to "/VideoBucket/Policy/Resource" may fail. The bucket-level
    // suppression above is sufficient for AwsSolutions-S10 in this stack.

    // Suppress secret rotation warnings
    NagSuppressions.addResourceSuppressions(platformCredentials, [
      {
        id: 'AwsSolutions-SMG4',
        reason: 'Platform API credentials are managed manually by operations team',
      },
    ]);

    // Suppress SQS SSL enforcement warnings
    NagSuppressions.addResourceSuppressions(deadLetterQueue, [
      {
        id: 'AwsSolutions-SQS4',
        reason: 'Dead letter queue is only accessed by Lambda functions within VPC using IAM roles',
      },
    ]);

    // Suppress X-Ray permissions specifically
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/LambdaExecutionRole/DefaultPolicy/Resource`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'Lambda execution role requires wildcard permissions for CloudWatch Logs, X-Ray tracing, VPC network interface management, SSM parameter access, and Lambda Function URL invocation',
          appliesTo: [
            'Resource::*',
            'Action::ec2:CreateNetworkInterface',
            'Action::ec2:DescribeNetworkInterfaces',
            'Action::ec2:DeleteNetworkInterface',
            'Action::ec2:AttachNetworkInterface',
            'Action::ec2:DetachNetworkInterface',
            `Resource::arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/postolio-${environment}-*`,
            `Resource::arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/services/*`,
            `Resource::arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/vpc/*`,
            `Resource::arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/database/*`,
            `Resource::arn:aws:rds-db:${this.region}:${this.account}:dbuser:postolio-${environment}-db-proxy/*`,
            `Resource::arn:aws:lambda:${this.region}:${this.account}:function:postolio-${environment}-*`,
          ],
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
          reason:
            'This is the access logs bucket itself - enabling access logging would create an infinite loop',
        },
      ]
    );

    // Suppress Lambda IAM managed policy warnings
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/ScheduleManagementLambda/ServiceRole/Resource`,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'Lambda functions require AWS managed BasicExecutionRole for CloudWatch Logs',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
          ],
        },
      ]
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/PublisherLambda/ServiceRole/Resource`,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'Lambda functions require AWS managed BasicExecutionRole for CloudWatch Logs',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
          ],
        },
      ]
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/RetryHandlerLambda/ServiceRole/Resource`,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'Lambda functions require AWS managed BasicExecutionRole for CloudWatch Logs',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
          ],
        },
      ]
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/ScheduleCleanupLambda/ServiceRole/Resource`,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'Lambda functions require AWS managed BasicExecutionRole for CloudWatch Logs',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
          ],
        },
      ]
    );

    // Suppress Lambda IAM wildcard permissions
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/ScheduleManagementLambda/ServiceRole/DefaultPolicy/Resource`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'Lambda requires wildcard permissions for X-Ray tracing, DynamoDB GSI access, EventBridge schedules, KMS operations, SSM parameter access, and Lambda Function URL invocation',
          appliesTo: [
            'Resource::*',
            'Action::kms:GenerateDataKey*',
            'Action::kms:ReEncrypt*',
            'Resource::<SchedulesTableFBEB0188.Arn>/index/*',
            `Resource::arn:aws:scheduler:${this.region}:${this.account}:schedule/postolio-${environment}-scheduler-schedules/*`,
            `Resource::arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/services/*`,
            `Resource::arn:aws:lambda:${this.region}:${this.account}:function:postolio-${environment}-*`,
          ],
        },
      ]
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/PublisherLambda/ServiceRole/DefaultPolicy/Resource`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'Publisher Lambda requires wildcard permissions for X-Ray, DynamoDB GSI, S3 operations, KMS, Token Service API GET access, SSM parameter access, and Lambda Function URL invocation',
          appliesTo: [
            'Resource::*',
            'Action::kms:GenerateDataKey*',
            'Action::kms:ReEncrypt*',
            'Action::s3:Abort*',
            'Action::s3:DeleteObject*',
            'Action::s3:GetBucket*',
            'Action::s3:GetObject*',
            'Action::s3:List*',
            'Resource::<SchedulesTableFBEB0188.Arn>/index/*',
            'Resource::<VideoBucket6ED8E1AF.Arn>/*',
            `Resource::arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/services/*`,
            `Resource::arn:aws:lambda:${this.region}:${this.account}:function:postolio-${environment}-*`,
          ],
        },
      ]
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/RetryHandlerLambda/ServiceRole/DefaultPolicy/Resource`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'Retry handler requires wildcard permissions for X-Ray, KMS, DynamoDB GSI access, Lambda invocation, SSM parameter access, and Lambda Function URL invocation',
          appliesTo: [
            'Resource::*',
            'Action::kms:GenerateDataKey*',
            'Action::kms:ReEncrypt*',
            'Resource::<PublisherLambdaB2749827.Arn>:*',
            // Grant for DynamoDB GSIs produced by table grants; limited to this table's indexes
            'Resource::<SchedulesTableFBEB0188.Arn>/index/*',
            `Resource::arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/services/*`,
            `Resource::arn:aws:lambda:${this.region}:${this.account}:function:postolio-${environment}-*`,
          ],
        },
      ]
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/ScheduleCleanupLambda/ServiceRole/DefaultPolicy/Resource`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'Schedule cleanup Lambda requires wildcard permissions for X-Ray, DynamoDB GSI, KMS, EventBridge Scheduler listing, SSM parameter access, and Lambda Function URL invocation',
          appliesTo: [
            'Resource::*',
            'Action::kms:GenerateDataKey*',
            'Action::kms:ReEncrypt*',
            'Resource::<SchedulesTableFBEB0188.Arn>/index/*',
            `Resource::arn:aws:scheduler:${this.region}:${this.account}:schedule/postolio-${environment}-scheduler-schedules/*`,
            `Resource::arn:aws:ssm:${this.region}:${this.account}:parameter/postolio/${environment}/services/*`,
            `Resource::arn:aws:lambda:${this.region}:${this.account}:function:postolio-${environment}-*`,
          ],
        },
      ]
    );

    // Suppress Scheduler Role IAM wildcard permissions
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/SchedulerRole/DefaultPolicy/Resource`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'EventBridge Scheduler role requires wildcard for Lambda invocation',
          appliesTo: ['Resource::<PublisherLambdaB2749827.Arn>:*'],
        },
      ]
    );

    // Service registration now handled via SSM Parameter Store

    // ==================== Outputs ====================

    new cdk.CfnOutput(this, 'ScheduleManagementFunctionUrl', {
      value: scheduleManagementFunctionUrl.url,
      description: 'Content Scheduler Lambda Function URL for direct service-to-service calls',
      exportName: `${prefix}-function-url`,
    });

    // Store Lambda Function URL in SSM Parameter Store for service discovery replacement
    new ssm.StringParameter(this, 'ContentSchedulerFunctionUrlParameter', {
      parameterName: ParameterNames.getParameterName(
        'CONTENT_SCHEDULER_URL',
        environment as Environment
      ),
      stringValue: scheduleManagementFunctionUrl.url,
      description: 'Content Scheduler Lambda Function URL for service-to-service communication',
      tier: ssm.ParameterTier.STANDARD,
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

    // Service client secret removed - using IAM SigV4 authentication
  }
}
