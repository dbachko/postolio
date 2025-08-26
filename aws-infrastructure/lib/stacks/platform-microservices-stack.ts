/**
 * Platform Microservices Stack
 * Production-ready microservices architecture for social media scheduling
 */

import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as kms from 'aws-cdk-lib/aws-kms'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as events from 'aws-cdk-lib/aws-events'
import * as targets from 'aws-cdk-lib/aws-events-targets'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import { Construct } from 'constructs'
import * as path from 'path'

export interface PlatformMicroservicesStackProps extends cdk.StackProps {
  environment: 'dev' | 'staging' | 'prod'
  domainName?: string
  alertEmail?: string
}

export class PlatformMicroservicesStack extends cdk.Stack {
  public readonly tokenServiceApi: apigateway.RestApi
  public readonly eventBus: events.EventBus
  public readonly tokenTable: dynamodb.Table
  public readonly scheduleTable: dynamodb.Table
  
  constructor(scope: Construct, id: string, props: PlatformMicroservicesStackProps) {
    super(scope, id, props)
    
    const { environment, alertEmail } = props
    
    // ==================== KMS Keys ====================
    const tokenEncryptionKey = new kms.Key(this, 'TokenEncryptionKey', {
      description: 'KMS key for encrypting OAuth tokens',
      alias: `postolio-${environment}-token-key`,
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
    })
    
    // ==================== Secrets Manager ====================
    const platformSecrets = new secretsmanager.Secret(this, 'PlatformSecrets', {
      secretName: `postolio/${environment}/platform-credentials`,
      description: 'Platform API credentials for social media integrations',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          FACEBOOK_APP_ID: '',
          FACEBOOK_APP_SECRET: '',
          INSTAGRAM_APP_ID: '',
          INSTAGRAM_APP_SECRET: '',
          LINKEDIN_CLIENT_ID: '',
          LINKEDIN_CLIENT_SECRET: '',
          TIKTOK_CLIENT_KEY: '',
          TIKTOK_CLIENT_SECRET: '',
        }),
        generateStringKey: 'random-key',
      },
    })
    
    // ==================== DynamoDB Tables ====================
    
    // Token Table
    this.tokenTable = new dynamodb.Table(this, 'TokenTable', {
      tableName: `postolio-${environment}-tokens`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
      timeToLiveAttribute: 'ttl',
    })
    
    // Schedule Table with sharding
    this.scheduleTable = new dynamodb.Table(this, 'ScheduleTable', {
      tableName: `postolio-${environment}-schedules`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    })
    
    // Job State Table
    const jobStateTable = new dynamodb.Table(this, 'JobStateTable', {
      tableName: `postolio-${environment}-job-states`,
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    })
    
    // Idempotency Table
    const idempotencyTable = new dynamodb.Table(this, 'IdempotencyTable', {
      tableName: `postolio-${environment}-idempotency`,
      partitionKey: { name: 'idempotencyKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    })
    
    // ==================== EventBridge ====================
    this.eventBus = new events.EventBus(this, 'PlatformEventBus', {
      eventBusName: `postolio-${environment}-platform-events`,
    })
    
    // Event Archive for replay capability
    new events.Archive(this, 'EventArchive', {
      archiveName: `postolio-${environment}-archive`,
      eventPattern: {
        source: ['postolio.publisher', 'postolio.scheduler', 'postolio.token'],
      },
      sourceEventBus: this.eventBus,
      retention: cdk.Duration.days(7),
    })
    
    // ==================== SQS Queues ====================
    
    // Publisher queues with DLQ
    const publisherDLQ = new sqs.Queue(this, 'PublisherDLQ', {
      queueName: `postolio-${environment}-publisher-dlq`,
      retentionPeriod: cdk.Duration.days(14),
    })
    
    const instagramQueue = new sqs.Queue(this, 'InstagramPublisherQueue', {
      queueName: `postolio-${environment}-instagram-publisher`,
      visibilityTimeout: cdk.Duration.seconds(300),
      deadLetterQueue: {
        queue: publisherDLQ,
        maxReceiveCount: 3,
      },
    })
    
    const facebookQueue = new sqs.Queue(this, 'FacebookPublisherQueue', {
      queueName: `postolio-${environment}-facebook-publisher`,
      visibilityTimeout: cdk.Duration.seconds(300),
      deadLetterQueue: {
        queue: publisherDLQ,
        maxReceiveCount: 3,
      },
    })
    
    const linkedinQueue = new sqs.Queue(this, 'LinkedInPublisherQueue', {
      queueName: `postolio-${environment}-linkedin-publisher`,
      visibilityTimeout: cdk.Duration.seconds(300),
      deadLetterQueue: {
        queue: publisherDLQ,
        maxReceiveCount: 3,
      },
    })
    
    const tiktokQueue = new sqs.Queue(this, 'TikTokPublisherQueue', {
      queueName: `postolio-${environment}-tiktok-publisher`,
      visibilityTimeout: cdk.Duration.seconds(300),
      deadLetterQueue: {
        queue: publisherDLQ,
        maxReceiveCount: 3,
      },
    })
    
    // ==================== Lambda Layer ====================
    const sharedLayer = new lambda.LayerVersion(this, 'SharedDependencies', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../../layers/shared')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
      description: 'Shared dependencies for Lambda functions',
    })
    
    // ==================== Common Lambda Environment ====================
    const commonEnv = {
      ENVIRONMENT: environment,
      TOKEN_TABLE_NAME: this.tokenTable.tableName,
      SCHEDULE_TABLE_NAME: this.scheduleTable.tableName,
      JOB_STATE_TABLE_NAME: jobStateTable.tableName,
      IDEMPOTENCY_TABLE_NAME: idempotencyTable.tableName,
      EVENT_BUS_NAME: this.eventBus.eventBusName,
      KMS_KEY_ID: tokenEncryptionKey.keyId,
      AWS_ACCOUNT_ID: this.account,
    }
    
    // ==================== Lambda Functions ====================
    
    // Token Service
    const tokenServiceLambda = new lambdaNode.NodejsFunction(this, 'TokenService', {
      functionName: `postolio-${environment}-token-service`,
      entry: path.join(__dirname, '../lambdas/token-service/index.ts'),
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: commonEnv,
      tracing: lambda.Tracing.ACTIVE,
      layers: [sharedLayer],
      logRetention: logs.RetentionDays.ONE_WEEK,
      reservedConcurrentExecutions: 100,
    })
    
    // Grant permissions
    this.tokenTable.grantReadWriteData(tokenServiceLambda)
    tokenEncryptionKey.grantEncryptDecrypt(tokenServiceLambda)
    platformSecrets.grantRead(tokenServiceLambda)
    
    // Token Rotation (scheduled)
    const tokenRotationLambda = new lambdaNode.NodejsFunction(this, 'TokenRotation', {
      functionName: `postolio-${environment}-token-rotation`,
      entry: path.join(__dirname, '../lambdas/token-rotation/index.ts'),
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: commonEnv,
      tracing: lambda.Tracing.ACTIVE,
      layers: [sharedLayer],
      logRetention: logs.RetentionDays.ONE_WEEK,
    })
    
    this.tokenTable.grantReadWriteData(tokenRotationLambda)
    tokenEncryptionKey.grantEncryptDecrypt(tokenRotationLambda)
    platformSecrets.grantRead(tokenRotationLambda)
    this.eventBus.grantPutEventsTo(tokenRotationLambda)
    
    // Schedule token rotation to run daily
    new events.Rule(this, 'TokenRotationSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.hours(24)),
      targets: [new targets.LambdaFunction(tokenRotationLambda)],
    })
    
    // Scheduler Service
    const schedulerServiceLambda = new lambdaNode.NodejsFunction(this, 'SchedulerService', {
      functionName: `postolio-${environment}-scheduler-service`,
      entry: path.join(__dirname, '../lambdas/scheduler-service/index.ts'),
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        ...commonEnv,
        EVENTS_ROLE_ARN: new iam.Role(this, 'EventBridgeRole', {
          assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
          inlinePolicies: {
            EventBridgePolicy: new iam.PolicyDocument({
              statements: [
                new iam.PolicyStatement({
                  actions: ['events:PutEvents'],
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
    })
    
    this.scheduleTable.grantReadWriteData(schedulerServiceLambda)
    this.eventBus.grantPutEventsTo(schedulerServiceLambda)
    
    // Grant EventBridge permissions
    schedulerServiceLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'scheduler:CreateSchedule',
        'scheduler:DeleteSchedule',
        'scheduler:GetSchedule',
        'scheduler:UpdateSchedule',
        'iam:PassRole',
      ],
      resources: ['*'],
    }))
    
    // Publisher Lambdas
    const createPublisherLambda = (platform: string, queue: sqs.Queue) => {
      const publisherLambda = new lambdaNode.NodejsFunction(this, `${platform}Publisher`, {
        functionName: `postolio-${environment}-${platform.toLowerCase()}-publisher`,
        entry: path.join(__dirname, `../lambdas/publishers/${platform.toLowerCase()}/index.ts`),
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'handler',
        timeout: cdk.Duration.minutes(5),
        memorySize: 1024,
        environment: commonEnv,
        tracing: lambda.Tracing.ACTIVE,
        layers: [sharedLayer],
        logRetention: logs.RetentionDays.ONE_WEEK,
        reservedConcurrentExecutions: 50,
      })
      
      // Permissions
      this.tokenTable.grantReadData(publisherLambda)
      jobStateTable.grantReadWriteData(publisherLambda)
      idempotencyTable.grantReadWriteData(publisherLambda)
      tokenEncryptionKey.grantDecrypt(publisherLambda)
      this.eventBus.grantPutEventsTo(publisherLambda)
      
      // SQS trigger
      publisherLambda.addEventSource(new cdk.aws_lambda_event_sources.SqsEventSource(queue, {
        batchSize: 1,
        maxBatchingWindow: cdk.Duration.seconds(5),
      }))
      
      return publisherLambda
    }
    
    const instagramPublisher = createPublisherLambda('Instagram', instagramQueue)
    const facebookPublisher = createPublisherLambda('Facebook', facebookQueue)
    const linkedinPublisher = createPublisherLambda('LinkedIn', linkedinQueue)
    const tiktokPublisher = createPublisherLambda('TikTok', tiktokQueue)
    
    // ==================== API Gateway ====================
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
    
    // Token endpoints
    const tokens = this.tokenServiceApi.root.addResource('tokens')
    tokens.addMethod('POST', new apigateway.LambdaIntegration(tokenServiceLambda))
    
    const tokenById = tokens.addResource('{userId}').addResource('{platform}')
    tokenById.addMethod('GET', new apigateway.LambdaIntegration(tokenServiceLambda))
    tokenById.addMethod('DELETE', new apigateway.LambdaIntegration(tokenServiceLambda))
    
    // ==================== EventBridge Rules ====================
    
    // Route schedule executions to publisher queues
    new events.Rule(this, 'InstagramScheduleRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['postolio.scheduler'],
        detailType: ['schedule.execute'],
        detail: { platform: ['instagram'] },
      },
      targets: [new targets.SqsQueue(instagramQueue)],
    })
    
    new events.Rule(this, 'FacebookScheduleRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['postolio.scheduler'],
        detailType: ['schedule.execute'],
        detail: { platform: ['facebook'] },
      },
      targets: [new targets.SqsQueue(facebookQueue)],
    })
    
    new events.Rule(this, 'LinkedInScheduleRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['postolio.scheduler'],
        detailType: ['schedule.execute'],
        detail: { platform: ['linkedin'] },
      },
      targets: [new targets.SqsQueue(linkedinQueue)],
    })
    
    new events.Rule(this, 'TikTokScheduleRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['postolio.scheduler'],
        detailType: ['schedule.execute'],
        detail: { platform: ['tiktok'] },
      },
      targets: [new targets.SqsQueue(tiktokQueue)],
    })
    
    // ==================== CloudWatch Alarms ====================
    if (alertEmail) {
      const alarmTopic = new cdk.aws_sns.Topic(this, 'AlarmTopic', {
        displayName: `Postolio ${environment} Alarms`,
      })
      
      alarmTopic.addSubscription(
        new cdk.aws_sns_subscriptions.EmailSubscription(alertEmail)
      )
      
      // DLQ alarm
      new cloudwatch.Alarm(this, 'DLQAlarm', {
        metric: publisherDLQ.metricApproximateNumberOfMessagesVisible(),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: 'Messages in publisher DLQ',
      }).addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(alarmTopic))
      
      // Token rotation errors
      new cloudwatch.Alarm(this, 'TokenRotationErrorAlarm', {
        metric: tokenRotationLambda.metricErrors(),
        threshold: 1,
        evaluationPeriods: 1,
        alarmDescription: 'Token rotation Lambda errors',
      }).addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(alarmTopic))
    }
    
    // ==================== Outputs ====================
    new cdk.CfnOutput(this, 'TokenServiceApiUrl', {
      value: this.tokenServiceApi.url,
      description: 'Token Service API URL',
    })
    
    new cdk.CfnOutput(this, 'EventBusArn', {
      value: this.eventBus.eventBusArn,
      description: 'Platform Event Bus ARN',
    })
    
    new cdk.CfnOutput(this, 'TokenTableName', {
      value: this.tokenTable.tableName,
      description: 'Token DynamoDB Table Name',
    })
    
    new cdk.CfnOutput(this, 'ScheduleTableName', {
      value: this.scheduleTable.tableName,
      description: 'Schedule DynamoDB Table Name',
    })
  }
}