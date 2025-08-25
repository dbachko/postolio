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
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { Construct } from 'constructs'
import * as path from 'path'

export interface MicroservicesStackProps extends cdk.StackProps {
  environment: string
  vpcId?: string
}

export class MicroservicesStack extends cdk.Stack {
  public readonly eventBus: events.EventBus
  public readonly tokenTable: dynamodb.Table
  public readonly scheduleTable: dynamodb.Table
  public readonly tokenServiceApi: apigateway.RestApi
  public readonly publisherQueues: Map<string, sqs.Queue> = new Map()

  constructor(scope: Construct, id: string, props: MicroservicesStackProps) {
    super(scope, id, props)

    const { environment } = props

    // ========================================
    // Core Infrastructure - Week 1
    // ========================================

    // 1. EventBridge Event Bus with Schema Registry
    this.eventBus = new events.EventBus(this, 'PostolioEventBus', {
      eventBusName: `postolio-${environment}-event-bus`,
    })

    // Event Bus Rules will be added as services are created

    // 2. KMS Key for Token Encryption
    const tokenEncryptionKey = new kms.Key(this, 'TokenEncryptionKey', {
      description: 'KMS key for encrypting OAuth tokens',
      alias: `alias/postolio-${environment}-tokens`,
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    // 3. DynamoDB Tables
    
    // Token Table with encryption
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
    })

    // Add GSI for token expiry
    this.tokenTable.addGlobalSecondaryIndex({
      indexName: 'by-expiry',
      partitionKey: {
        name: 'platform',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'expiresAt',
        type: dynamodb.AttributeType.NUMBER,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    })

    // Schedule Table
    this.scheduleTable = new dynamodb.Table(this, 'ScheduleTable', {
      tableName: `postolio-${environment}-schedules`,
      partitionKey: {
        name: 'pk', // SHARD#0-9
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
    })

    // Add GSI for content lookup
    this.scheduleTable.addGlobalSecondaryIndex({
      indexName: 'by-content',
      partitionKey: {
        name: 'contentId',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    })

    // Add GSI for brand lookup
    this.scheduleTable.addGlobalSecondaryIndex({
      indexName: 'by-brand',
      partitionKey: {
        name: 'brandId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'scheduledTime',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    })

    // Job State Table for publisher services
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

    // 4. SQS Queues for Publisher Resilience
    const platforms = ['instagram', 'linkedin', 'facebook', 'tiktok']
    
    platforms.forEach(platform => {
      // Dead Letter Queue
      const dlq = new sqs.Queue(this, `${platform}PublisherDLQ`, {
        queueName: `postolio-${environment}-${platform}-publisher-dlq`,
        retentionPeriod: cdk.Duration.days(14),
      })

      // Main Queue
      const queue = new sqs.Queue(this, `${platform}PublisherQueue`, {
        queueName: `postolio-${environment}-${platform}-publisher`,
        visibilityTimeout: cdk.Duration.minutes(5),
        deadLetterQueue: {
          queue: dlq,
          maxReceiveCount: 3,
        },
      })

      this.publisherQueues.set(platform, queue)
    })

    // ========================================
    // Token Service - Week 2
    // ========================================

    // Token Service Lambda
    const tokenServiceLambda = new NodejsFunction(this, 'TokenServiceLambda', {
      functionName: `postolio-${environment}-token-service`,
      entry: path.join(__dirname, '../../lambdas/token-service/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        TOKEN_TABLE_NAME: this.tokenTable.tableName,
        KMS_KEY_ID: tokenEncryptionKey.keyId,
        ENVIRONMENT: environment,
      },
      tracing: lambda.Tracing.ACTIVE,
    })

    // Grant permissions
    this.tokenTable.grantReadWriteData(tokenServiceLambda)
    tokenEncryptionKey.grantEncryptDecrypt(tokenServiceLambda)

    // Token Service API Gateway
    this.tokenServiceApi = new apigateway.RestApi(this, 'TokenServiceApi', {
      restApiName: `postolio-${environment}-token-service`,
      deployOptions: {
        stageName: environment,
        tracingEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    })

    // API Resources
    const tokens = this.tokenServiceApi.root.addResource('tokens')
    const tokensByUser = tokens.addResource('{userId}')
    const tokenByPlatform = tokensByUser.addResource('{platform}')

    // API Methods with IAM auth
    tokens.addMethod('POST', new apigateway.LambdaIntegration(tokenServiceLambda), {
      authorizationType: apigateway.AuthorizationType.IAM,
    })

    tokenByPlatform.addMethod('GET', new apigateway.LambdaIntegration(tokenServiceLambda), {
      authorizationType: apigateway.AuthorizationType.IAM,
    })

    tokenByPlatform.addMethod('DELETE', new apigateway.LambdaIntegration(tokenServiceLambda), {
      authorizationType: apigateway.AuthorizationType.IAM,
    })

    // Token Rotation Lambda
    const tokenRotationLambda = new NodejsFunction(this, 'TokenRotationLambda', {
      functionName: `postolio-${environment}-token-rotation`,
      entry: path.join(__dirname, '../../lambdas/token-rotation/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: {
        TOKEN_TABLE_NAME: this.tokenTable.tableName,
        KMS_KEY_ID: tokenEncryptionKey.keyId,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        ENVIRONMENT: environment,
      },
      tracing: lambda.Tracing.ACTIVE,
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
    // Scheduler Service - Week 2
    // ========================================

    const schedulerServiceLambda = new NodejsFunction(this, 'SchedulerServiceLambda', {
      functionName: `postolio-${environment}-scheduler-service`,
      entry: path.join(__dirname, '../../lambdas/scheduler-service/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        SCHEDULE_TABLE_NAME: this.scheduleTable.tableName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        ENVIRONMENT: environment,
      },
      tracing: lambda.Tracing.ACTIVE,
    })

    // Grant permissions
    this.scheduleTable.grantReadWriteData(schedulerServiceLambda)
    this.eventBus.grantPutEventsTo(schedulerServiceLambda)

    // Grant EventBridge rule management
    schedulerServiceLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'events:PutRule',
        'events:DeleteRule',
        'events:PutTargets',
        'events:RemoveTargets',
        'events:DescribeRule',
      ],
      resources: [`arn:aws:events:${this.region}:${this.account}:rule/postolio-${environment}-schedule-*`],
    }))

    // ========================================
    // Publisher Services - Week 2-3
    // ========================================

    platforms.forEach(platform => {
      const publisherLambda = new NodejsFunction(this, `${platform}PublisherLambda`, {
        functionName: `postolio-${environment}-${platform}-publisher`,
        entry: path.join(__dirname, `../../lambdas/publishers/${platform}/index.ts`),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.minutes(5),
        memorySize: 1024,
        environment: {
          PLATFORM: platform,
          TOKEN_TABLE_NAME: this.tokenTable.tableName,
          JOB_STATE_TABLE_NAME: jobStateTable.tableName,
          EVENT_BUS_NAME: this.eventBus.eventBusName,
          KMS_KEY_ID: tokenEncryptionKey.keyId,
          ENVIRONMENT: environment,
        },
        tracing: lambda.Tracing.ACTIVE,
      })

      // Grant permissions
      this.tokenTable.grantReadData(publisherLambda)
      jobStateTable.grantReadWriteData(publisherLambda)
      tokenEncryptionKey.grantDecrypt(publisherLambda)
      this.eventBus.grantPutEventsTo(publisherLambda)

      // Connect to SQS queue
      const queue = this.publisherQueues.get(platform)!
      queue.grantConsumeMessages(publisherLambda)

      // Add SQS trigger
      publisherLambda.addEventSource(new cdk.aws_lambda_event_sources.SqsEventSource(queue, {
        batchSize: 10,
        maxBatchingWindow: cdk.Duration.seconds(5),
      }))
    })

    // ========================================
    // Event Rules - Week 4
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
      rule.addTarget(new cdk.aws_events_targets.SqsQueue(queue))
    })

    // Content updated -> Scheduler update
    const contentUpdatedRule = new events.Rule(this, 'ContentUpdatedRule', {
      ruleName: `postolio-${environment}-content-updated`,
      eventBus: this.eventBus,
      eventPattern: {
        source: ['postolio.content'],
        detailType: ['content.updated'],
      },
    })

    contentUpdatedRule.addTarget(new cdk.aws_events_targets.LambdaFunction(schedulerServiceLambda))

    // ========================================
    // Monitoring & Observability - Week 5
    // ========================================

    // CloudWatch Dashboard
    const dashboard = new cloudwatch.Dashboard(this, 'MicroservicesDashboard', {
      dashboardName: `postolio-${environment}-microservices`,
    })

    // Add widgets for each service
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Publisher Lambda Invocations',
        left: platforms.map(platform => 
          new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Invocations',
            dimensionsMap: {
              FunctionName: `postolio-${environment}-${platform}-publisher`,
            },
          })
        ),
      }),
      new cloudwatch.GraphWidget({
        title: 'Token Service API Requests',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Count',
            dimensionsMap: {
              ApiName: `postolio-${environment}-token-service`,
            },
          }),
        ],
      }),
    )

    // CloudWatch Alarms
    platforms.forEach(platform => {
      const dlq = this.publisherQueues.get(platform)!
      
      new cloudwatch.Alarm(this, `${platform}DLQAlarm`, {
        alarmName: `postolio-${environment}-${platform}-dlq-messages`,
        metric: dlq.metricApproximateNumberOfMessagesVisible(),
        threshold: 1,
        evaluationPeriods: 1,
      })
    })

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

    new cdk.CfnOutput(this, 'TokenTableName', {
      value: this.tokenTable.tableName,
      exportName: `postolio-${environment}-token-table`,
    })

    new cdk.CfnOutput(this, 'ScheduleTableName', {
      value: this.scheduleTable.tableName,
      exportName: `postolio-${environment}-schedule-table`,
    })
  }
}