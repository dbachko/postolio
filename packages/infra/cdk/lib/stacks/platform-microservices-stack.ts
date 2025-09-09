/**
 * Platform Microservices Stack
 * Production-ready microservices architecture for social media scheduling
 */

import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as kms from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import { Construct } from "constructs";
import * as path from "path";
import { CloudWatchDashboards } from "../constructs/cloudwatch-dashboards";
import { SecuredApiGateway } from "../constructs/secured-api-gateway";
import {
  getOAuthEnvironmentVariables,
  type OAuthConfig,
} from "../utils/oauth-config";

export interface PlatformMicroservicesStackProps
  extends cdk.StackProps,
    OAuthConfig {
  environment: "dev" | "staging" | "prod";
  domainName?: string;
  alertEmail?: string;
}

export class PlatformMicroservicesStack extends cdk.Stack {
  public readonly tokenServiceApi: apigateway.RestApi;
  public readonly eventBus: events.EventBus;
  public readonly tokenTable: dynamodb.Table;
  public readonly scheduleTable: dynamodb.Table;

  constructor(
    scope: Construct,
    id: string,
    props: PlatformMicroservicesStackProps,
  ) {
    super(scope, id, props);

    const { environment, alertEmail } = props;

    // ==================== KMS Keys ====================
    const tokenEncryptionKey = new kms.Key(this, "TokenEncryptionKey", {
      description: "KMS key for encrypting OAuth tokens",
      alias: `postolio-${environment}-token-key`,
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
    });

    // ==================== DynamoDB Tables ====================
    // Note: Platform secrets are managed via GitHub Secrets and passed as environment variables
    // No need for AWS Secrets Manager for these values

    // Token Table
    this.tokenTable = new dynamodb.Table(this, "TokenTable", {
      tableName: `postolio-${environment}-tokens`,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
      timeToLiveAttribute: "ttl",
    });

    // Schedule Table with sharding and GSIs for efficient lookups
    this.scheduleTable = new dynamodb.Table(this, "ScheduleTable", {
      tableName: `postolio-${environment}-schedules`,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
    });

    // Add GSI for schedule ID lookups
    this.scheduleTable.addGlobalSecondaryIndex({
      indexName: "by-schedule-id",
      partitionKey: { name: "scheduleId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Add GSI for content ID lookups
    this.scheduleTable.addGlobalSecondaryIndex({
      indexName: "by-content-id",
      partitionKey: { name: "contentId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "scheduledAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Add GSI for brand-based queries
    this.scheduleTable.addGlobalSecondaryIndex({
      indexName: "by-brand",
      partitionKey: { name: "brandId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "scheduledAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Add GSI for platform-based queries
    this.scheduleTable.addGlobalSecondaryIndex({
      indexName: "by-platform-status",
      partitionKey: { name: "platform", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "status", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    // Job State Table
    const jobStateTable = new dynamodb.Table(this, "JobStateTable", {
      tableName: `postolio-${environment}-job-states`,
      partitionKey: { name: "jobId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
    });

    // Idempotency Table
    const idempotencyTable = new dynamodb.Table(this, "IdempotencyTable", {
      tableName: `postolio-${environment}-idempotency`,
      partitionKey: {
        name: "idempotencyKey",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
    });

    // Saga State Table for distributed transactions
    const sagaStateTable = new dynamodb.Table(this, "SagaStateTable", {
      tableName: `postolio-${environment}-saga-state`,
      partitionKey: { name: "sagaId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
    });

    // Add GSI for saga type queries
    sagaStateTable.addGlobalSecondaryIndex({
      indexName: "by-saga-type",
      partitionKey: { name: "sagaType", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Circuit Breaker State Table
    const circuitBreakerTable = new dynamodb.Table(
      this,
      "CircuitBreakerTable",
      {
        tableName: `postolio-${environment}-circuit-breaker-state`,
        partitionKey: {
          name: "serviceName",
          type: dynamodb.AttributeType.STRING,
        },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        encryption: dynamodb.TableEncryption.AWS_MANAGED,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        timeToLiveAttribute: "ttl",
      },
    );

    // ==================== EventBridge ====================
    this.eventBus = new events.EventBus(this, "PlatformEventBus", {
      eventBusName: `postolio-${environment}-platform-events`,
    });

    // Event Archive for replay capability
    new events.Archive(this, "EventArchive", {
      archiveName: `postolio-${environment}-archive`,
      eventPattern: {
        source: ["postolio.publisher", "postolio.scheduler", "postolio.token"],
      },
      sourceEventBus: this.eventBus,
      retention: cdk.Duration.days(7),
    });

    // ==================== SQS Queues ====================

    // Publisher queues with DLQ
    const publisherDLQ = new sqs.Queue(this, "PublisherDLQ", {
      queueName: `postolio-${environment}-publisher-dlq`,
      retentionPeriod: cdk.Duration.days(14),
    });

    const instagramQueue = new sqs.Queue(this, "InstagramPublisherQueue", {
      queueName: `postolio-${environment}-instagram-publisher`,
      visibilityTimeout: cdk.Duration.seconds(300),
      deadLetterQueue: {
        queue: publisherDLQ,
        maxReceiveCount: 3,
      },
    });

    const facebookQueue = new sqs.Queue(this, "FacebookPublisherQueue", {
      queueName: `postolio-${environment}-facebook-publisher`,
      visibilityTimeout: cdk.Duration.seconds(300),
      deadLetterQueue: {
        queue: publisherDLQ,
        maxReceiveCount: 3,
      },
    });

    const linkedinQueue = new sqs.Queue(this, "LinkedInPublisherQueue", {
      queueName: `postolio-${environment}-linkedin-publisher`,
      visibilityTimeout: cdk.Duration.seconds(300),
      deadLetterQueue: {
        queue: publisherDLQ,
        maxReceiveCount: 3,
      },
    });

    const tiktokQueue = new sqs.Queue(this, "TikTokPublisherQueue", {
      queueName: `postolio-${environment}-tiktok-publisher`,
      visibilityTimeout: cdk.Duration.seconds(300),
      deadLetterQueue: {
        queue: publisherDLQ,
        maxReceiveCount: 3,
      },
    });

    // ==================== Rate Limit Table ====================
    const rateLimitTable = new dynamodb.Table(this, "RateLimitTable", {
      tableName: `postolio-rate-limits-${environment}`,
      partitionKey: { name: "bucketKey", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
    });

    // ==================== Lambda Layer ====================
    const sharedLayer = new lambda.LayerVersion(this, "SharedDependencies", {
      code: lambda.Code.fromAsset(path.join(__dirname, "../../layers/shared")),
      compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
      description: "Shared dependencies for Lambda functions",
    });

    // ==================== Common Lambda Environment ====================
    const commonEnv = {
      ENVIRONMENT: environment,
      TOKEN_TABLE_NAME: this.tokenTable.tableName,
      SCHEDULE_TABLE_NAME: this.scheduleTable.tableName,
      JOB_STATE_TABLE_NAME: jobStateTable.tableName,
      IDEMPOTENCY_TABLE_NAME: idempotencyTable.tableName,
      EVENT_BUS_NAME: this.eventBus.eventBusName,
      KMS_KEY_ID: tokenEncryptionKey.keyId,
      RATE_LIMIT_TABLE_NAME: `postolio-rate-limits-${environment}`,
      AWS_ACCOUNT_ID: this.account,

      // OAuth credentials from shared utility
      ...getOAuthEnvironmentVariables(props),
    };

    // ==================== Lambda Functions ====================

    // Token Service
    const tokenServiceLambda = new lambdaNode.NodejsFunction(
      this,
      "TokenService",
      {
        functionName: `postolio-${environment}-token-service`,
        entry: path.join(__dirname, "../lambdas/token-service/index.ts"),
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: "handler",
        timeout: cdk.Duration.seconds(30),
        memorySize: 512,
        environment: commonEnv,
        tracing: lambda.Tracing.ACTIVE,
        layers: [sharedLayer],
        logRetention: logs.RetentionDays.ONE_WEEK,
        reservedConcurrentExecutions: 500, // Increased from 100 to handle higher throughput
      },
    );

    // Grant permissions
    this.tokenTable.grantReadWriteData(tokenServiceLambda);
    rateLimitTable.grantReadWriteData(tokenServiceLambda);
    tokenEncryptionKey.grantEncryptDecrypt(tokenServiceLambda);
    // Platform secrets are passed as environment variables from GitHub Secrets

    // Token Rotation (scheduled)
    const tokenRotationLambda = new lambdaNode.NodejsFunction(
      this,
      "TokenRotation",
      {
        functionName: `postolio-${environment}-token-rotation`,
        entry: path.join(__dirname, "../lambdas/token-rotation/index.ts"),
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: "handler",
        timeout: cdk.Duration.minutes(5),
        memorySize: 1024,
        environment: commonEnv,
        tracing: lambda.Tracing.ACTIVE,
        layers: [sharedLayer],
        logRetention: logs.RetentionDays.ONE_WEEK,
      },
    );

    this.tokenTable.grantReadWriteData(tokenRotationLambda);
    tokenEncryptionKey.grantEncryptDecrypt(tokenRotationLambda);
    // Platform secrets are passed as environment variables from GitHub Secrets
    this.eventBus.grantPutEventsTo(tokenRotationLambda);

    // Schedule token rotation to run daily
    new events.Rule(this, "TokenRotationSchedule", {
      schedule: events.Schedule.rate(cdk.Duration.hours(24)),
      targets: [new targets.LambdaFunction(tokenRotationLambda)],
    });

    // Scheduler Service
    const schedulerServiceLambda = new lambdaNode.NodejsFunction(
      this,
      "SchedulerService",
      {
        functionName: `postolio-${environment}-scheduler-service`,
        entry: path.join(__dirname, "../lambdas/scheduler-service/index.ts"),
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: "handler",
        timeout: cdk.Duration.seconds(30),
        memorySize: 512,
        environment: {
          ...commonEnv,
          EVENTS_ROLE_ARN: new iam.Role(this, "EventBridgeRole", {
            assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
            inlinePolicies: {
              EventBridgePolicy: new iam.PolicyDocument({
                statements: [
                  new iam.PolicyStatement({
                    actions: ["events:PutEvents"],
                    resources: [this.eventBus.eventBusArn],
                  }),
                ],
              }),
            },
          }).roleArn,
        },
        tracing: lambda.Tracing.ACTIVE,
        layers: [sharedLayer],
        logRetention: logs.RetentionDays.ONE_WEEK,
      },
    );

    this.scheduleTable.grantReadWriteData(schedulerServiceLambda);
    this.eventBus.grantPutEventsTo(schedulerServiceLambda);

    // Grant EventBridge permissions
    schedulerServiceLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "scheduler:CreateSchedule",
          "scheduler:DeleteSchedule",
          "scheduler:GetSchedule",
          "scheduler:UpdateSchedule",
          "iam:PassRole",
        ],
        resources: ["*"],
      }),
    );

    // Publisher Lambdas
    const createPublisherLambda = (platform: string, queue: sqs.Queue) => {
      const publisherLambda = new lambdaNode.NodejsFunction(
        this,
        `${platform}Publisher`,
        {
          functionName: `postolio-${environment}-${platform.toLowerCase()}-publisher`,
          entry: path.join(
            __dirname,
            `../lambdas/publishers/${platform.toLowerCase()}/index.ts`,
          ),
          runtime: lambda.Runtime.NODEJS_18_X,
          handler: "handler",
          timeout: cdk.Duration.minutes(5),
          memorySize: 1024,
          environment: commonEnv,
          tracing: lambda.Tracing.ACTIVE,
          layers: [sharedLayer],
          logRetention: logs.RetentionDays.ONE_WEEK,
          reservedConcurrentExecutions: 200, // Increased from 50 to handle concurrent publishing
        },
      );

      // Permissions
      this.tokenTable.grantReadData(publisherLambda);
      jobStateTable.grantReadWriteData(publisherLambda);
      idempotencyTable.grantReadWriteData(publisherLambda);
      tokenEncryptionKey.grantDecrypt(publisherLambda);
      this.eventBus.grantPutEventsTo(publisherLambda);

      // SQS trigger
      publisherLambda.addEventSource(
        new cdk.aws_lambda_event_sources.SqsEventSource(queue, {
          batchSize: 1,
          maxBatchingWindow: cdk.Duration.seconds(5),
        }),
      );

      return publisherLambda;
    };

    const instagramPublisher = createPublisherLambda(
      "Instagram",
      instagramQueue,
    );
    const facebookPublisher = createPublisherLambda("Facebook", facebookQueue);
    const linkedinPublisher = createPublisherLambda("LinkedIn", linkedinQueue);
    const tiktokPublisher = createPublisherLambda("TikTok", tiktokQueue);

    // ==================== Secured API Gateway ====================
    const securedApi = new SecuredApiGateway(this, "SecuredApiGateway", {
      environment,
      serviceName: "platform",
      lambdaIntegrations: {
        tokens: {
          lambda: tokenServiceLambda,
          methods: ["POST"],
          authType: "IAM",
          throttle: {
            burstLimit: 100,
            rateLimit: 50,
          },
        },
        "tokens/{userId}/{platform}": {
          lambda: tokenServiceLambda,
          methods: ["GET", "DELETE"],
          authType: "IAM",
          throttle: {
            burstLimit: 50,
            rateLimit: 25,
          },
        },
        schedules: {
          lambda: schedulerServiceLambda,
          methods: ["POST", "GET"],
          authType: "IAM",
          throttle: {
            burstLimit: 200,
            rateLimit: 100,
          },
        },
        "schedules/{scheduleId}": {
          lambda: schedulerServiceLambda,
          methods: ["GET", "DELETE", "PATCH"],
          authType: "IAM",
          throttle: {
            burstLimit: 100,
            rateLimit: 50,
          },
        },
      },
      enableWaf: environment === "prod",
      enableApiKey: true,
      enableUsagePlan: true,
      corsConfig: {
        allowOrigins:
          environment === "prod"
            ? [
                props.domainName
                  ? `https://${props.domainName}`
                  : "https://postolio.example",
              ]
            : apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          "Content-Type",
          "X-Amz-Date",
          "Authorization",
          "X-Api-Key",
          "X-Amz-Security-Token",
          "X-User-Id",
          "X-User-Tier",
          "X-Correlation-Id",
          "X-Brand-Id",
        ],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // Store API reference for other stacks
    this.tokenServiceApi = securedApi.api;

    // ==================== EventBridge Rules ====================

    // Route schedule executions to publisher queues
    new events.Rule(this, "InstagramScheduleRule", {
      eventBus: this.eventBus,
      eventPattern: {
        source: ["postolio.scheduler"],
        detailType: ["schedule.execute"],
        detail: { platform: ["instagram"] },
      },
      targets: [new targets.SqsQueue(instagramQueue)],
    });

    new events.Rule(this, "FacebookScheduleRule", {
      eventBus: this.eventBus,
      eventPattern: {
        source: ["postolio.scheduler"],
        detailType: ["schedule.execute"],
        detail: { platform: ["facebook"] },
      },
      targets: [new targets.SqsQueue(facebookQueue)],
    });

    new events.Rule(this, "LinkedInScheduleRule", {
      eventBus: this.eventBus,
      eventPattern: {
        source: ["postolio.scheduler"],
        detailType: ["schedule.execute"],
        detail: { platform: ["linkedin"] },
      },
      targets: [new targets.SqsQueue(linkedinQueue)],
    });

    new events.Rule(this, "TikTokScheduleRule", {
      eventBus: this.eventBus,
      eventPattern: {
        source: ["postolio.scheduler"],
        detailType: ["schedule.execute"],
        detail: { platform: ["tiktok"] },
      },
      targets: [new targets.SqsQueue(tiktokQueue)],
    });

    // ==================== DLQ Processing Infrastructure ====================

    // DLQ Processing State Table
    const dlqStateTable = new dynamodb.Table(this, "DLQStateTable", {
      tableName: `postolio-dlq-state-${environment}`,
      partitionKey: { name: "messageId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      timeToLiveAttribute: "ttl",
    });

    // GSI for querying by DLQ and status
    dlqStateTable.addGlobalSecondaryIndex({
      indexName: "by-dlq-status",
      partitionKey: { name: "dlqName", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "status", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // DLQ Processor Lambda
    const dlqProcessorLambda = new lambda.Function(this, "DLQProcessorLambda", {
      functionName: `postolio-dlq-processor-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("./lib/lambdas/dlq-processor"),
      environment: {
        DLQ_STATE_TABLE_NAME: dlqStateTable.tableName,
        PUBLISHER_QUEUE_URL: instagramQueue.queueUrl,
        SCHEDULER_QUEUE_URL: "", // Will be added when scheduler queue is created
        TOKEN_REFRESH_QUEUE_URL: "", // Will be added when token refresh queue is created
        ANALYTICS_QUEUE_URL: "", // Will be added when analytics queue is created
        SQS_BASE_URL: `https://sqs.${cdk.Stack.of(this).region}.amazonaws.com/${cdk.Stack.of(this).account}`,
        DLQ_MAX_RETRIES: "5",
        DLQ_RETRY_DELAY_BASE: "60000",
        ENVIRONMENT: environment,
      },
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      tracing: lambda.Tracing.ACTIVE,
    });

    // Grant permissions
    dlqStateTable.grantReadWriteData(dlqProcessorLambda);
    publisherDLQ.grantConsumeMessages(dlqProcessorLambda);
    publisherDLQ.grantSendMessages(dlqProcessorLambda);
    instagramQueue.grantSendMessages(dlqProcessorLambda);
    facebookQueue.grantSendMessages(dlqProcessorLambda);
    linkedinQueue.grantSendMessages(dlqProcessorLambda);
    tiktokQueue.grantSendMessages(dlqProcessorLambda);

    // Schedule DLQ processing every 15 minutes
    const dlqProcessingRule = new events.Rule(this, "DLQProcessingRule", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      description: "Process messages from Dead Letter Queues",
    });

    dlqProcessingRule.addTarget(new targets.LambdaFunction(dlqProcessorLambda));

    // Manual reprocess Lambda
    const dlqReprocessLambda = new lambda.Function(this, "DLQReprocessLambda", {
      functionName: `postolio-dlq-reprocess-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.reprocessHandler",
      code: lambda.Code.fromAsset("./lib/lambdas/dlq-processor"),
      environment: {
        DLQ_STATE_TABLE_NAME: dlqStateTable.tableName,
        SQS_BASE_URL: `https://sqs.${cdk.Stack.of(this).region}.amazonaws.com/${cdk.Stack.of(this).account}`,
        ENVIRONMENT: environment,
      },
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      tracing: lambda.Tracing.ACTIVE,
    });

    // Grant permissions for reprocess Lambda
    dlqStateTable.grantReadWriteData(dlqReprocessLambda);
    publisherDLQ.grantSendMessages(dlqReprocessLambda);

    // ==================== CloudWatch Alarms ====================
    let alarmTopic: cdk.aws_sns.Topic | undefined;

    if (alertEmail) {
      alarmTopic = new cdk.aws_sns.Topic(this, "AlarmTopic", {
        displayName: `Postolio ${environment} Alarms`,
      });

      alarmTopic.addSubscription(
        new cdk.aws_sns_subscriptions.EmailSubscription(alertEmail),
      );

      // Grant DLQ processor permission to publish alerts
      alarmTopic.grantPublish(dlqProcessorLambda);

      // Add alarm topic ARN to DLQ processor environment
      dlqProcessorLambda.addEnvironment(
        "DLQ_ALERT_TOPIC_ARN",
        alarmTopic.topicArn,
      );

      // DLQ alarm
      new cloudwatch.Alarm(this, "DLQAlarm", {
        metric: publisherDLQ.metricApproximateNumberOfMessagesVisible(),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: "Messages in publisher DLQ",
      }).addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(alarmTopic));

      // Token rotation errors
      new cloudwatch.Alarm(this, "TokenRotationErrorAlarm", {
        metric: tokenRotationLambda.metricErrors(),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: "Token rotation Lambda errors",
      }).addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(alarmTopic));
    }

    // ==================== CloudWatch Dashboards ====================
    const dashboards = new CloudWatchDashboards(this, "Dashboards", {
      environment,
      tokenServiceLambda,
      schedulerServiceLambda,
      publisherLambdas: {
        instagram: instagramPublisher,
        facebook: facebookPublisher,
        linkedin: linkedinPublisher,
        tiktok: tiktokPublisher,
      },
      dlqProcessorLambda,
      tokenTable: this.tokenTable,
      scheduleTable: this.scheduleTable,
      sagaStateTable,
      circuitBreakerTable,
      dlqStateTable,
      publisherQueues: {
        instagram: instagramQueue,
        facebook: facebookQueue,
        linkedin: linkedinQueue,
        tiktok: tiktokQueue,
      },
      publisherDLQ,
      eventBus: this.eventBus,
    });

    // ==================== Outputs ====================
    new cdk.CfnOutput(this, "TokenServiceApiUrl", {
      value: this.tokenServiceApi.url,
      description: "Token Service API URL",
    });

    new cdk.CfnOutput(this, "EventBusArn", {
      value: this.eventBus.eventBusArn,
      description: "Platform Event Bus ARN",
    });

    new cdk.CfnOutput(this, "TokenTableName", {
      value: this.tokenTable.tableName,
      description: "Token DynamoDB Table Name",
    });

    new cdk.CfnOutput(this, "ScheduleTableName", {
      value: this.scheduleTable.tableName,
      description: "Schedule DynamoDB Table Name",
    });
  }
}
