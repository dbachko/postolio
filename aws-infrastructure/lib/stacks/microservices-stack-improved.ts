/**
 * Improved Microservices Stack
 * Implements all architectural improvements from the review
 */

import * as cdk from 'aws-cdk-lib'
import * as events from 'aws-cdk-lib/aws-events'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as kms from 'aws-cdk-lib/aws-kms'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as xray from 'aws-cdk-lib/aws-xray'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as scheduler from 'aws-cdk-lib/aws-scheduler'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { Construct } from 'constructs'
import * as path from 'path'

export interface ImprovedMicroservicesStackProps extends cdk.StackProps {
  environment: string
  alertEmail?: string
}

export class ImprovedMicroservicesStack extends cdk.Stack {
  public readonly eventBus: events.EventBus
  public readonly tokenTable: dynamodb.Table
  public readonly scheduleTable: dynamodb.Table
  public readonly idempotencyTable: dynamodb.Table
  public readonly tokenServiceApi: apigateway.RestApi
  public readonly publisherQueues: Map<string, sqs.Queue> = new Map()
  public readonly alarmTopic: cdk.aws_sns.Topic

  constructor(scope: Construct, id: string, props: ImprovedMicroservicesStackProps) {
    super(scope, id, props)

    const { environment, alertEmail } = props

    // ========================================
    // Monitoring & Alerting Setup
    // ========================================
    
    this.alarmTopic = new cdk.aws_sns.Topic(this, 'AlarmTopic', {
      topicName: `postolio-${environment}-alarms`,
      displayName: 'Postolio Microservices Alarms',
    })

    if (alertEmail) {
      new cdk.aws_sns_subscriptions.EmailSubscription(alertEmail).bind(this.alarmTopic)
    }

    // ========================================
    // Core Infrastructure - Enhanced
    // ========================================

    // 1. EventBridge Event Bus with DLQ
    this.eventBus = new events.EventBus(this, 'PostolioEventBus', {
      eventBusName: `postolio-${environment}-event-bus`,
    })

    // Add event bus DLQ for failed events
    const eventBusDlq = new sqs.Queue(this, 'EventBusDLQ', {
      queueName: `postolio-${environment}-event-bus-dlq`,
      retentionPeriod: cdk.Duration.days(14),
    })

    // 2. KMS Key for Token Encryption with rotation
    const tokenEncryptionKey = new kms.Key(this, 'TokenEncryptionKey', {
      description: 'KMS key for encrypting OAuth tokens',
      alias: `alias/postolio-${environment}-tokens`,
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pendingWindow: cdk.Duration.days(7),
    })

    // 3. DynamoDB Tables with improved design
    
    // Token Table with proper GSI for efficient queries
    this.tokenTable = new dynamodb.Table(this, 'TokenTable', {
      tableName: `postolio-${environment}-tokens`,
      partitionKey: {
        name: 'pk', // userId#platform
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk', // brandId
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: tokenEncryptionKey,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      timeToLiveAttribute: 'ttl',
    })

    // Proper GSI for token expiry queries
    this.tokenTable.addGlobalSecondaryIndex({
      indexName: 'by-expiry',
      partitionKey: {
        name: 'expiresAt',
        type: dynamodb.AttributeType.NUMBER,
      },
      sortKey: {
        name: 'pk',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    })

    // Schedule Table with better partition key design
    this.scheduleTable = new dynamodb.Table(this, 'ScheduleTable', {
      tableName: `postolio-${environment}-schedules`,
      partitionKey: {
        name: 'pk', // brandId for better distribution
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk', // scheduledTime#scheduleId
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      timeToLiveAttribute: 'ttl',
    })

    // GSIs for Schedule Table
    this.scheduleTable.addGlobalSecondaryIndex({
      indexName: 'by-content',
      partitionKey: {
        name: 'contentId',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    })

    this.scheduleTable.addGlobalSecondaryIndex({
      indexName: 'by-status',
      partitionKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'scheduledTime',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    })

    // NEW: Idempotency Table for preventing duplicate posts
    this.idempotencyTable = new dynamodb.Table(this, 'IdempotencyTable', {
      tableName: `postolio-${environment}-idempotency`,
      partitionKey: {
        name: 'idempotencyKey',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    // Job State Table with TTL
    const jobStateTable = new dynamodb.Table(this, 'JobStateTable', {
      tableName: `postolio-${environment}-job-state`,
      partitionKey: {
        name: 'jobId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    // ========================================
    // Lambda Layer for Shared Dependencies
    // ========================================
    
    const sharedDependenciesLayer = new lambda.LayerVersion(this, 'SharedDependencies', {
      layerVersionName: `postolio-${environment}-shared-deps`,
      description: 'Shared dependencies for Lambda functions',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../layers/shared-deps')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      license: 'MIT',
    })

    // ========================================
    // SQS Queues with Enhanced Configuration
    // ========================================
    
    const platforms = ['instagram', 'linkedin', 'facebook', 'tiktok']
    
    platforms.forEach(platform => {
      // Dead Letter Queue with alarm
      const dlq = new sqs.Queue(this, `${platform}PublisherDLQ`, {
        queueName: `postolio-${environment}-${platform}-publisher-dlq`,
        retentionPeriod: cdk.Duration.days(14),
        messageRetentionPeriod: cdk.Duration.days(14),
      })

      // DLQ Alarm
      new cloudwatch.Alarm(this, `${platform}DLQAlarm`, {
        alarmName: `postolio-${environment}-${platform}-dlq-messages`,
        alarmDescription: `Messages in ${platform} DLQ`,
        metric: dlq.metricApproximateNumberOfMessagesVisible(),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alarmTopic))

      // Main Queue with optimized settings
      const queue = new sqs.Queue(this, `${platform}PublisherQueue`, {
        queueName: `postolio-${environment}-${platform}-publisher`,
        visibilityTimeout: cdk.Duration.minutes(5),
        messageRetentionPeriod: cdk.Duration.days(4),
        deadLetterQueue: {
          queue: dlq,
          maxReceiveCount: 3,
        },
        // Enable content-based deduplication for idempotency
        fifo: false, // Keep as standard queue for higher throughput
      })

      this.publisherQueues.set(platform, queue)
    })

    // ========================================
    // Common Lambda Environment Variables
    // ========================================
    
    const commonEnvVars = {
      TOKEN_TABLE_NAME: this.tokenTable.tableName,
      SCHEDULE_TABLE_NAME: this.scheduleTable.tableName,
      IDEMPOTENCY_TABLE_NAME: this.idempotencyTable.tableName,
      JOB_STATE_TABLE_NAME: jobStateTable.tableName,
      EVENT_BUS_NAME: this.eventBus.eventBusName,
      KMS_KEY_ID: tokenEncryptionKey.keyId,
      ENVIRONMENT: environment,
      AWS_XRAY_TRACING_NAME: `postolio-${environment}`,
      POWERTOOLS_SERVICE_NAME: 'postolio',
      POWERTOOLS_METRICS_NAMESPACE: 'Postolio',
      LOG_LEVEL: environment === 'prod' ? 'INFO' : 'DEBUG',
    }

    // ========================================
    // Token Service with Improvements
    // ========================================

    const tokenServiceLambda = new NodejsFunction(this, 'TokenServiceLambda', {
      functionName: `postolio-${environment}-token-service`,
      entry: path.join(__dirname, '../../lambdas/token-service/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256, // Right-sized based on profiling
      environment: commonEnvVars,
      tracing: lambda.Tracing.ACTIVE,
      layers: [sharedDependenciesLayer],
      logRetention: logs.RetentionDays.ONE_WEEK,
      reservedConcurrentExecutions: 100, // Increased to handle higher load for 1M+ posts/month
      provisionedConcurrentExecutions: 20, // Ensure baseline of warm instances for reduced cold starts
    })

    // Grant permissions
    this.tokenTable.grantReadWriteData(tokenServiceLambda)
    tokenEncryptionKey.grantEncryptDecrypt(tokenServiceLambda)

    // API Gateway with rate limiting
    this.tokenServiceApi = new apigateway.RestApi(this, 'TokenServiceApi', {
      restApiName: `postolio-${environment}-token-service`,
      deployOptions: {
        stageName: environment,
        tracingEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        metricsEnabled: true,
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    })

    // API Resources with request validation
    const tokenRequestModel = new apigateway.Model(this, 'TokenRequestModel', {
      restApi: this.tokenServiceApi,
      contentType: 'application/json',
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        required: ['userId', 'brandId', 'platform', 'accessToken'],
        properties: {
          userId: { type: apigateway.JsonSchemaType.STRING },
          brandId: { type: apigateway.JsonSchemaType.STRING },
          platform: { 
            type: apigateway.JsonSchemaType.STRING,
            enum: ['instagram', 'facebook', 'linkedin', 'tiktok'],
          },
          accessToken: { type: apigateway.JsonSchemaType.STRING },
          refreshToken: { type: apigateway.JsonSchemaType.STRING },
          expiresAt: { type: apigateway.JsonSchemaType.NUMBER },
        },
      },
    })

    const tokens = this.tokenServiceApi.root.addResource('tokens')
    const tokensByUser = tokens.addResource('{userId}')
    const tokenByPlatform = tokensByUser.addResource('{platform}')

    // API Methods with validation
    tokens.addMethod('POST', new apigateway.LambdaIntegration(tokenServiceLambda), {
      authorizationType: apigateway.AuthorizationType.IAM,
      requestValidator: new apigateway.RequestValidator(this, 'TokenRequestValidator', {
        restApi: this.tokenServiceApi,
        validateRequestBody: true,
        validateRequestParameters: true,
      }),
      requestModels: {
        'application/json': tokenRequestModel,
      },
    })

    tokenByPlatform.addMethod('GET', new apigateway.LambdaIntegration(tokenServiceLambda), {
      authorizationType: apigateway.AuthorizationType.IAM,
    })

    // ========================================
    // Enhanced Scheduler Service with EventBridge Scheduler
    // ========================================

    // Create IAM role for EventBridge Scheduler
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Role for EventBridge Scheduler to invoke targets',
    })

    // Grant permissions to invoke Lambda and send to SQS
    platforms.forEach(platform => {
      const queue = this.publisherQueues.get(platform)!
      queue.grantSendMessages(schedulerRole)
    })

    const schedulerServiceLambda = new NodejsFunction(this, 'SchedulerServiceLambda', {
      functionName: `postolio-${environment}-scheduler-service`,
      entry: path.join(__dirname, '../../lambdas/scheduler-service/index-improved.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        ...commonEnvVars,
        SCHEDULER_ROLE_ARN: schedulerRole.roleArn,
      },
      tracing: lambda.Tracing.ACTIVE,
      layers: [sharedDependenciesLayer],
      logRetention: logs.RetentionDays.ONE_WEEK,
    })

    // Grant permissions
    this.scheduleTable.grantReadWriteData(schedulerServiceLambda)
    this.eventBus.grantPutEventsTo(schedulerServiceLambda)

    // Grant EventBridge Scheduler permissions
    schedulerServiceLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'scheduler:CreateSchedule',
        'scheduler:UpdateSchedule',
        'scheduler:DeleteSchedule',
        'scheduler:GetSchedule',
        'scheduler:ListSchedules',
      ],
      resources: [`arn:aws:scheduler:${this.region}:${this.account}:schedule/*`],
    }))

    schedulerServiceLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [schedulerRole.roleArn],
    }))

    // ========================================
    // Enhanced Publisher Services
    // ========================================

    platforms.forEach(platform => {
      const publisherLambda = new NodejsFunction(this, `${platform}PublisherLambda`, {
        functionName: `postolio-${environment}-${platform}-publisher`,
        entry: path.join(__dirname, `../../lambdas/publishers/${platform}/index-improved.ts`),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.minutes(5),
        memorySize: 512, // Right-sized for image processing
        environment: {
          ...commonEnvVars,
          PLATFORM: platform,
        },
        tracing: lambda.Tracing.ACTIVE,
        layers: [sharedDependenciesLayer],
        logRetention: logs.RetentionDays.ONE_WEEK,
        reservedConcurrentExecutions: 50, // Prevent API rate limit issues
      })

      // Grant permissions
      this.tokenTable.grantReadData(publisherLambda)
      this.idempotencyTable.grantReadWriteData(publisherLambda)
      jobStateTable.grantReadWriteData(publisherLambda)
      tokenEncryptionKey.grantDecrypt(publisherLambda)
      this.eventBus.grantPutEventsTo(publisherLambda)

      // Connect to SQS queue
      const queue = this.publisherQueues.get(platform)!
      queue.grantConsumeMessages(publisherLambda)

      // Add SQS trigger with optimized settings
      publisherLambda.addEventSource(new cdk.aws_lambda_event_sources.SqsEventSource(queue, {
        batchSize: 10,
        maxBatchingWindow: cdk.Duration.seconds(5),
        reportBatchItemFailures: true, // Enable partial batch failure
      }))

      // Add Lambda error alarm
      new cloudwatch.Alarm(this, `${platform}PublisherErrorAlarm`, {
        alarmName: `postolio-${environment}-${platform}-publisher-errors`,
        alarmDescription: `${platform} publisher Lambda errors`,
        metric: publisherLambda.metricErrors({
          period: cdk.Duration.minutes(5),
        }),
        threshold: 5,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }).addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alarmTopic))
    })

    // ========================================
    // Enhanced Token Rotation with proper GSI usage
    // ========================================

    const tokenRotationLambda = new NodejsFunction(this, 'TokenRotationLambda', {
      functionName: `postolio-${environment}-token-rotation`,
      entry: path.join(__dirname, '../../lambdas/token-rotation/index-improved.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: commonEnvVars,
      tracing: lambda.Tracing.ACTIVE,
      layers: [sharedDependenciesLayer],
      logRetention: logs.RetentionDays.ONE_WEEK,
    })

    // Grant permissions
    this.tokenTable.grantReadWriteData(tokenRotationLambda)
    tokenEncryptionKey.grantEncryptDecrypt(tokenRotationLambda)
    this.eventBus.grantPutEventsTo(tokenRotationLambda)

    // Schedule token rotation check every hour
    const tokenRotationRule = new events.Rule(this, 'TokenRotationRule', {
      ruleName: `postolio-${environment}-token-rotation`,
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
    })

    tokenRotationRule.addTarget(new cdk.aws_events_targets.LambdaFunction(tokenRotationLambda))

    // ========================================
    // Event Rules with DLQ
    // ========================================

    // Schedule ready -> Publisher queue
    platforms.forEach(platform => {
      const rule = new events.Rule(this, `${platform}ScheduleReadyRule`, {
        ruleName: `postolio-${environment}-${platform}-schedule-ready`,
        eventBus: this.eventBus,
        eventPattern: {
          source: ['postolio.scheduler'],
          detailType: ['schedule.ready'],
          detail: {
            platform: [platform],
          },
        },
      })

      const queue = this.publisherQueues.get(platform)!
      rule.addTarget(new cdk.aws_events_targets.SqsQueue(queue, {
        deadLetterQueue: eventBusDlq,
        maxEventAge: cdk.Duration.hours(2),
        retryAttempts: 3,
      }))
    })

    // ========================================
    // Enhanced CloudWatch Dashboard
    // ========================================

    const dashboard = new cloudwatch.Dashboard(this, 'MicroservicesDashboard', {
      dashboardName: `postolio-${environment}-microservices`,
      periodOverride: cloudwatch.PeriodOverride.INHERIT,
    })

    // Key metrics widget
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Publisher Success Rate',
        left: platforms.map(platform => 
          new cloudwatch.MathExpression({
            expression: `100 * m1 / (m1 + m2)`,
            label: `${platform} Success Rate`,
            usingMetrics: {
              m1: new cloudwatch.Metric({
                namespace: 'Postolio/Publisher',
                metricName: 'SuccessfulPublish',
                dimensionsMap: { Platform: platform },
                statistic: 'Sum',
              }),
              m2: new cloudwatch.Metric({
                namespace: 'Postolio/Publisher',
                metricName: 'ProcessingErrors',
                dimensionsMap: { Platform: platform },
                statistic: 'Sum',
              }),
            },
          })
        ),
        leftYAxis: {
          min: 0,
          max: 100,
          label: 'Success Rate (%)',
        },
      }),
      
      new cloudwatch.GraphWidget({
        title: 'Circuit Breaker Status',
        left: platforms.map(platform =>
          new cloudwatch.Metric({
            namespace: 'Postolio/CircuitBreaker',
            metricName: 'CircuitOpened',
            dimensionsMap: { CircuitName: `${platform}-api` },
            statistic: 'Sum',
          })
        ),
      }),
      
      new cloudwatch.SingleValueWidget({
        title: 'Idempotency Duplicates Prevented',
        metrics: [
          new cloudwatch.Metric({
            namespace: 'Postolio/Publisher',
            metricName: 'DuplicateMessages',
            statistic: 'Sum',
            period: cdk.Duration.days(1),
          }),
        ],
      }),
    )

    // ========================================
    // Stack Outputs
    // ========================================

    new cdk.CfnOutput(this, 'EventBusArn', {
      value: this.eventBus.eventBusArn,
      exportName: `postolio-${environment}-event-bus-arn`,
    })

    new cdk.CfnOutput(this, 'TokenServiceApiUrl', {
      value: this.tokenServiceApi.url,
      exportName: `postolio-${environment}-token-service-url`,
    })

    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${dashboard.dashboardName}`,
      description: 'CloudWatch Dashboard URL',
    })
  }
}