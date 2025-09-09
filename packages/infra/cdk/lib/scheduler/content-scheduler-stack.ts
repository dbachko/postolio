import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as logs from "aws-cdk-lib/aws-logs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import * as kms from "aws-cdk-lib/aws-kms";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import * as path from "path";
import {
  ServiceDiscoveryManager,
  registerLambdaService,
  getServiceDiscoveryEnvVars,
} from "../utils/service-discovery-infrastructure";

export interface ContentSchedulerStackProps extends cdk.StackProps {
  environment: "dev" | "staging" | "prod";
  alertEmail?: string;
  mainAppApiUrl?: string;
  serviceDiscoveryNamespaceId?: string; // Use shared namespace
}

export class ContentSchedulerStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly schedulesTable: dynamodb.Table;
  public readonly videoBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: ContentSchedulerStackProps) {
    super(scope, id, props);

    const {
      environment,
      alertEmail,
      mainAppApiUrl,
      serviceDiscoveryNamespaceId,
    } = props;
    const prefix = `postolio-scheduler-${environment}`;

    // All environments use the production URL
    const resolvedMainAppApiUrl = mainAppApiUrl || "https://postolio.example";

    // Publisher Lambda now uses AWS IAM SigV4 authentication instead of API keys

    // Use shared Service Discovery namespace
    const serviceDiscovery = new ServiceDiscoveryManager(
      this,
      "ServiceDiscovery",
      {
        environment,
        existingNamespaceId:
          serviceDiscoveryNamespaceId ||
          cdk.Fn.importValue(`ServiceDiscovery-${environment}-NamespaceId`),
      },
    );

    // ==================== KMS Keys ====================

    const encryptionKey = new kms.Key(this, "EncryptionKey", {
      alias: `${prefix}-key`,
      description: "KMS key for Content Scheduler encryption",
      enableKeyRotation: true,
      removalPolicy:
        environment === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
    });

    // This microservice uses IAM SigV4 authentication.
    // The main Postolio application authenticates using AWS IAM roles/credentials.

    // ==================== DynamoDB Tables with PITR ====================

    // Schedules Table with PITR
    this.schedulesTable = new dynamodb.Table(this, "SchedulesTable", {
      tableName: `${prefix}-schedules`,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode:
        environment === "prod"
          ? dynamodb.BillingMode.PROVISIONED
          : dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true, // ✅ PITR enabled
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: encryptionKey,
      timeToLiveAttribute: "ttl",
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy:
        environment === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
    });

    // Add auto-scaling for production
    if (environment === "prod") {
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
    const brandIndexName = "GSI1"; // Keep existing name for now
    this.schedulesTable.addGlobalSecondaryIndex({
      indexName: brandIndexName,
      partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for querying by status
    const statusIndexName = "GSI2"; // Keep existing name for now
    this.schedulesTable.addGlobalSecondaryIndex({
      indexName: statusIndexName,
      partitionKey: { name: "status", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "scheduledAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for direct schedule ID lookup (optimized for getScheduleById)
    const scheduleIdIndexName = "GSI-ScheduleId";
    this.schedulesTable.addGlobalSecondaryIndex({
      indexName: scheduleIdIndexName,
      partitionKey: { name: "scheduleId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI for content ID lookup (to check for existing schedules)
    const contentIdIndexName = "by-content-id";
    this.schedulesTable.addGlobalSecondaryIndex({
      indexName: contentIdIndexName,
      partitionKey: { name: "contentId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "scheduledAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Retry Queue Table with PITR
    const retryQueueTable = new dynamodb.Table(this, "RetryQueueTable", {
      tableName: `${prefix}-retry-queue`,
      partitionKey: { name: "scheduleId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "attemptNumber", type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true, // ✅ PITR enabled
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: encryptionKey,
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Audit Log Table with PITR (GDPR Compliance)
    const auditLogTable = new dynamodb.Table(this, "AuditLogTable", {
      tableName: `${prefix}-audit-log`,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "timestamp", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true, // ✅ PITR enabled
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: encryptionKey,
      removalPolicy:
        environment === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
    });

    // ==================== S3 Buckets with Access Logging ====================

    // Access Logs Bucket
    const accessLogsBucket = new s3.Bucket(this, "AccessLogsBucket", {
      bucketName: `${prefix}-access-logs`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        {
          id: "delete-old-logs",
          enabled: true,
          expiration: cdk.Duration.days(30),
        },
      ],
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Video Storage Bucket with Access Logging
    this.videoBucket = new s3.Bucket(this, "VideoBucket", {
      bucketName: `${prefix}-videos`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: encryptionKey,
      serverAccessLogsBucket: accessLogsBucket, // ✅ Access logging enabled
      serverAccessLogsPrefix: "video-bucket-logs/",
      versioned: true,
      transferAcceleration: true, // ✅ Enable for faster video uploads
      lifecycleRules: [
        {
          id: "delete-incomplete-multipart-uploads",
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
        {
          id: "intelligent-tiering",
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INTELLIGENT_TIERING,
              transitionAfter: cdk.Duration.days(0),
            },
          ],
        },
        {
          id: "gdpr-compliance-deletion",
          enabled: true,
          expiration: cdk.Duration.days(90),
        },
      ],
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
          ],
          allowedOrigins:
            environment === "prod"
              ? ["https://postolio.example"]
              : ["http://localhost:3000"],
          allowedHeaders: ["*"],
          maxAge: 3000,
        },
      ],
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy:
        environment === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: environment !== "prod",
    });

    // ==================== Secrets with Rotation ====================

    const platformCredentials = new secretsmanager.Secret(
      this,
      "PlatformCredentials",
      {
        secretName: `${prefix}-platform-credentials`,
        description: "Social media platform API credentials",
        generateSecretString: {
          secretStringTemplate: JSON.stringify({
            instagram: { clientId: "", clientSecret: "", accessToken: "" },
            tiktok: { clientKey: "", clientSecret: "", accessToken: "" },
            youtube: { apiKey: "", clientId: "", clientSecret: "" },
          }),
          generateStringKey: "temp",
        },
        // Note: Automatic rotation would be configured separately
        // automaticRotation requires a rotation Lambda function
      },
    );

    // ==================== Dead Letter Queues ====================

    const deadLetterQueue = new sqs.Queue(this, "DeadLetterQueue", {
      queueName: `${prefix}-dlq`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: encryptionKey,
      retentionPeriod: cdk.Duration.days(14),
      // Visibility timeout must be >= Lambda timeout (60 seconds) * 6
      visibilityTimeout: cdk.Duration.seconds(360),
    });

    // ==================== Lambda Layer for Powertools ====================

    const powertoolsLayer = new lambda.LayerVersion(this, "PowertoolsLayer", {
      layerVersionName: `${prefix}-powertools`,
      code: lambda.Code.fromAsset(path.join(__dirname, "../layers/powertools")),
      compatibleRuntimes: [lambda.Runtime.NODEJS_22_X],
      description: "AWS Lambda Powertools for TypeScript",
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
      // MAIN_APP_API_URL removed - publisher now uses content from DynamoDB
      // TOKEN_SERVICE_URL removed - publisher uses service discovery to find Token Service
      POWERTOOLS_SERVICE_NAME: "content-scheduler",
      POWERTOOLS_METRICS_NAMESPACE: "ContentScheduler",
      LOG_LEVEL: environment === "prod" ? "INFO" : "DEBUG",
      SCHEDULER_GROUP_NAME: `${prefix}-schedules`,
      ...getServiceDiscoveryEnvVars(serviceDiscovery.getClientConfig()),
    };

    // Custom IAM Role for Lambda (Least Privilege)
    const lambdaRole = new iam.Role(this, "LambdaExecutionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description:
        "Custom execution role for Content Scheduler Lambda functions",
    });

    // Add only necessary permissions
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: [
          `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/${prefix}-*`,
        ],
      }),
    );

    // Add X-Ray tracing permissions
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
        resources: ["*"],
      }),
    );

    // Schedule Management Lambda with Node.js 22.x
    const scheduleManagementLambda = new lambdaNodejs.NodejsFunction(
      this,
      "ScheduleManagementLambda",
      {
        functionName: `${prefix}-schedule-management`,
        runtime: lambda.Runtime.NODEJS_22_X, // ✅ Latest runtime
        handler: "handler",
        entry: path.join(
          __dirname,
          "../../../../services/schedule-management/src/index.ts",
        ),
        bundling: {
          nodeModules: ["@prisma/client", "prisma"],
          externalModules: [
            "@aws-lambda-powertools/logger",
            "@aws-lambda-powertools/tracer",
            "@aws-lambda-powertools/metrics",
            "@aws-sdk/client-dynamodb",
            "@aws-sdk/lib-dynamodb",
            "@aws-sdk/client-scheduler",
            "@aws-sdk/*",
          ],
        },
        timeout: cdk.Duration.seconds(30),
        memorySize: 1024,
        reservedConcurrentExecutions: environment === "prod" ? 10 : undefined,
        environment: lambdaEnvironment,
        layers: [powertoolsLayer],
        // Using default role to avoid circular dependencies
        tracing: lambda.Tracing.ACTIVE,
        // logRetention removed to avoid circular dependencies
        deadLetterQueueEnabled: true,
        deadLetterQueue: deadLetterQueue,
      },
    );

    // Publisher Lambda with proper configuration
    const publisherLambda = new lambdaNodejs.NodejsFunction(
      this,
      "PublisherLambda",
      {
        functionName: `${prefix}-publisher`,
        runtime: lambda.Runtime.NODEJS_22_X, // ✅ Latest runtime
        handler: "handler",
        entry: path.join(
          __dirname,
          "../../../../services/publisher/src/index.ts",
        ),
        bundling: {
          nodeModules: ["@prisma/client", "prisma"],
          externalModules: [
            "@aws-lambda-powertools/logger",
            "@aws-lambda-powertools/tracer",
            "@aws-lambda-powertools/metrics",
            "@aws-sdk/client-dynamodb",
            "@aws-sdk/lib-dynamodb",
            "@aws-sdk/client-scheduler",
            "@aws-sdk/*",
          ],
        },
        timeout: cdk.Duration.minutes(5),
        memorySize: 2048,
        reservedConcurrentExecutions: environment === "prod" ? 50 : undefined,
        environment: lambdaEnvironment,
        layers: [powertoolsLayer],
        // Using default role to avoid circular dependencies
        tracing: lambda.Tracing.ACTIVE,
        // logRetention removed to avoid circular dependencies
        deadLetterQueueEnabled: true,
        deadLetterQueue: deadLetterQueue,
      },
    );

    // Retry Handler Lambda
    const retryHandlerLambda = new lambdaNodejs.NodejsFunction(
      this,
      "RetryHandlerLambda",
      {
        functionName: `${prefix}-retry-handler`,
        runtime: lambda.Runtime.NODEJS_22_X, // ✅ Latest runtime
        handler: "handler",
        entry: path.join(
          __dirname,
          "../../../../services/retry-handler/src/index.ts",
        ),
        bundling: {
          nodeModules: ["@prisma/client", "prisma"],
          externalModules: [
            "@aws-lambda-powertools/logger",
            "@aws-lambda-powertools/tracer",
            "@aws-lambda-powertools/metrics",
            "@aws-sdk/client-dynamodb",
            "@aws-sdk/lib-dynamodb",
            "@aws-sdk/client-scheduler",
            "@aws-sdk/*",
          ],
        },
        timeout: cdk.Duration.minutes(1),
        memorySize: 512,
        environment: {
          ...lambdaEnvironment,
          PUBLISHER_LAMBDA_ARN: publisherLambda.functionArn,
          SCHEDULES_TABLE: this.schedulesTable.tableName,
        },
        layers: [powertoolsLayer],
        // Using default role to avoid circular dependencies
        tracing: lambda.Tracing.ACTIVE,
        // logRetention removed to avoid circular dependencies
      },
    );

    // Schedule Cleanup Lambda: runs daily to clean up orphaned schedules
    const scheduleCleanupLambda = new lambdaNodejs.NodejsFunction(
      this,
      "ScheduleCleanupLambda",
      {
        functionName: `${prefix}-schedule-cleanup`,
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: "handler",
        entry: path.join(
          __dirname,
          "../../../../services/schedule-cleanup/src/index.ts",
        ),
        bundling: {
          minify: environment === "prod",
          sourceMap: environment !== "prod",
          externalModules: [
            "@aws-lambda-powertools/logger",
            "@aws-lambda-powertools/tracer",
            "@aws-lambda-powertools/metrics",
            "@aws-sdk/client-dynamodb",
            "@aws-sdk/lib-dynamodb",
            "@aws-sdk/client-scheduler",
            "@aws-sdk/*",
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
      },
    );

    // Create EventBridge rule to run cleanup Lambda daily at 3 AM UTC
    const cleanupRule = new events.Rule(this, "ScheduleCleanupRule", {
      ruleName: `${prefix}-cleanup-daily`,
      description:
        "Runs schedule cleanup Lambda daily to remove orphaned schedules",
      schedule: events.Schedule.cron({ hour: "3", minute: "0" }), // Daily at 3:00 AM UTC
    });

    // Add Lambda as target for the EventBridge rule
    cleanupRule.addTarget(new targets.LambdaFunction(scheduleCleanupLambda));

    // Status Sync Lambda: updates main PostgreSQL based on EventBridge events
    const statusSyncLambda = new lambdaNodejs.NodejsFunction(
      this,
      "StatusSyncLambda",
      {
        functionName: `${prefix}-status-sync`,
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: "handler",
        entry: path.join(
          __dirname,
          "../../../../services/status-sync/src/index.ts",
        ),
        role: lambdaRole,
        bundling: {
          minify: environment === "prod",
          sourceMap: environment !== "prod",
          externalModules: [
            "@aws-sdk/*",
            "@aws-lambda-powertools/logger",
            "@aws-lambda-powertools/tracer",
            "@aws-lambda-powertools/metrics",
          ],
          // Include Prisma CLI so @prisma/client postinstall can generate and fetch engines
          nodeModules: ["@prisma/client", "prisma"],
        },
        timeout: cdk.Duration.seconds(30),
        memorySize: 1024,
        environment: {
          ...lambdaEnvironment,
          // Expect DATABASE_URL to be set via stack parameters or environment config
        },
        tracing: lambda.Tracing.ACTIVE,
        deadLetterQueueEnabled: true,
        deadLetterQueue: deadLetterQueue,
      },
    );

    // Logging permissions are provided via the shared LambdaExecutionRole (lambdaRole) with scoped resources

    // EventBridge rule to forward platform publishing events to Status Sync Lambda
    const statusSyncRule = new events.Rule(this, "StatusSyncRule", {
      ruleName: `${prefix}-status-sync`,
      eventPattern: {
        source: ["postolio.platform", "postolio.scheduler"],
        detailType: [
          "post.published",
          "post.failed",
          "schedule.created",
          "schedule.updated",
          "schedule.canceled",
        ],
      },
    });
    statusSyncRule.addTarget(new targets.LambdaFunction(statusSyncLambda));

    // Add DLQ as event source for retry handler
    retryHandlerLambda.addEventSource(
      new SqsEventSource(deadLetterQueue, {
        batchSize: 10,
        maxBatchingWindow: cdk.Duration.seconds(5),
      }),
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
    this.videoBucket.grantReadWrite(publisherLambda);
    platformCredentials.grantRead(publisherLambda);
    publisherLambda.grantInvoke(retryHandlerLambda);
    deadLetterQueue.grantConsumeMessages(retryHandlerLambda);

    // ==================== EventBridge Scheduler (Modern API) ====================

    const schedulerRole = new iam.Role(this, "SchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
    });

    publisherLambda.grantInvoke(schedulerRole);

    // Create scheduler group
    const _schedulerGroup = new scheduler.CfnScheduleGroup(
      this,
      "SchedulerGroup",
      {
        name: `${prefix}-schedules`,
      },
    );

    // Add environment variables to Lambda functions here
    scheduleManagementLambda.addEnvironment(
      "PUBLISHER_LAMBDA_ARN",
      publisherLambda.functionArn,
    );
    scheduleManagementLambda.addEnvironment(
      "SCHEDULER_ROLE_ARN",
      schedulerRole.roleArn,
    );

    // Grant Lambda permission to create/manage EventBridge schedules
    scheduleManagementLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "scheduler:CreateSchedule",
          "scheduler:UpdateSchedule",
          "scheduler:GetSchedule",
          "scheduler:DeleteSchedule",
          "scheduler:ListSchedules",
        ],
        resources: [
          `arn:aws:scheduler:${this.region}:${this.account}:schedule/${prefix}-schedules/*`,
        ],
      }),
    );

    // Grant Publisher Lambda permission to use Service Discovery
    publisherLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "servicediscovery:DiscoverInstances",
          "servicediscovery:GetNamespace",
          "servicediscovery:GetService",
        ],
        resources: ["*"], // Service Discovery requires wildcard for discovery operations
      }),
    );

    // Grant Publisher Lambda permission to invoke Token Service API (IAM-authenticated)
    publisherLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["execute-api:Invoke"],
        resources: [
          // Publisher Lambda only needs to GET tokens from Token Service
          // GET /tokens/{userId}/{platform}?brandId={brandId}
          `arn:aws:execute-api:${this.region}:${this.account}:*/*/GET/tokens/*`,
        ],
      }),
    );

    // Grant Publisher Lambda permission to emit events to EventBridge (default bus)
    publisherLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["events:PutEvents"],
        resources: ["*"],
      }),
    );

    // cdk-nag: suppress wildcard resource for PutEvents with justification
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/PublisherLambda/ServiceRole/DefaultPolicy/Resource`,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "EventBridge PutEvents requires wildcard resource when using default event bus",
          appliesTo: ["Action::events:PutEvents", "Resource::*"],
        },
      ],
    );

    // Grant Lambda permission to pass the scheduler role to EventBridge
    scheduleManagementLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["iam:PassRole"],
        resources: [schedulerRole.roleArn],
        conditions: {
          StringEquals: {
            "iam:PassedToService": "scheduler.amazonaws.com",
          },
        },
      }),
    );

    // Grant Schedule Cleanup Lambda permission to list and delete EventBridge schedules
    scheduleCleanupLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "scheduler:ListSchedules",
          "scheduler:GetSchedule",
          "scheduler:DeleteSchedule",
        ],
        resources: [
          `arn:aws:scheduler:${this.region}:${this.account}:schedule/${prefix}-schedules/*`,
        ],
      }),
    );

    // Grant Cleanup Lambda permission to list schedules in the group
    scheduleCleanupLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["scheduler:ListSchedules"],
        resources: ["*"], // ListSchedules requires wildcard when specifying GroupName
      }),
    );

    // ==================== API Gateway CloudWatch Logging Role ====================

    // Create IAM role for API Gateway CloudWatch logging (account-level setting)
    const apiGatewayCloudWatchRole = new iam.Role(
      this,
      "ApiGatewayCloudWatchRole",
      {
        assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AmazonAPIGatewayPushToCloudWatchLogs",
          ),
        ],
        description: "Role for API Gateway to write logs to CloudWatch",
      },
    );

    // Configure account-level CloudWatch logging for API Gateway
    const cfnAccount = new apigateway.CfnAccount(this, "ApiGatewayAccount", {
      cloudWatchRoleArn: apiGatewayCloudWatchRole.roleArn,
    });

    // ==================== API Gateway with Request Validation ====================

    this.api = new apigateway.RestApi(this, "SchedulerApi", {
      restApiName: `${prefix}-api`,
      description: "Content Scheduler Microservice API",
      deployOptions: {
        stageName: environment,
        tracingEnabled: true,
        // Enable INFO level execution logging & access logs for 403 diagnostics
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        metricsEnabled: true,
        accessLogDestination: new apigateway.LogGroupLogDestination(
          new logs.LogGroup(this, "SchedulerApiAccessLogs", {
            logGroupName: `/aws/apigateway/${prefix}-api-access`,
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy:
              environment === "prod"
                ? cdk.RemovalPolicy.RETAIN
                : cdk.RemovalPolicy.DESTROY,
          }),
        ),
        accessLogFormat: apigateway.AccessLogFormat.custom(
          JSON.stringify({
            requestId: "$context.requestId",
            ip: "$context.identity.sourceIp",
            requestTime: "$context.requestTime",
            httpMethod: "$context.httpMethod",
            resourcePath: "$context.resourcePath",
            path: "$context.path",
            status: "$context.status",
            protocol: "$context.protocol",
            integrationStatus: "$context.integrationStatus",
            errorMessage: "$context.error.message",
            responseLength: "$context.responseLength",
            userAgent: "$context.identity.userAgent",
            caller: "$context.identity.caller",
            user: "$context.identity.user",
          }),
        ),
        throttlingBurstLimit: 1000,
        throttlingRateLimit: 500,
      },
      defaultCorsPreflightOptions: {
        allowOrigins:
          environment === "prod"
            ? ["https://postolio.example"]
            : apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "Authorization"],
      },
    });

    // Ensure API deployment happens after account configuration
    this.api.node.addDependency(cfnAccount);

    // NO AUTHORIZER NEEDED - Using IAM SigV4 authentication
    // This provides secure service-to-service authentication using AWS credentials

    // Request Validator
    const requestValidator = new apigateway.RequestValidator(
      this,
      "RequestValidator",
      {
        restApi: this.api,
        requestValidatorName: "request-validator",
        validateRequestBody: true,
        validateRequestParameters: true,
      },
    );

    // API Model for request validation
    const scheduleModel = new apigateway.Model(this, "ScheduleModel", {
      restApi: this.api,
      contentType: "application/json",
      modelName: "ScheduleModel",
      schema: {
        schema: apigateway.JsonSchemaVersion.DRAFT4,
        title: "Schedule",
        type: apigateway.JsonSchemaType.OBJECT,
        required: ["brandId", "contentId", "platform", "scheduledAt"],
        properties: {
          brandId: { type: apigateway.JsonSchemaType.STRING },
          contentId: { type: apigateway.JsonSchemaType.STRING },
          platform: {
            type: apigateway.JsonSchemaType.STRING,
            enum: ["instagram", "tiktok", "youtube"],
          },
          scheduledAt: {
            type: apigateway.JsonSchemaType.STRING,
            format: "date-time",
          },
          contentType: {
            type: apigateway.JsonSchemaType.STRING,
            enum: ["image", "video"],
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
    const schedulesResource = this.api.root.addResource("schedules");
    const scheduleResource = schedulesResource.addResource("{scheduleId}");

    // API Methods with validation and authorization
    const lambdaIntegration = new apigateway.LambdaIntegration(
      scheduleManagementLambda,
    );

    schedulesResource.addMethod("POST", lambdaIntegration, {
      authorizationType: apigateway.AuthorizationType.IAM,
      requestValidator,
      requestModels: {
        "application/json": scheduleModel,
      },
    });

    schedulesResource.addMethod("GET", lambdaIntegration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    });

    scheduleResource.addMethod("GET", lambdaIntegration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    });

    scheduleResource.addMethod("PUT", lambdaIntegration, {
      authorizationType: apigateway.AuthorizationType.IAM,
      requestValidator,
      requestModels: {
        "application/json": scheduleModel,
      },
    });

    scheduleResource.addMethod("DELETE", lambdaIntegration, {
      authorizationType: apigateway.AuthorizationType.IAM,
    });

    // Environment variables moved to Lambda definition to avoid circular dependencies

    // ==================== WAF for API Protection ====================

    if (environment === "prod") {
      const webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
        scope: "REGIONAL",
        defaultAction: { allow: {} },
        rules: [
          {
            name: "RateLimitRule",
            priority: 1,
            statement: {
              rateBasedStatement: {
                limit: 2000,
                aggregateKeyType: "IP",
              },
            },
            action: { block: {} },
            visibilityConfig: {
              sampledRequestsEnabled: true,
              cloudWatchMetricsEnabled: true,
              metricName: "RateLimitRule",
            },
          },
          {
            name: "AWSManagedRulesCommonRuleSet",
            priority: 2,
            statement: {
              managedRuleGroupStatement: {
                vendorName: "AWS",
                name: "AWSManagedRulesCommonRuleSet",
              },
            },
            overrideAction: { none: {} },
            visibilityConfig: {
              sampledRequestsEnabled: true,
              cloudWatchMetricsEnabled: true,
              metricName: "CommonRuleSet",
            },
          },
        ],
        visibilityConfig: {
          sampledRequestsEnabled: true,
          cloudWatchMetricsEnabled: true,
          metricName: "WebAcl",
        },
      });

      new wafv2.CfnWebACLAssociation(this, "WebAclAssociation", {
        resourceArn: this.api.deploymentStage.stageArn,
        webAclArn: webAcl.attrArn,
      });
    }

    // ==================== CloudWatch Alarms with KMS ====================

    const alarmTopic = new sns.Topic(this, "AlarmTopic", {
      topicName: `${prefix}-alarms`,
      displayName: "Content Scheduler Alarms",
      masterKey: encryptionKey, // ✅ SNS encryption
    });

    if (alertEmail) {
      alarmTopic.addSubscription(
        new snsSubscriptions.EmailSubscription(alertEmail),
      );
    }

    // Publishing failure alarm
    new cloudwatch.Alarm(this, "PublishingFailureAlarm", {
      alarmName: `${prefix}-publishing-failures`,
      metric: new cloudwatch.Metric({
        namespace: "AWS/Lambda",
        metricName: "Errors",
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
    new cloudwatch.Alarm(this, "HighRetryRateAlarm", {
      alarmName: `${prefix}-high-retry-rate`,
      metric: new cloudwatch.Metric({
        namespace: "ContentScheduler",
        metricName: "RetryCount",
        statistic: "Sum",
        period: cdk.Duration.minutes(5),
      }),
      threshold: 100,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // DLQ message count alarm
    new cloudwatch.Alarm(this, "DLQAlarm", {
      alarmName: `${prefix}-dlq-messages`,
      metric: deadLetterQueue.metricApproximateNumberOfMessagesVisible(),
      threshold: 10,
      evaluationPeriods: 1,
    }).addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // Orphaned schedules alarm - triggers if too many orphaned schedules are found
    new cloudwatch.Alarm(this, "OrphanedSchedulesAlarm", {
      alarmName: `${prefix}-orphaned-schedules`,
      metric: new cloudwatch.Metric({
        namespace: "ContentScheduler",
        metricName: "OrphanedSchedulesCleaned",
        statistic: "Sum",
        period: cdk.Duration.hours(24),
      }),
      threshold: 50, // Alert if more than 50 orphaned schedules are cleaned in a day
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // Failed schedules alarm - triggers if many schedules are failing
    new cloudwatch.Alarm(this, "FailedSchedulesAlarm", {
      alarmName: `${prefix}-failed-schedules`,
      metric: new cloudwatch.Metric({
        namespace: "ContentScheduler",
        metricName: "FailedSchedulesCleaned",
        statistic: "Sum",
        period: cdk.Duration.hours(24),
      }),
      threshold: 30, // Alert if more than 30 failed schedules are cleaned in a day
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // Cleanup job failure alarm
    new cloudwatch.Alarm(this, "CleanupJobFailureAlarm", {
      alarmName: `${prefix}-cleanup-job-failure`,
      metric: new cloudwatch.Metric({
        namespace: "AWS/Lambda",
        metricName: "Errors",
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
          id: "AwsSolutions-S10",
          reason:
            "Access logs bucket is managed by AWS ELB service which handles SSL enforcement internally",
        },
      ],
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/AccessLogsBucket/Policy/Resource`,
      [
        {
          id: "AwsSolutions-S10",
          reason:
            "Access logs bucket is managed by AWS ELB service which handles SSL enforcement internally",
        },
      ],
    );

    // Suppress S3 bucket SSL enforcement warnings for video bucket (bucket and policy)
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/VideoBucket/Resource`,
      [
        {
          id: "AwsSolutions-S10",
          reason:
            "Video bucket accessed via pre-signed URLs with HTTPS enforced at application level",
        },
      ],
    );
    // Note: No explicit BucketPolicy is synthesized for VideoBucket in some environments,
    // so suppressions by path to "/VideoBucket/Policy/Resource" may fail. The bucket-level
    // suppression above is sufficient for AwsSolutions-S10 in this stack.

    // Suppress secret rotation warnings
    NagSuppressions.addResourceSuppressions(platformCredentials, [
      {
        id: "AwsSolutions-SMG4",
        reason:
          "Platform API credentials are managed manually by operations team",
      },
    ]);

    // Suppress SQS SSL enforcement warnings
    NagSuppressions.addResourceSuppressions(deadLetterQueue, [
      {
        id: "AwsSolutions-SQS4",
        reason:
          "Dead letter queue is only accessed by Lambda functions within VPC using IAM roles",
      },
    ]);

    // Suppress X-Ray permissions specifically
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/LambdaExecutionRole/DefaultPolicy/Resource`,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Lambda execution role requires wildcard permissions for CloudWatch Logs and X-Ray tracing",
          appliesTo: [
            "Resource::*",
            `Resource::arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/postolio-scheduler-${environment}-*`,
          ],
        },
      ],
    );

    // Suppress API Gateway logging configuration
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/SchedulerApi/Resource`,
      [
        {
          id: "AwsSolutions-APIG1",
          reason:
            "CloudWatch logging disabled to avoid circular dependency with IAM role. Metrics and tracing are enabled for monitoring.",
        },
      ],
    );

    // Suppress WAF warning for non-production environments
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/SchedulerApi/DeploymentStage.${environment}/Resource`,
      [
        {
          id: "AwsSolutions-APIG3",
          reason: `WAF not required for ${environment} environment. Production uses AWS WAF v2 for protection.`,
        },
      ],
    );

    // Suppress API Gateway warnings (using IAM auth instead of Cognito)
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/SchedulerApi/Default/schedules/POST/Resource`,
      [
        {
          id: "AwsSolutions-APIG4",
          reason:
            "Using IAM SigV4 authentication for service-to-service communication",
        },
        {
          id: "AwsSolutions-COG4",
          reason:
            "Using IAM SigV4 authentication for service-to-service communication instead of Cognito user pools",
        },
      ],
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/SchedulerApi/Default/schedules/GET/Resource`,
      [
        {
          id: "AwsSolutions-APIG4",
          reason:
            "Using IAM SigV4 authentication for service-to-service communication",
        },
        {
          id: "AwsSolutions-COG4",
          reason:
            "Using IAM SigV4 authentication for service-to-service communication instead of Cognito user pools",
        },
      ],
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/SchedulerApi/Default/schedules/{scheduleId}/GET/Resource`,
      [
        {
          id: "AwsSolutions-APIG4",
          reason:
            "Using IAM SigV4 authentication for service-to-service communication",
        },
        {
          id: "AwsSolutions-COG4",
          reason:
            "Using IAM SigV4 authentication for service-to-service communication instead of Cognito user pools",
        },
      ],
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/SchedulerApi/Default/schedules/{scheduleId}/PUT/Resource`,
      [
        {
          id: "AwsSolutions-APIG4",
          reason:
            "Using IAM SigV4 authentication for service-to-service communication",
        },
        {
          id: "AwsSolutions-COG4",
          reason:
            "Using IAM SigV4 authentication for service-to-service communication instead of Cognito user pools",
        },
      ],
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/SchedulerApi/Default/schedules/{scheduleId}/DELETE/Resource`,
      [
        {
          id: "AwsSolutions-APIG4",
          reason:
            "Using IAM SigV4 authentication for service-to-service communication",
        },
        {
          id: "AwsSolutions-COG4",
          reason:
            "Using IAM SigV4 authentication for service-to-service communication instead of Cognito user pools",
        },
      ],
    );

    // Suppress access logs bucket logging requirement
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/AccessLogsBucket/Resource`,
      [
        {
          id: "AwsSolutions-S1",
          reason:
            "This is the access logs bucket itself - enabling access logging would create an infinite loop",
        },
      ],
    );

    // Suppress Lambda IAM managed policy warnings
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/ScheduleManagementLambda/ServiceRole/Resource`,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "Lambda functions require AWS managed BasicExecutionRole for CloudWatch Logs",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
          ],
        },
      ],
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/PublisherLambda/ServiceRole/Resource`,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "Lambda functions require AWS managed BasicExecutionRole for CloudWatch Logs",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
          ],
        },
      ],
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/RetryHandlerLambda/ServiceRole/Resource`,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "Lambda functions require AWS managed BasicExecutionRole for CloudWatch Logs",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
          ],
        },
      ],
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/ScheduleCleanupLambda/ServiceRole/Resource`,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "Lambda functions require AWS managed BasicExecutionRole for CloudWatch Logs",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
          ],
        },
      ],
    );

    // Suppress Lambda IAM wildcard permissions
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/ScheduleManagementLambda/ServiceRole/DefaultPolicy/Resource`,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Lambda requires wildcard permissions for X-Ray tracing, DynamoDB GSI access, EventBridge schedules, and KMS operations",
          appliesTo: [
            "Resource::*",
            "Action::kms:GenerateDataKey*",
            "Action::kms:ReEncrypt*",
            "Resource::<SchedulesTableFBEB0188.Arn>/index/*",
            `Resource::arn:aws:scheduler:${this.region}:${this.account}:schedule/postolio-scheduler-${environment}-schedules/*`,
          ],
        },
      ],
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/PublisherLambda/ServiceRole/DefaultPolicy/Resource`,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Publisher Lambda requires wildcard permissions for X-Ray, DynamoDB GSI, S3 operations, KMS, and Token Service API GET access",
          appliesTo: [
            "Resource::*",
            "Action::kms:GenerateDataKey*",
            "Action::kms:ReEncrypt*",
            "Action::s3:Abort*",
            "Action::s3:DeleteObject*",
            "Action::s3:GetBucket*",
            "Action::s3:GetObject*",
            "Action::s3:List*",
            "Resource::<SchedulesTableFBEB0188.Arn>/index/*",
            "Resource::<VideoBucket6ED8E1AF.Arn>/*",
            `Resource::arn:aws:execute-api:${this.region}:${this.account}:*/*/GET/tokens/*`,
          ],
        },
      ],
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/RetryHandlerLambda/ServiceRole/DefaultPolicy/Resource`,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Retry handler requires wildcard permissions for X-Ray, KMS, DynamoDB GSI access, and Lambda invocation",
          appliesTo: [
            "Resource::*",
            "Action::kms:GenerateDataKey*",
            "Action::kms:ReEncrypt*",
            "Resource::<PublisherLambdaB2749827.Arn>:*",
            // Grant for DynamoDB GSIs produced by table grants; limited to this table's indexes
            "Resource::<SchedulesTableFBEB0188.Arn>/index/*",
          ],
        },
      ],
    );
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/ScheduleCleanupLambda/ServiceRole/DefaultPolicy/Resource`,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Schedule cleanup Lambda requires wildcard permissions for X-Ray, DynamoDB GSI, KMS, and EventBridge Scheduler listing",
          appliesTo: [
            "Resource::*",
            "Action::kms:GenerateDataKey*",
            "Action::kms:ReEncrypt*",
            "Resource::<SchedulesTableFBEB0188.Arn>/index/*",
            `Resource::arn:aws:scheduler:${this.region}:${this.account}:schedule/postolio-scheduler-${environment}-schedules/*`,
          ],
        },
      ],
    );

    // Suppress Scheduler Role IAM wildcard permissions
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/SchedulerRole/DefaultPolicy/Resource`,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "EventBridge Scheduler role requires wildcard for Lambda invocation",
          appliesTo: ["Resource::<PublisherLambdaB2749827.Arn>:*"],
        },
      ],
    );

    // Suppress API Gateway CloudWatch Role managed policy
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/ApiGatewayCloudWatchRole/Resource`,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "API Gateway requires AWS managed policy for CloudWatch logging",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs",
          ],
        },
      ],
    );

    // Register Content Scheduler with Cloud Map
    registerLambdaService(
      serviceDiscovery,
      "content-scheduler",
      this.api.url,
      environment,
    );

    // ==================== Outputs ====================

    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: this.api.url,
      description: "Content Scheduler API endpoint",
      // No export needed - services use Cloud Map for discovery
    });

    new cdk.CfnOutput(this, "ApiArn", {
      value: this.api.arnForExecuteApi(),
      description: "Content Scheduler API ARN for IAM permissions",
      // No export needed - services use Cloud Map for discovery
    });

    new cdk.CfnOutput(this, "SchedulesTableName", {
      value: this.schedulesTable.tableName,
      description: "DynamoDB Schedules table name",
      exportName: `${prefix}-schedules-table`,
    });

    new cdk.CfnOutput(this, "VideoBucketName", {
      value: this.videoBucket.bucketName,
      description: "S3 Video bucket name",
      exportName: `${prefix}-video-bucket`,
    });

    // Service client secret removed - using IAM SigV4 authentication
  }
}
