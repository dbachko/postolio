"use strict";
/**
 * Platform Microservices Stack
 * Production-ready microservices architecture for social media scheduling
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlatformMicroservicesStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const kms = __importStar(require("aws-cdk-lib/aws-kms"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const lambdaNode = __importStar(require("aws-cdk-lib/aws-lambda-nodejs"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const sqs = __importStar(require("aws-cdk-lib/aws-sqs"));
const apigateway = __importStar(require("aws-cdk-lib/aws-apigateway"));
const events = __importStar(require("aws-cdk-lib/aws-events"));
const targets = __importStar(require("aws-cdk-lib/aws-events-targets"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const cloudwatch = __importStar(require("aws-cdk-lib/aws-cloudwatch"));
const path = __importStar(require("path"));
const cloudwatch_dashboards_1 = require("../constructs/cloudwatch-dashboards");
const secured_api_gateway_1 = require("../constructs/secured-api-gateway");
const oauth_config_1 = require("../utils/oauth-config");
class PlatformMicroservicesStack extends cdk.Stack {
    tokenServiceApi;
    eventBus;
    tokenTable;
    scheduleTable;
    constructor(scope, id, props) {
        super(scope, id, props);
        const { environment, alertEmail } = props;
        // ==================== KMS Keys ====================
        const tokenEncryptionKey = new kms.Key(this, 'TokenEncryptionKey', {
            description: 'KMS key for encrypting OAuth tokens',
            alias: `postolio-${environment}-token-key`,
            enableKeyRotation: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
        });
        // ==================== DynamoDB Tables ====================
        // Note: Platform secrets are managed via GitHub Secrets and passed as environment variables
        // No need for AWS Secrets Manager for these values
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
        });
        // Schedule Table with sharding and GSIs for efficient lookups
        this.scheduleTable = new dynamodb.Table(this, 'ScheduleTable', {
            tableName: `postolio-${environment}-schedules`,
            partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            pointInTimeRecovery: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            timeToLiveAttribute: 'ttl',
        });
        // Add GSI for schedule ID lookups
        this.scheduleTable.addGlobalSecondaryIndex({
            indexName: 'by-schedule-id',
            partitionKey: { name: 'scheduleId', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        // Add GSI for content ID lookups
        this.scheduleTable.addGlobalSecondaryIndex({
            indexName: 'by-content-id',
            partitionKey: { name: 'contentId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'scheduledAt', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        // Add GSI for brand-based queries
        this.scheduleTable.addGlobalSecondaryIndex({
            indexName: 'by-brand',
            partitionKey: { name: 'brandId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'scheduledAt', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        // Add GSI for platform-based queries
        this.scheduleTable.addGlobalSecondaryIndex({
            indexName: 'by-platform-status',
            partitionKey: { name: 'platform', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'status', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.KEYS_ONLY,
        });
        // Job State Table
        const jobStateTable = new dynamodb.Table(this, 'JobStateTable', {
            tableName: `postolio-${environment}-job-states`,
            partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            timeToLiveAttribute: 'ttl',
        });
        // Idempotency Table
        const idempotencyTable = new dynamodb.Table(this, 'IdempotencyTable', {
            tableName: `postolio-${environment}-idempotency`,
            partitionKey: { name: 'idempotencyKey', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            timeToLiveAttribute: 'ttl',
        });
        // Saga State Table for distributed transactions
        const sagaStateTable = new dynamodb.Table(this, 'SagaStateTable', {
            tableName: `postolio-${environment}-saga-state`,
            partitionKey: { name: 'sagaId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            timeToLiveAttribute: 'ttl',
        });
        // Add GSI for saga type queries
        sagaStateTable.addGlobalSecondaryIndex({
            indexName: 'by-saga-type',
            partitionKey: { name: 'sagaType', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        // Circuit Breaker State Table
        const circuitBreakerTable = new dynamodb.Table(this, 'CircuitBreakerTable', {
            tableName: `postolio-${environment}-circuit-breaker-state`,
            partitionKey: { name: 'serviceName', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            timeToLiveAttribute: 'ttl',
        });
        // ==================== EventBridge ====================
        this.eventBus = new events.EventBus(this, 'PlatformEventBus', {
            eventBusName: `postolio-${environment}-platform-events`,
        });
        // Event Archive for replay capability
        new events.Archive(this, 'EventArchive', {
            archiveName: `postolio-${environment}-archive`,
            eventPattern: {
                source: ['postolio.publisher', 'postolio.scheduler', 'postolio.token'],
            },
            sourceEventBus: this.eventBus,
            retention: cdk.Duration.days(7),
        });
        // ==================== SQS Queues ====================
        // Publisher queues with DLQ
        const publisherDLQ = new sqs.Queue(this, 'PublisherDLQ', {
            queueName: `postolio-${environment}-publisher-dlq`,
            retentionPeriod: cdk.Duration.days(14),
        });
        const instagramQueue = new sqs.Queue(this, 'InstagramPublisherQueue', {
            queueName: `postolio-${environment}-instagram-publisher`,
            visibilityTimeout: cdk.Duration.seconds(300),
            deadLetterQueue: {
                queue: publisherDLQ,
                maxReceiveCount: 3,
            },
        });
        const facebookQueue = new sqs.Queue(this, 'FacebookPublisherQueue', {
            queueName: `postolio-${environment}-facebook-publisher`,
            visibilityTimeout: cdk.Duration.seconds(300),
            deadLetterQueue: {
                queue: publisherDLQ,
                maxReceiveCount: 3,
            },
        });
        const linkedinQueue = new sqs.Queue(this, 'LinkedInPublisherQueue', {
            queueName: `postolio-${environment}-linkedin-publisher`,
            visibilityTimeout: cdk.Duration.seconds(300),
            deadLetterQueue: {
                queue: publisherDLQ,
                maxReceiveCount: 3,
            },
        });
        const tiktokQueue = new sqs.Queue(this, 'TikTokPublisherQueue', {
            queueName: `postolio-${environment}-tiktok-publisher`,
            visibilityTimeout: cdk.Duration.seconds(300),
            deadLetterQueue: {
                queue: publisherDLQ,
                maxReceiveCount: 3,
            },
        });
        // ==================== Rate Limit Table ====================
        const rateLimitTable = new dynamodb.Table(this, 'RateLimitTable', {
            tableName: `postolio-rate-limits-${environment}`,
            partitionKey: { name: 'bucketKey', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            timeToLiveAttribute: 'ttl',
        });
        // ==================== Lambda Layer ====================
        const sharedLayer = new lambda.LayerVersion(this, 'SharedDependencies', {
            code: lambda.Code.fromAsset(path.join(__dirname, '../../layers/shared')),
            compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
            description: 'Shared dependencies for Lambda functions',
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
            ...(0, oauth_config_1.getOAuthEnvironmentVariables)(props),
        };
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
            reservedConcurrentExecutions: 500, // Increased from 100 to handle higher throughput
        });
        // Grant permissions
        this.tokenTable.grantReadWriteData(tokenServiceLambda);
        rateLimitTable.grantReadWriteData(tokenServiceLambda);
        tokenEncryptionKey.grantEncryptDecrypt(tokenServiceLambda);
        // Platform secrets are passed as environment variables from GitHub Secrets
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
        });
        this.tokenTable.grantReadWriteData(tokenRotationLambda);
        tokenEncryptionKey.grantEncryptDecrypt(tokenRotationLambda);
        // Platform secrets are passed as environment variables from GitHub Secrets
        this.eventBus.grantPutEventsTo(tokenRotationLambda);
        // Schedule token rotation to run daily
        new events.Rule(this, 'TokenRotationSchedule', {
            schedule: events.Schedule.rate(cdk.Duration.hours(24)),
            targets: [new targets.LambdaFunction(tokenRotationLambda)],
        });
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
        });
        this.scheduleTable.grantReadWriteData(schedulerServiceLambda);
        this.eventBus.grantPutEventsTo(schedulerServiceLambda);
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
        }));
        // Publisher Lambdas
        const createPublisherLambda = (platform, queue) => {
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
                reservedConcurrentExecutions: 200, // Increased from 50 to handle concurrent publishing
            });
            // Permissions
            this.tokenTable.grantReadData(publisherLambda);
            jobStateTable.grantReadWriteData(publisherLambda);
            idempotencyTable.grantReadWriteData(publisherLambda);
            tokenEncryptionKey.grantDecrypt(publisherLambda);
            this.eventBus.grantPutEventsTo(publisherLambda);
            // SQS trigger
            publisherLambda.addEventSource(new cdk.aws_lambda_event_sources.SqsEventSource(queue, {
                batchSize: 1,
                maxBatchingWindow: cdk.Duration.seconds(5),
            }));
            return publisherLambda;
        };
        const instagramPublisher = createPublisherLambda('Instagram', instagramQueue);
        const facebookPublisher = createPublisherLambda('Facebook', facebookQueue);
        const linkedinPublisher = createPublisherLambda('LinkedIn', linkedinQueue);
        const tiktokPublisher = createPublisherLambda('TikTok', tiktokQueue);
        // ==================== Secured API Gateway ====================
        const securedApi = new secured_api_gateway_1.SecuredApiGateway(this, 'SecuredApiGateway', {
            environment,
            serviceName: 'platform',
            lambdaIntegrations: {
                'tokens': {
                    lambda: tokenServiceLambda,
                    methods: ['POST'],
                    authType: 'IAM',
                    throttle: {
                        burstLimit: 100,
                        rateLimit: 50,
                    },
                },
                'tokens/{userId}/{platform}': {
                    lambda: tokenServiceLambda,
                    methods: ['GET', 'DELETE'],
                    authType: 'IAM',
                    throttle: {
                        burstLimit: 50,
                        rateLimit: 25,
                    },
                },
                'schedules': {
                    lambda: schedulerServiceLambda,
                    methods: ['POST', 'GET'],
                    authType: 'IAM',
                    throttle: {
                        burstLimit: 200,
                        rateLimit: 100,
                    },
                },
                'schedules/{scheduleId}': {
                    lambda: schedulerServiceLambda,
                    methods: ['GET', 'DELETE', 'PATCH'],
                    authType: 'IAM',
                    throttle: {
                        burstLimit: 100,
                        rateLimit: 50,
                    },
                },
            },
            enableWaf: environment === 'prod',
            enableApiKey: true,
            enableUsagePlan: true,
            corsConfig: {
                allowOrigins: environment === 'prod'
                    ? [props.domainName ? `https://${props.domainName}` : 'https://postolio.example']
                    : apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: [
                    'Content-Type',
                    'X-Amz-Date',
                    'Authorization',
                    'X-Api-Key',
                    'X-Amz-Security-Token',
                    'X-User-Id',
                    'X-User-Tier',
                    'X-Correlation-Id',
                    'X-Brand-Id',
                ],
                maxAge: cdk.Duration.hours(1),
            },
        });
        // Store API reference for other stacks
        this.tokenServiceApi = securedApi.api;
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
        });
        new events.Rule(this, 'FacebookScheduleRule', {
            eventBus: this.eventBus,
            eventPattern: {
                source: ['postolio.scheduler'],
                detailType: ['schedule.execute'],
                detail: { platform: ['facebook'] },
            },
            targets: [new targets.SqsQueue(facebookQueue)],
        });
        new events.Rule(this, 'LinkedInScheduleRule', {
            eventBus: this.eventBus,
            eventPattern: {
                source: ['postolio.scheduler'],
                detailType: ['schedule.execute'],
                detail: { platform: ['linkedin'] },
            },
            targets: [new targets.SqsQueue(linkedinQueue)],
        });
        new events.Rule(this, 'TikTokScheduleRule', {
            eventBus: this.eventBus,
            eventPattern: {
                source: ['postolio.scheduler'],
                detailType: ['schedule.execute'],
                detail: { platform: ['tiktok'] },
            },
            targets: [new targets.SqsQueue(tiktokQueue)],
        });
        // ==================== DLQ Processing Infrastructure ====================
        // DLQ Processing State Table
        const dlqStateTable = new dynamodb.Table(this, 'DLQStateTable', {
            tableName: `postolio-dlq-state-${environment}`,
            partitionKey: { name: 'messageId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            pointInTimeRecovery: true,
            stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
            timeToLiveAttribute: 'ttl',
        });
        // GSI for querying by DLQ and status
        dlqStateTable.addGlobalSecondaryIndex({
            indexName: 'by-dlq-status',
            partitionKey: { name: 'dlqName', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'status', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        // DLQ Processor Lambda
        const dlqProcessorLambda = new lambda.Function(this, 'DLQProcessorLambda', {
            functionName: `postolio-dlq-processor-${environment}`,
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('./lib/lambdas/dlq-processor'),
            environment: {
                DLQ_STATE_TABLE_NAME: dlqStateTable.tableName,
                PUBLISHER_QUEUE_URL: instagramQueue.queueUrl,
                SCHEDULER_QUEUE_URL: '', // Will be added when scheduler queue is created
                TOKEN_REFRESH_QUEUE_URL: '', // Will be added when token refresh queue is created
                ANALYTICS_QUEUE_URL: '', // Will be added when analytics queue is created
                SQS_BASE_URL: `https://sqs.${cdk.Stack.of(this).region}.amazonaws.com/${cdk.Stack.of(this).account}`,
                DLQ_MAX_RETRIES: '5',
                DLQ_RETRY_DELAY_BASE: '60000',
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
        const dlqProcessingRule = new events.Rule(this, 'DLQProcessingRule', {
            schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
            description: 'Process messages from Dead Letter Queues',
        });
        dlqProcessingRule.addTarget(new targets.LambdaFunction(dlqProcessorLambda));
        // Manual reprocess Lambda
        const dlqReprocessLambda = new lambda.Function(this, 'DLQReprocessLambda', {
            functionName: `postolio-dlq-reprocess-${environment}`,
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.reprocessHandler',
            code: lambda.Code.fromAsset('./lib/lambdas/dlq-processor'),
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
        let alarmTopic;
        if (alertEmail) {
            alarmTopic = new cdk.aws_sns.Topic(this, 'AlarmTopic', {
                displayName: `Postolio ${environment} Alarms`,
            });
            alarmTopic.addSubscription(new cdk.aws_sns_subscriptions.EmailSubscription(alertEmail));
            // Grant DLQ processor permission to publish alerts
            alarmTopic.grantPublish(dlqProcessorLambda);
            // Add alarm topic ARN to DLQ processor environment
            dlqProcessorLambda.addEnvironment('DLQ_ALERT_TOPIC_ARN', alarmTopic.topicArn);
            // DLQ alarm
            new cloudwatch.Alarm(this, 'DLQAlarm', {
                metric: publisherDLQ.metricApproximateNumberOfMessagesVisible(),
                threshold: 1,
                evaluationPeriods: 1,
                alarmDescription: 'Messages in publisher DLQ',
            }).addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(alarmTopic));
            // Token rotation errors
            new cloudwatch.Alarm(this, 'TokenRotationErrorAlarm', {
                metric: tokenRotationLambda.metricErrors(),
                threshold: 1,
                evaluationPeriods: 1,
                alarmDescription: 'Token rotation Lambda errors',
            }).addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(alarmTopic));
        }
        // ==================== CloudWatch Dashboards ====================
        const dashboards = new cloudwatch_dashboards_1.CloudWatchDashboards(this, 'Dashboards', {
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
        new cdk.CfnOutput(this, 'TokenServiceApiUrl', {
            value: this.tokenServiceApi.url,
            description: 'Token Service API URL',
        });
        new cdk.CfnOutput(this, 'EventBusArn', {
            value: this.eventBus.eventBusArn,
            description: 'Platform Event Bus ARN',
        });
        new cdk.CfnOutput(this, 'TokenTableName', {
            value: this.tokenTable.tableName,
            description: 'Token DynamoDB Table Name',
        });
        new cdk.CfnOutput(this, 'ScheduleTableName', {
            value: this.scheduleTable.tableName,
            description: 'Schedule DynamoDB Table Name',
        });
    }
}
exports.PlatformMicroservicesStack = PlatformMicroservicesStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGxhdGZvcm0tbWljcm9zZXJ2aWNlcy1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInBsYXRmb3JtLW1pY3Jvc2VydmljZXMtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7R0FHRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBRUgsaURBQWtDO0FBQ2xDLG1FQUFvRDtBQUNwRCx5REFBMEM7QUFDMUMsK0RBQWdEO0FBQ2hELDBFQUEyRDtBQUMzRCx5REFBMEM7QUFDMUMseURBQTBDO0FBQzFDLHVFQUF3RDtBQUN4RCwrREFBZ0Q7QUFDaEQsd0VBQXlEO0FBQ3pELDJEQUE0QztBQUM1Qyx1RUFBd0Q7QUFFeEQsMkNBQTRCO0FBQzVCLCtFQUEwRTtBQUMxRSwyRUFBcUU7QUFDckUsd0RBQXNGO0FBUXRGLE1BQWEsMEJBQTJCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDdkMsZUFBZSxDQUFvQjtJQUNuQyxRQUFRLENBQWlCO0lBQ3pCLFVBQVUsQ0FBZ0I7SUFDMUIsYUFBYSxDQUFnQjtJQUU3QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNDO1FBQzlFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFBO1FBRXZCLE1BQU0sRUFBRSxXQUFXLEVBQUUsVUFBVSxFQUFFLEdBQUcsS0FBSyxDQUFBO1FBRXpDLHFEQUFxRDtRQUNyRCxNQUFNLGtCQUFrQixHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUU7WUFDakUsV0FBVyxFQUFFLHFDQUFxQztZQUNsRCxLQUFLLEVBQUUsWUFBWSxXQUFXLFlBQVk7WUFDMUMsaUJBQWlCLEVBQUUsSUFBSTtZQUN2QixhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPLEVBQUUsa0NBQWtDO1NBQzdFLENBQUMsQ0FBQTtRQUVGLDREQUE0RDtRQUM1RCw0RkFBNEY7UUFDNUYs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QyxTQUFTLENBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFO1lBQzVDLEtBQUssRUFBRSxJQUFJLENBQUMsZUFBZSxDQUFDLEdBQUc7WUFDL0IsV0FBVyxFQUFFLHVCQUF1QjtTQUNyQyxDQUFDLENBQUE7UUFFRixJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRTtZQUNyQyxLQUFLLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxXQUFXO1lBQ2hDLFdBQVcsRUFBRSx3QkFBd0I7U0FDdEMsQ0FBQyxDQUFBO1FBRUYsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUN4QyxLQUFLLEVBQUUsSUFBSSxDQUFDLFVBQVUsQ0FBQyxTQUFTO1lBQ2hDLFdBQVcsRUFBRSwyQkFBMkI7U0FDekMsQ0FBQyxDQUFBO1FBRUYsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRTtZQUMzQyxLQUFLLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxTQUFTO1lBQ25DLFdBQVcsRUFBRSw4QkFBOEI7U0FDNUMsQ0FBQyxDQUFBO0lBQ0osQ0FBQztDQUNGO0FBNW1CRCxnRUE0bUJDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBQbGF0Zm9ybSBNaWNyb3NlcnZpY2VzIFN0YWNrXG4gKiBQcm9kdWN0aW9uLXJlYWR5IG1pY3Jvc2VydmljZXMgYXJjaGl0ZWN0dXJlIGZvciBzb2NpYWwgbWVkaWEgc2NoZWR1bGluZ1xuICovXG5cbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYidcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYidcbmltcG9ydCAqIGFzIGttcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mta21zJ1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnXG5pbXBvcnQgKiBhcyBsYW1iZGFOb2RlIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzJ1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nXG5pbXBvcnQgKiBhcyBzcXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNxcydcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknXG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cydcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJ1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncydcbmltcG9ydCAqIGFzIGNsb3Vkd2F0Y2ggZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gnXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJ1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJ1xuaW1wb3J0IHsgQ2xvdWRXYXRjaERhc2hib2FyZHMgfSBmcm9tICcuLi9jb25zdHJ1Y3RzL2Nsb3Vkd2F0Y2gtZGFzaGJvYXJkcydcbmltcG9ydCB7IFNlY3VyZWRBcGlHYXRld2F5IH0gZnJvbSAnLi4vY29uc3RydWN0cy9zZWN1cmVkLWFwaS1nYXRld2F5J1xuaW1wb3J0IHsgZ2V0T0F1dGhFbnZpcm9ubWVudFZhcmlhYmxlcywgdHlwZSBPQXV0aENvbmZpZyB9IGZyb20gJy4uL3V0aWxzL29hdXRoLWNvbmZpZydcblxuZXhwb3J0IGludGVyZmFjZSBQbGF0Zm9ybU1pY3Jvc2VydmljZXNTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMsIE9BdXRoQ29uZmlnIHtcbiAgZW52aXJvbm1lbnQ6ICdkZXYnIHwgJ3N0YWdpbmcnIHwgJ3Byb2QnXG4gIGRvbWFpbk5hbWU/OiBzdHJpbmdcbiAgYWxlcnRFbWFpbD86IHN0cmluZ1xufVxuXG5leHBvcnQgY2xhc3MgUGxhdGZvcm1NaWNyb3NlcnZpY2VzU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgdG9rZW5TZXJ2aWNlQXBpOiBhcGlnYXRld2F5LlJlc3RBcGlcbiAgcHVibGljIHJlYWRvbmx5IGV2ZW50QnVzOiBldmVudHMuRXZlbnRCdXNcbiAgcHVibGljIHJlYWRvbmx5IHRva2VuVGFibGU6IGR5bmFtb2RiLlRhYmxlXG4gIHB1YmxpYyByZWFkb25seSBzY2hlZHVsZVRhYmxlOiBkeW5hbW9kYi5UYWJsZVxuICBcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IFBsYXRmb3JtTWljcm9zZXJ2aWNlc1N0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKVxuICAgIFxuICAgIGNvbnN0IHsgZW52aXJvbm1lbnQsIGFsZXJ0RW1haWwgfSA9IHByb3BzXG4gICAgXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT0gS01TIEtleXMgPT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCB0b2tlbkVuY3J5cHRpb25LZXkgPSBuZXcga21zLktleSh0aGlzLCAnVG9rZW5FbmNyeXB0aW9uS2V5Jywge1xuICAgICAgZGVzY3JpcHRpb246ICdLTVMga2V5IGZvciBlbmNyeXB0aW5nIE9BdXRoIHRva2VucycsXG4gICAgICBhbGlhczogYHBvc3RvbGlvLSR7ZW52aXJvbm1lbnR9LXRva2VuLWtleWAsXG4gICAgICBlbmFibGVLZXlSb3RhdGlvbjogdHJ1ZSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksIC8vIENoYW5nZSB0byBSRVRBSU4gZm9yIHByb2R1Y3Rpb25cbiAgICB9KVxuICAgIFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09IER5bmFtb0RCIFRhYmxlcyA9PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIE5vdGU6IFBsYXRmb3JtIHNlY3JldHMgYXJlIG1hbmFnZWQgdmlhIEdpdEh1YiBTZWNyZXRzIGFuZCBwYXNzZWQgYXMgZW52aXJvbm1lbnQgdmFyaWFibGVzXG4gICAgLy8gTm8gbmVlZCBmb3IgQVdTIFNlY3JldHMgTWFuYWdlciBmb3IgdGhlc2UgdmFsdWVzXG4gICAgXG4gICAgLy8gVG9rZW4gVGFibGVcbiAgICB0aGlzLnRva2VuVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1Rva2VuVGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6IGBwb3N0b2xpby0ke2Vudmlyb25tZW50fS10b2tlbnNgLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdwaycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdzaycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkFXU19NQU5BR0VELFxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksIC8vIENoYW5nZSB0byBSRVRBSU4gZm9yIHByb2R1Y3Rpb25cbiAgICAgIHRpbWVUb0xpdmVBdHRyaWJ1dGU6ICd0dGwnLFxuICAgIH0pXG4gICAgXG4gICAgLy8gU2NoZWR1bGUgVGFibGUgd2l0aCBzaGFyZGluZyBhbmQgR1NJcyBmb3IgZWZmaWNpZW50IGxvb2t1cHNcbiAgICB0aGlzLnNjaGVkdWxlVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1NjaGVkdWxlVGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6IGBwb3N0b2xpby0ke2Vudmlyb25tZW50fS1zY2hlZHVsZXNgLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdwaycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdzaycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkFXU19NQU5BR0VELFxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiAndHRsJyxcbiAgICB9KVxuICAgIFxuICAgIC8vIEFkZCBHU0kgZm9yIHNjaGVkdWxlIElEIGxvb2t1cHNcbiAgICB0aGlzLnNjaGVkdWxlVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnYnktc2NoZWR1bGUtaWQnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdzY2hlZHVsZUlkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5BTEwsXG4gICAgfSlcbiAgICBcbiAgICAvLyBBZGQgR1NJIGZvciBjb250ZW50IElEIGxvb2t1cHNcbiAgICB0aGlzLnNjaGVkdWxlVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnYnktY29udGVudC1pZCcsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2NvbnRlbnRJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdzY2hlZHVsZWRBdCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxuICAgIH0pXG4gICAgXG4gICAgLy8gQWRkIEdTSSBmb3IgYnJhbmQtYmFzZWQgcXVlcmllc1xuICAgIHRoaXMuc2NoZWR1bGVUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICdieS1icmFuZCcsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2JyYW5kSWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgc29ydEtleTogeyBuYW1lOiAnc2NoZWR1bGVkQXQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcbiAgICB9KVxuICAgIFxuICAgIC8vIEFkZCBHU0kgZm9yIHBsYXRmb3JtLWJhc2VkIHF1ZXJpZXNcbiAgICB0aGlzLnNjaGVkdWxlVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnYnktcGxhdGZvcm0tc3RhdHVzJyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAncGxhdGZvcm0nLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgc29ydEtleTogeyBuYW1lOiAnc3RhdHVzJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5LRVlTX09OTFksXG4gICAgfSlcbiAgICBcbiAgICAvLyBKb2IgU3RhdGUgVGFibGVcbiAgICBjb25zdCBqb2JTdGF0ZVRhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdKb2JTdGF0ZVRhYmxlJywge1xuICAgICAgdGFibGVOYW1lOiBgcG9zdG9saW8tJHtlbnZpcm9ubWVudH0tam9iLXN0YXRlc2AsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2pvYklkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQVdTX01BTkFHRUQsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsXG4gICAgfSlcbiAgICBcbiAgICAvLyBJZGVtcG90ZW5jeSBUYWJsZVxuICAgIGNvbnN0IGlkZW1wb3RlbmN5VGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ0lkZW1wb3RlbmN5VGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6IGBwb3N0b2xpby0ke2Vudmlyb25tZW50fS1pZGVtcG90ZW5jeWAsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2lkZW1wb3RlbmN5S2V5JywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQVdTX01BTkFHRUQsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsXG4gICAgfSlcbiAgICBcbiAgICAvLyBTYWdhIFN0YXRlIFRhYmxlIGZvciBkaXN0cmlidXRlZCB0cmFuc2FjdGlvbnNcbiAgICBjb25zdCBzYWdhU3RhdGVUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnU2FnYVN0YXRlVGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6IGBwb3N0b2xpby0ke2Vudmlyb25tZW50fS1zYWdhLXN0YXRlYCxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnc2FnYUlkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQVdTX01BTkFHRUQsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsXG4gICAgfSlcbiAgICBcbiAgICAvLyBBZGQgR1NJIGZvciBzYWdhIHR5cGUgcXVlcmllc1xuICAgIHNhZ2FTdGF0ZVRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogJ2J5LXNhZ2EtdHlwZScsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3NhZ2FUeXBlJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ2NyZWF0ZWRBdCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxuICAgIH0pXG4gICAgXG4gICAgLy8gQ2lyY3VpdCBCcmVha2VyIFN0YXRlIFRhYmxlXG4gICAgY29uc3QgY2lyY3VpdEJyZWFrZXJUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnQ2lyY3VpdEJyZWFrZXJUYWJsZScsIHtcbiAgICAgIHRhYmxlTmFtZTogYHBvc3RvbGlvLSR7ZW52aXJvbm1lbnR9LWNpcmN1aXQtYnJlYWtlci1zdGF0ZWAsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3NlcnZpY2VOYW1lJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQVdTX01BTkFHRUQsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsXG4gICAgfSlcbiAgICBcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PSBFdmVudEJyaWRnZSA9PT09PT09PT09PT09PT09PT09PVxuICAgIHRoaXMuZXZlbnRCdXMgPSBuZXcgZXZlbnRzLkV2ZW50QnVzKHRoaXMsICdQbGF0Zm9ybUV2ZW50QnVzJywge1xuICAgICAgZXZlbnRCdXNOYW1lOiBgcG9zdG9saW8tJHtlbnZpcm9ubWVudH0tcGxhdGZvcm0tZXZlbnRzYCxcbiAgICB9KVxuICAgIFxuICAgIC8vIEV2ZW50IEFyY2hpdmUgZm9yIHJlcGxheSBjYXBhYmlsaXR5XG4gICAgbmV3IGV2ZW50cy5BcmNoaXZlKHRoaXMsICdFdmVudEFyY2hpdmUnLCB7XG4gICAgICBhcmNoaXZlTmFtZTogYHBvc3RvbGlvLSR7ZW52aXJvbm1lbnR9LWFyY2hpdmVgLFxuICAgICAgZXZlbnRQYXR0ZXJuOiB7XG4gICAgICAgIHNvdXJjZTogWydwb3N0b2xpby5wdWJsaXNoZXInLCAncG9zdG9saW8uc2NoZWR1bGVyJywgJ3Bvc3RvbGlvLnRva2VuJ10sXG4gICAgICB9LFxuICAgICAgc291cmNlRXZlbnRCdXM6IHRoaXMuZXZlbnRCdXMsXG4gICAgICByZXRlbnRpb246IGNkay5EdXJhdGlvbi5kYXlzKDcpLFxuICAgIH0pXG4gICAgXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT0gU1FTIFF1ZXVlcyA9PT09PT09PT09PT09PT09PT09PVxuICAgIFxuICAgIC8vIFB1Ymxpc2hlciBxdWV1ZXMgd2l0aCBETFFcbiAgICBjb25zdCBwdWJsaXNoZXJETFEgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsICdQdWJsaXNoZXJETFEnLCB7XG4gICAgICBxdWV1ZU5hbWU6IGBwb3N0b2xpby0ke2Vudmlyb25tZW50fS1wdWJsaXNoZXItZGxxYCxcbiAgICAgIHJldGVudGlvblBlcmlvZDogY2RrLkR1cmF0aW9uLmRheXMoMTQpLFxuICAgIH0pXG4gICAgXG4gICAgY29uc3QgaW5zdGFncmFtUXVldWUgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsICdJbnN0YWdyYW1QdWJsaXNoZXJRdWV1ZScsIHtcbiAgICAgIHF1ZXVlTmFtZTogYHBvc3RvbGlvLSR7ZW52aXJvbm1lbnR9LWluc3RhZ3JhbS1wdWJsaXNoZXJgLFxuICAgICAgdmlzaWJpbGl0eVRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwMCksXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IHtcbiAgICAgICAgcXVldWU6IHB1Ymxpc2hlckRMUSxcbiAgICAgICAgbWF4UmVjZWl2ZUNvdW50OiAzLFxuICAgICAgfSxcbiAgICB9KVxuICAgIFxuICAgIGNvbnN0IGZhY2Vib29rUXVldWUgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsICdGYWNlYm9va1B1Ymxpc2hlclF1ZXVlJywge1xuICAgICAgcXVldWVOYW1lOiBgcG9zdG9saW8tJHtlbnZpcm9ubWVudH0tZmFjZWJvb2stcHVibGlzaGVyYCxcbiAgICAgIHZpc2liaWxpdHlUaW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMDApLFxuICAgICAgZGVhZExldHRlclF1ZXVlOiB7XG4gICAgICAgIHF1ZXVlOiBwdWJsaXNoZXJETFEsXG4gICAgICAgIG1heFJlY2VpdmVDb3VudDogMyxcbiAgICAgIH0sXG4gICAgfSlcbiAgICBcbiAgICBjb25zdCBsaW5rZWRpblF1ZXVlID0gbmV3IHNxcy5RdWV1ZSh0aGlzLCAnTGlua2VkSW5QdWJsaXNoZXJRdWV1ZScsIHtcbiAgICAgIHF1ZXVlTmFtZTogYHBvc3RvbGlvLSR7ZW52aXJvbm1lbnR9LWxpbmtlZGluLXB1Ymxpc2hlcmAsXG4gICAgICB2aXNpYmlsaXR5VGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzAwKSxcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZToge1xuICAgICAgICBxdWV1ZTogcHVibGlzaGVyRExRLFxuICAgICAgICBtYXhSZWNlaXZlQ291bnQ6IDMsXG4gICAgICB9LFxuICAgIH0pXG4gICAgXG4gICAgY29uc3QgdGlrdG9rUXVldWUgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsICdUaWtUb2tQdWJsaXNoZXJRdWV1ZScsIHtcbiAgICAgIHF1ZXVlTmFtZTogYHBvc3RvbGlvLSR7ZW52aXJvbm1lbnR9LXRpa3Rvay1wdWJsaXNoZXJgLFxuICAgICAgdmlzaWJpbGl0eVRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwMCksXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IHtcbiAgICAgICAgcXVldWU6IHB1Ymxpc2hlckRMUSxcbiAgICAgICAgbWF4UmVjZWl2ZUNvdW50OiAzLFxuICAgICAgfSxcbiAgICB9KVxuICAgIFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09IFJhdGUgTGltaXQgVGFibGUgPT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCByYXRlTGltaXRUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnUmF0ZUxpbWl0VGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6IGBwb3N0b2xpby1yYXRlLWxpbWl0cy0ke2Vudmlyb25tZW50fWAsXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ2J1Y2tldEtleScsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIHRpbWVUb0xpdmVBdHRyaWJ1dGU6ICd0dGwnLFxuICAgIH0pXG4gICAgXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT0gTGFtYmRhIExheWVyID09PT09PT09PT09PT09PT09PT09XG4gICAgY29uc3Qgc2hhcmVkTGF5ZXIgPSBuZXcgbGFtYmRhLkxheWVyVmVyc2lvbih0aGlzLCAnU2hhcmVkRGVwZW5kZW5jaWVzJywge1xuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi8uLi9sYXllcnMvc2hhcmVkJykpLFxuICAgICAgY29tcGF0aWJsZVJ1bnRpbWVzOiBbbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1hdLFxuICAgICAgZGVzY3JpcHRpb246ICdTaGFyZWQgZGVwZW5kZW5jaWVzIGZvciBMYW1iZGEgZnVuY3Rpb25zJyxcbiAgICB9KVxuICAgIFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09IENvbW1vbiBMYW1iZGEgRW52aXJvbm1lbnQgPT09PT09PT09PT09PT09PT09PT1cbiAgICBjb25zdCBjb21tb25FbnYgPSB7XG4gICAgICBFTlZJUk9OTUVOVDogZW52aXJvbm1lbnQsXG4gICAgICBUT0tFTl9UQUJMRV9OQU1FOiB0aGlzLnRva2VuVGFibGUudGFibGVOYW1lLFxuICAgICAgU0NIRURVTEVfVEFCTEVfTkFNRTogdGhpcy5zY2hlZHVsZVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgIEpPQl9TVEFURV9UQUJMRV9OQU1FOiBqb2JTdGF0ZVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgIElERU1QT1RFTkNZX1RBQkxFX05BTUU6IGlkZW1wb3RlbmN5VGFibGUudGFibGVOYW1lLFxuICAgICAgRVZFTlRfQlVTX05BTUU6IHRoaXMuZXZlbnRCdXMuZXZlbnRCdXNOYW1lLFxuICAgICAgS01TX0tFWV9JRDogdG9rZW5FbmNyeXB0aW9uS2V5LmtleUlkLFxuICAgICAgUkFURV9MSU1JVF9UQUJMRV9OQU1FOiBgcG9zdG9saW8tcmF0ZS1saW1pdHMtJHtlbnZpcm9ubWVudH1gLFxuICAgICAgQVdTX0FDQ09VTlRfSUQ6IHRoaXMuYWNjb3VudCxcbiAgICAgIFxuICAgICAgLy8gT0F1dGggY3JlZGVudGlhbHMgZnJvbSBzaGFyZWQgdXRpbGl0eVxuICAgICAgLi4uZ2V0T0F1dGhFbnZpcm9ubWVudFZhcmlhYmxlcyhwcm9wcyksXG4gICAgfVxuICAgIFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09IExhbWJkYSBGdW5jdGlvbnMgPT09PT09PT09PT09PT09PT09PT1cbiAgICBcbiAgICAvLyBUb2tlbiBTZXJ2aWNlXG4gICAgY29uc3QgdG9rZW5TZXJ2aWNlTGFtYmRhID0gbmV3IGxhbWJkYU5vZGUuTm9kZWpzRnVuY3Rpb24odGhpcywgJ1Rva2VuU2VydmljZScsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogYHBvc3RvbGlvLSR7ZW52aXJvbm1lbnR9LXRva2VuLXNlcnZpY2VgLFxuICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9sYW1iZGFzL3Rva2VuLXNlcnZpY2UvaW5kZXgudHMnKSxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgaGFuZGxlcjogJ2hhbmRsZXInLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgbWVtb3J5U2l6ZTogNTEyLFxuICAgICAgZW52aXJvbm1lbnQ6IGNvbW1vbkVudixcbiAgICAgIHRyYWNpbmc6IGxhbWJkYS5UcmFjaW5nLkFDVElWRSxcbiAgICAgIGxheWVyczogW3NoYXJlZExheWVyXSxcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgcmVzZXJ2ZWRDb25jdXJyZW50RXhlY3V0aW9uczogNTAwLCAvLyBJbmNyZWFzZWQgZnJvbSAxMDAgdG8gaGFuZGxlIGhpZ2hlciB0aHJvdWdocHV0XG4gICAgfSlcbiAgICBcbiAgICAvLyBHcmFudCBwZXJtaXNzaW9uc1xuICAgIHRoaXMudG9rZW5UYWJsZS5ncmFudFJlYWRXcml0ZURhdGEodG9rZW5TZXJ2aWNlTGFtYmRhKVxuICAgIHJhdGVMaW1pdFRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YSh0b2tlblNlcnZpY2VMYW1iZGEpXG4gICAgdG9rZW5FbmNyeXB0aW9uS2V5LmdyYW50RW5jcnlwdERlY3J5cHQodG9rZW5TZXJ2aWNlTGFtYmRhKVxuICAgIC8vIFBsYXRmb3JtIHNlY3JldHMgYXJlIHBhc3NlZCBhcyBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZnJvbSBHaXRIdWIgU2VjcmV0c1xuICAgIFxuICAgIC8vIFRva2VuIFJvdGF0aW9uIChzY2hlZHVsZWQpXG4gICAgY29uc3QgdG9rZW5Sb3RhdGlvbkxhbWJkYSA9IG5ldyBsYW1iZGFOb2RlLk5vZGVqc0Z1bmN0aW9uKHRoaXMsICdUb2tlblJvdGF0aW9uJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgcG9zdG9saW8tJHtlbnZpcm9ubWVudH0tdG9rZW4tcm90YXRpb25gLFxuICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9sYW1iZGFzL3Rva2VuLXJvdGF0aW9uL2luZGV4LnRzJyksXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGhhbmRsZXI6ICdoYW5kbGVyJyxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgbWVtb3J5U2l6ZTogMTAyNCxcbiAgICAgIGVudmlyb25tZW50OiBjb21tb25FbnYsXG4gICAgICB0cmFjaW5nOiBsYW1iZGEuVHJhY2luZy5BQ1RJVkUsXG4gICAgICBsYXllcnM6IFtzaGFyZWRMYXllcl0sXG4gICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICB9KVxuICAgIFxuICAgIHRoaXMudG9rZW5UYWJsZS5ncmFudFJlYWRXcml0ZURhdGEodG9rZW5Sb3RhdGlvbkxhbWJkYSlcbiAgICB0b2tlbkVuY3J5cHRpb25LZXkuZ3JhbnRFbmNyeXB0RGVjcnlwdCh0b2tlblJvdGF0aW9uTGFtYmRhKVxuICAgIC8vIFBsYXRmb3JtIHNlY3JldHMgYXJlIHBhc3NlZCBhcyBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZnJvbSBHaXRIdWIgU2VjcmV0c1xuICAgIHRoaXMuZXZlbnRCdXMuZ3JhbnRQdXRFdmVudHNUbyh0b2tlblJvdGF0aW9uTGFtYmRhKVxuICAgIFxuICAgIC8vIFNjaGVkdWxlIHRva2VuIHJvdGF0aW9uIHRvIHJ1biBkYWlseVxuICAgIG5ldyBldmVudHMuUnVsZSh0aGlzLCAnVG9rZW5Sb3RhdGlvblNjaGVkdWxlJywge1xuICAgICAgc2NoZWR1bGU6IGV2ZW50cy5TY2hlZHVsZS5yYXRlKGNkay5EdXJhdGlvbi5ob3VycygyNCkpLFxuICAgICAgdGFyZ2V0czogW25ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKHRva2VuUm90YXRpb25MYW1iZGEpXSxcbiAgICB9KVxuICAgIFxuICAgIC8vIFNjaGVkdWxlciBTZXJ2aWNlXG4gICAgY29uc3Qgc2NoZWR1bGVyU2VydmljZUxhbWJkYSA9IG5ldyBsYW1iZGFOb2RlLk5vZGVqc0Z1bmN0aW9uKHRoaXMsICdTY2hlZHVsZXJTZXJ2aWNlJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgcG9zdG9saW8tJHtlbnZpcm9ubWVudH0tc2NoZWR1bGVyLXNlcnZpY2VgLFxuICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9sYW1iZGFzL3NjaGVkdWxlci1zZXJ2aWNlL2luZGV4LnRzJyksXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGhhbmRsZXI6ICdoYW5kbGVyJyxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgIG1lbW9yeVNpemU6IDUxMixcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIC4uLmNvbW1vbkVudixcbiAgICAgICAgRVZFTlRTX1JPTEVfQVJOOiBuZXcgaWFtLlJvbGUodGhpcywgJ0V2ZW50QnJpZGdlUm9sZScsIHtcbiAgICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnc2NoZWR1bGVyLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICAgICAgRXZlbnRCcmlkZ2VQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgICAgYWN0aW9uczogWydldmVudHM6UHV0RXZlbnRzJ10sXG4gICAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFt0aGlzLmV2ZW50QnVzLmV2ZW50QnVzQXJuXSxcbiAgICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLnJvbGVBcm4sXG4gICAgICB9LFxuICAgICAgdHJhY2luZzogbGFtYmRhLlRyYWNpbmcuQUNUSVZFLFxuICAgICAgbGF5ZXJzOiBbc2hhcmVkTGF5ZXJdLFxuICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgfSlcbiAgICBcbiAgICB0aGlzLnNjaGVkdWxlVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHNjaGVkdWxlclNlcnZpY2VMYW1iZGEpXG4gICAgdGhpcy5ldmVudEJ1cy5ncmFudFB1dEV2ZW50c1RvKHNjaGVkdWxlclNlcnZpY2VMYW1iZGEpXG4gICAgXG4gICAgLy8gR3JhbnQgRXZlbnRCcmlkZ2UgcGVybWlzc2lvbnNcbiAgICBzY2hlZHVsZXJTZXJ2aWNlTGFtYmRhLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdzY2hlZHVsZXI6Q3JlYXRlU2NoZWR1bGUnLFxuICAgICAgICAnc2NoZWR1bGVyOkRlbGV0ZVNjaGVkdWxlJyxcbiAgICAgICAgJ3NjaGVkdWxlcjpHZXRTY2hlZHVsZScsXG4gICAgICAgICdzY2hlZHVsZXI6VXBkYXRlU2NoZWR1bGUnLFxuICAgICAgICAnaWFtOlBhc3NSb2xlJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKVxuICAgIFxuICAgIC8vIFB1Ymxpc2hlciBMYW1iZGFzXG4gICAgY29uc3QgY3JlYXRlUHVibGlzaGVyTGFtYmRhID0gKHBsYXRmb3JtOiBzdHJpbmcsIHF1ZXVlOiBzcXMuUXVldWUpID0+IHtcbiAgICAgIGNvbnN0IHB1Ymxpc2hlckxhbWJkYSA9IG5ldyBsYW1iZGFOb2RlLk5vZGVqc0Z1bmN0aW9uKHRoaXMsIGAke3BsYXRmb3JtfVB1Ymxpc2hlcmAsIHtcbiAgICAgICAgZnVuY3Rpb25OYW1lOiBgcG9zdG9saW8tJHtlbnZpcm9ubWVudH0tJHtwbGF0Zm9ybS50b0xvd2VyQ2FzZSgpfS1wdWJsaXNoZXJgLFxuICAgICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgYC4uL2xhbWJkYXMvcHVibGlzaGVycy8ke3BsYXRmb3JtLnRvTG93ZXJDYXNlKCl9L2luZGV4LnRzYCksXG4gICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgICBoYW5kbGVyOiAnaGFuZGxlcicsXG4gICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICBtZW1vcnlTaXplOiAxMDI0LFxuICAgICAgICBlbnZpcm9ubWVudDogY29tbW9uRW52LFxuICAgICAgICB0cmFjaW5nOiBsYW1iZGEuVHJhY2luZy5BQ1RJVkUsXG4gICAgICAgIGxheWVyczogW3NoYXJlZExheWVyXSxcbiAgICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICAgIHJlc2VydmVkQ29uY3VycmVudEV4ZWN1dGlvbnM6IDIwMCwgLy8gSW5jcmVhc2VkIGZyb20gNTAgdG8gaGFuZGxlIGNvbmN1cnJlbnQgcHVibGlzaGluZ1xuICAgICAgfSlcbiAgICAgIFxuICAgICAgLy8gUGVybWlzc2lvbnNcbiAgICAgIHRoaXMudG9rZW5UYWJsZS5ncmFudFJlYWREYXRhKHB1Ymxpc2hlckxhbWJkYSlcbiAgICAgIGpvYlN0YXRlVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHB1Ymxpc2hlckxhbWJkYSlcbiAgICAgIGlkZW1wb3RlbmN5VGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHB1Ymxpc2hlckxhbWJkYSlcbiAgICAgIHRva2VuRW5jcnlwdGlvbktleS5ncmFudERlY3J5cHQocHVibGlzaGVyTGFtYmRhKVxuICAgICAgdGhpcy5ldmVudEJ1cy5ncmFudFB1dEV2ZW50c1RvKHB1Ymxpc2hlckxhbWJkYSlcbiAgICAgIFxuICAgICAgLy8gU1FTIHRyaWdnZXJcbiAgICAgIHB1Ymxpc2hlckxhbWJkYS5hZGRFdmVudFNvdXJjZShuZXcgY2RrLmF3c19sYW1iZGFfZXZlbnRfc291cmNlcy5TcXNFdmVudFNvdXJjZShxdWV1ZSwge1xuICAgICAgICBiYXRjaFNpemU6IDEsXG4gICAgICAgIG1heEJhdGNoaW5nV2luZG93OiBjZGsuRHVyYXRpb24uc2Vjb25kcyg1KSxcbiAgICAgIH0pKVxuICAgICAgXG4gICAgICByZXR1cm4gcHVibGlzaGVyTGFtYmRhXG4gICAgfVxuICAgIFxuICAgIGNvbnN0IGluc3RhZ3JhbVB1Ymxpc2hlciA9IGNyZWF0ZVB1Ymxpc2hlckxhbWJkYSgnSW5zdGFncmFtJywgaW5zdGFncmFtUXVldWUpXG4gICAgY29uc3QgZmFjZWJvb2tQdWJsaXNoZXIgPSBjcmVhdGVQdWJsaXNoZXJMYW1iZGEoJ0ZhY2Vib29rJywgZmFjZWJvb2tRdWV1ZSlcbiAgICBjb25zdCBsaW5rZWRpblB1Ymxpc2hlciA9IGNyZWF0ZVB1Ymxpc2hlckxhbWJkYSgnTGlua2VkSW4nLCBsaW5rZWRpblF1ZXVlKVxuICAgIGNvbnN0IHRpa3Rva1B1Ymxpc2hlciA9IGNyZWF0ZVB1Ymxpc2hlckxhbWJkYSgnVGlrVG9rJywgdGlrdG9rUXVldWUpXG4gICAgXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT0gU2VjdXJlZCBBUEkgR2F0ZXdheSA9PT09PT09PT09PT09PT09PT09PVxuICAgIGNvbnN0IHNlY3VyZWRBcGkgPSBuZXcgU2VjdXJlZEFwaUdhdGV3YXkodGhpcywgJ1NlY3VyZWRBcGlHYXRld2F5Jywge1xuICAgICAgZW52aXJvbm1lbnQsXG4gICAgICBzZXJ2aWNlTmFtZTogJ3BsYXRmb3JtJyxcbiAgICAgIGxhbWJkYUludGVncmF0aW9uczoge1xuICAgICAgICAndG9rZW5zJzoge1xuICAgICAgICAgIGxhbWJkYTogdG9rZW5TZXJ2aWNlTGFtYmRhLFxuICAgICAgICAgIG1ldGhvZHM6IFsnUE9TVCddLFxuICAgICAgICAgIGF1dGhUeXBlOiAnSUFNJyxcbiAgICAgICAgICB0aHJvdHRsZToge1xuICAgICAgICAgICAgYnVyc3RMaW1pdDogMTAwLFxuICAgICAgICAgICAgcmF0ZUxpbWl0OiA1MCxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICAndG9rZW5zL3t1c2VySWR9L3twbGF0Zm9ybX0nOiB7XG4gICAgICAgICAgbGFtYmRhOiB0b2tlblNlcnZpY2VMYW1iZGEsXG4gICAgICAgICAgbWV0aG9kczogWydHRVQnLCAnREVMRVRFJ10sXG4gICAgICAgICAgYXV0aFR5cGU6ICdJQU0nLFxuICAgICAgICAgIHRocm90dGxlOiB7XG4gICAgICAgICAgICBidXJzdExpbWl0OiA1MCxcbiAgICAgICAgICAgIHJhdGVMaW1pdDogMjUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgJ3NjaGVkdWxlcyc6IHtcbiAgICAgICAgICBsYW1iZGE6IHNjaGVkdWxlclNlcnZpY2VMYW1iZGEsXG4gICAgICAgICAgbWV0aG9kczogWydQT1NUJywgJ0dFVCddLFxuICAgICAgICAgIGF1dGhUeXBlOiAnSUFNJyxcbiAgICAgICAgICB0aHJvdHRsZToge1xuICAgICAgICAgICAgYnVyc3RMaW1pdDogMjAwLFxuICAgICAgICAgICAgcmF0ZUxpbWl0OiAxMDAsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgJ3NjaGVkdWxlcy97c2NoZWR1bGVJZH0nOiB7XG4gICAgICAgICAgbGFtYmRhOiBzY2hlZHVsZXJTZXJ2aWNlTGFtYmRhLFxuICAgICAgICAgIG1ldGhvZHM6IFsnR0VUJywgJ0RFTEVURScsICdQQVRDSCddLFxuICAgICAgICAgIGF1dGhUeXBlOiAnSUFNJyxcbiAgICAgICAgICB0aHJvdHRsZToge1xuICAgICAgICAgICAgYnVyc3RMaW1pdDogMTAwLFxuICAgICAgICAgICAgcmF0ZUxpbWl0OiA1MCxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIGVuYWJsZVdhZjogZW52aXJvbm1lbnQgPT09ICdwcm9kJyxcbiAgICAgIGVuYWJsZUFwaUtleTogdHJ1ZSxcbiAgICAgIGVuYWJsZVVzYWdlUGxhbjogdHJ1ZSxcbiAgICAgIGNvcnNDb25maWc6IHtcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBlbnZpcm9ubWVudCA9PT0gJ3Byb2QnIFxuICAgICAgICAgID8gW3Byb3BzLmRvbWFpbk5hbWUgPyBgaHR0cHM6Ly8ke3Byb3BzLmRvbWFpbk5hbWV9YCA6ICdodHRwczovL2FwcC5wb3N0b2xpby5jb20nXVxuICAgICAgICAgIDogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLFxuICAgICAgICBhbGxvd01ldGhvZHM6IGFwaWdhdGV3YXkuQ29ycy5BTExfTUVUSE9EUyxcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBbXG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZScsXG4gICAgICAgICAgJ1gtQW16LURhdGUnLFxuICAgICAgICAgICdBdXRob3JpemF0aW9uJyxcbiAgICAgICAgICAnWC1BcGktS2V5JyxcbiAgICAgICAgICAnWC1BbXotU2VjdXJpdHktVG9rZW4nLFxuICAgICAgICAgICdYLVVzZXItSWQnLFxuICAgICAgICAgICdYLVVzZXItVGllcicsXG4gICAgICAgICAgJ1gtQ29ycmVsYXRpb24tSWQnLFxuICAgICAgICAgICdYLUJyYW5kLUlkJyxcbiAgICAgICAgXSxcbiAgICAgICAgbWF4QWdlOiBjZGsuRHVyYXRpb24uaG91cnMoMSksXG4gICAgICB9LFxuICAgIH0pXG4gICAgXG4gICAgLy8gU3RvcmUgQVBJIHJlZmVyZW5jZSBmb3Igb3RoZXIgc3RhY2tzXG4gICAgdGhpcy50b2tlblNlcnZpY2VBcGkgPSBzZWN1cmVkQXBpLmFwaVxuICAgIFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09IEV2ZW50QnJpZGdlIFJ1bGVzID09PT09PT09PT09PT09PT09PT09XG4gICAgXG4gICAgLy8gUm91dGUgc2NoZWR1bGUgZXhlY3V0aW9ucyB0byBwdWJsaXNoZXIgcXVldWVzXG4gICAgbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdJbnN0YWdyYW1TY2hlZHVsZVJ1bGUnLCB7XG4gICAgICBldmVudEJ1czogdGhpcy5ldmVudEJ1cyxcbiAgICAgIGV2ZW50UGF0dGVybjoge1xuICAgICAgICBzb3VyY2U6IFsncG9zdG9saW8uc2NoZWR1bGVyJ10sXG4gICAgICAgIGRldGFpbFR5cGU6IFsnc2NoZWR1bGUuZXhlY3V0ZSddLFxuICAgICAgICBkZXRhaWw6IHsgcGxhdGZvcm06IFsnaW5zdGFncmFtJ10gfSxcbiAgICAgIH0sXG4gICAgICB0YXJnZXRzOiBbbmV3IHRhcmdldHMuU3FzUXVldWUoaW5zdGFncmFtUXVldWUpXSxcbiAgICB9KVxuICAgIFxuICAgIG5ldyBldmVudHMuUnVsZSh0aGlzLCAnRmFjZWJvb2tTY2hlZHVsZVJ1bGUnLCB7XG4gICAgICBldmVudEJ1czogdGhpcy5ldmVudEJ1cyxcbiAgICAgIGV2ZW50UGF0dGVybjoge1xuICAgICAgICBzb3VyY2U6IFsncG9zdG9saW8uc2NoZWR1bGVyJ10sXG4gICAgICAgIGRldGFpbFR5cGU6IFsnc2NoZWR1bGUuZXhlY3V0ZSddLFxuICAgICAgICBkZXRhaWw6IHsgcGxhdGZvcm06IFsnZmFjZWJvb2snXSB9LFxuICAgICAgfSxcbiAgICAgIHRhcmdldHM6IFtuZXcgdGFyZ2V0cy5TcXNRdWV1ZShmYWNlYm9va1F1ZXVlKV0sXG4gICAgfSlcbiAgICBcbiAgICBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ0xpbmtlZEluU2NoZWR1bGVSdWxlJywge1xuICAgICAgZXZlbnRCdXM6IHRoaXMuZXZlbnRCdXMsXG4gICAgICBldmVudFBhdHRlcm46IHtcbiAgICAgICAgc291cmNlOiBbJ3Bvc3RvbGlvLnNjaGVkdWxlciddLFxuICAgICAgICBkZXRhaWxUeXBlOiBbJ3NjaGVkdWxlLmV4ZWN1dGUnXSxcbiAgICAgICAgZGV0YWlsOiB7IHBsYXRmb3JtOiBbJ2xpbmtlZGluJ10gfSxcbiAgICAgIH0sXG4gICAgICB0YXJnZXRzOiBbbmV3IHRhcmdldHMuU3FzUXVldWUobGlua2VkaW5RdWV1ZSldLFxuICAgIH0pXG4gICAgXG4gICAgbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdUaWtUb2tTY2hlZHVsZVJ1bGUnLCB7XG4gICAgICBldmVudEJ1czogdGhpcy5ldmVudEJ1cyxcbiAgICAgIGV2ZW50UGF0dGVybjoge1xuICAgICAgICBzb3VyY2U6IFsncG9zdG9saW8uc2NoZWR1bGVyJ10sXG4gICAgICAgIGRldGFpbFR5cGU6IFsnc2NoZWR1bGUuZXhlY3V0ZSddLFxuICAgICAgICBkZXRhaWw6IHsgcGxhdGZvcm06IFsndGlrdG9rJ10gfSxcbiAgICAgIH0sXG4gICAgICB0YXJnZXRzOiBbbmV3IHRhcmdldHMuU3FzUXVldWUodGlrdG9rUXVldWUpXSxcbiAgICB9KVxuICAgIFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09IERMUSBQcm9jZXNzaW5nIEluZnJhc3RydWN0dXJlID09PT09PT09PT09PT09PT09PT09XG4gICAgXG4gICAgLy8gRExRIFByb2Nlc3NpbmcgU3RhdGUgVGFibGVcbiAgICBjb25zdCBkbHFTdGF0ZVRhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdETFFTdGF0ZVRhYmxlJywge1xuICAgICAgdGFibGVOYW1lOiBgcG9zdG9saW8tZGxxLXN0YXRlLSR7ZW52aXJvbm1lbnR9YCxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnbWVzc2FnZUlkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcbiAgICAgIHN0cmVhbTogZHluYW1vZGIuU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTLFxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsXG4gICAgfSlcbiAgICBcbiAgICAvLyBHU0kgZm9yIHF1ZXJ5aW5nIGJ5IERMUSBhbmQgc3RhdHVzXG4gICAgZGxxU3RhdGVUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICdieS1kbHEtc3RhdHVzJyxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnZGxxTmFtZScsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdzdGF0dXMnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcbiAgICB9KVxuICAgIFxuICAgIC8vIERMUSBQcm9jZXNzb3IgTGFtYmRhXG4gICAgY29uc3QgZGxxUHJvY2Vzc29yTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnRExRUHJvY2Vzc29yTGFtYmRhJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgcG9zdG9saW8tZGxxLXByb2Nlc3Nvci0ke2Vudmlyb25tZW50fWAsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnLi9saWIvbGFtYmRhcy9kbHEtcHJvY2Vzc29yJyksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBETFFfU1RBVEVfVEFCTEVfTkFNRTogZGxxU3RhdGVUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIFBVQkxJU0hFUl9RVUVVRV9VUkw6IGluc3RhZ3JhbVF1ZXVlLnF1ZXVlVXJsLFxuICAgICAgICBTQ0hFRFVMRVJfUVVFVUVfVVJMOiAnJywgLy8gV2lsbCBiZSBhZGRlZCB3aGVuIHNjaGVkdWxlciBxdWV1ZSBpcyBjcmVhdGVkXG4gICAgICAgIFRPS0VOX1JFRlJFU0hfUVVFVUVfVVJMOiAnJywgLy8gV2lsbCBiZSBhZGRlZCB3aGVuIHRva2VuIHJlZnJlc2ggcXVldWUgaXMgY3JlYXRlZFxuICAgICAgICBBTkFMWVRJQ1NfUVVFVUVfVVJMOiAnJywgLy8gV2lsbCBiZSBhZGRlZCB3aGVuIGFuYWx5dGljcyBxdWV1ZSBpcyBjcmVhdGVkXG4gICAgICAgIFNRU19CQVNFX1VSTDogYGh0dHBzOi8vc3FzLiR7Y2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvbn0uYW1hem9uYXdzLmNvbS8ke2Nkay5TdGFjay5vZih0aGlzKS5hY2NvdW50fWAsXG4gICAgICAgIERMUV9NQVhfUkVUUklFUzogJzUnLFxuICAgICAgICBETFFfUkVUUllfREVMQVlfQkFTRTogJzYwMDAwJyxcbiAgICAgICAgRU5WSVJPTk1FTlQ6IGVudmlyb25tZW50LFxuICAgICAgfSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgbWVtb3J5U2l6ZTogNTEyLFxuICAgICAgdHJhY2luZzogbGFtYmRhLlRyYWNpbmcuQUNUSVZFLFxuICAgIH0pXG4gICAgXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnNcbiAgICBkbHFTdGF0ZVRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShkbHFQcm9jZXNzb3JMYW1iZGEpXG4gICAgcHVibGlzaGVyRExRLmdyYW50Q29uc3VtZU1lc3NhZ2VzKGRscVByb2Nlc3NvckxhbWJkYSlcbiAgICBwdWJsaXNoZXJETFEuZ3JhbnRTZW5kTWVzc2FnZXMoZGxxUHJvY2Vzc29yTGFtYmRhKVxuICAgIGluc3RhZ3JhbVF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKGRscVByb2Nlc3NvckxhbWJkYSlcbiAgICBmYWNlYm9va1F1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKGRscVByb2Nlc3NvckxhbWJkYSlcbiAgICBsaW5rZWRpblF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKGRscVByb2Nlc3NvckxhbWJkYSlcbiAgICB0aWt0b2tRdWV1ZS5ncmFudFNlbmRNZXNzYWdlcyhkbHFQcm9jZXNzb3JMYW1iZGEpXG4gICAgXG4gICAgLy8gU2NoZWR1bGUgRExRIHByb2Nlc3NpbmcgZXZlcnkgMTUgbWludXRlc1xuICAgIGNvbnN0IGRscVByb2Nlc3NpbmdSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdETFFQcm9jZXNzaW5nUnVsZScsIHtcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUucmF0ZShjZGsuRHVyYXRpb24ubWludXRlcygxNSkpLFxuICAgICAgZGVzY3JpcHRpb246ICdQcm9jZXNzIG1lc3NhZ2VzIGZyb20gRGVhZCBMZXR0ZXIgUXVldWVzJyxcbiAgICB9KVxuICAgIFxuICAgIGRscVByb2Nlc3NpbmdSdWxlLmFkZFRhcmdldChuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihkbHFQcm9jZXNzb3JMYW1iZGEpKVxuICAgIFxuICAgIC8vIE1hbnVhbCByZXByb2Nlc3MgTGFtYmRhXG4gICAgY29uc3QgZGxxUmVwcm9jZXNzTGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnRExRUmVwcm9jZXNzTGFtYmRhJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgcG9zdG9saW8tZGxxLXJlcHJvY2Vzcy0ke2Vudmlyb25tZW50fWAsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5yZXByb2Nlc3NIYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnLi9saWIvbGFtYmRhcy9kbHEtcHJvY2Vzc29yJyksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBETFFfU1RBVEVfVEFCTEVfTkFNRTogZGxxU3RhdGVUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIFNRU19CQVNFX1VSTDogYGh0dHBzOi8vc3FzLiR7Y2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvbn0uYW1hem9uYXdzLmNvbS8ke2Nkay5TdGFjay5vZih0aGlzKS5hY2NvdW50fWAsXG4gICAgICAgIEVOVklST05NRU5UOiBlbnZpcm9ubWVudCxcbiAgICAgIH0sXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcbiAgICAgIHRyYWNpbmc6IGxhbWJkYS5UcmFjaW5nLkFDVElWRSxcbiAgICB9KVxuICAgIFxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIGZvciByZXByb2Nlc3MgTGFtYmRhXG4gICAgZGxxU3RhdGVUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoZGxxUmVwcm9jZXNzTGFtYmRhKVxuICAgIHB1Ymxpc2hlckRMUS5ncmFudFNlbmRNZXNzYWdlcyhkbHFSZXByb2Nlc3NMYW1iZGEpXG4gICAgXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT0gQ2xvdWRXYXRjaCBBbGFybXMgPT09PT09PT09PT09PT09PT09PT1cbiAgICBsZXQgYWxhcm1Ub3BpYzogY2RrLmF3c19zbnMuVG9waWMgfCB1bmRlZmluZWRcbiAgICBcbiAgICBpZiAoYWxlcnRFbWFpbCkge1xuICAgICAgYWxhcm1Ub3BpYyA9IG5ldyBjZGsuYXdzX3Nucy5Ub3BpYyh0aGlzLCAnQWxhcm1Ub3BpYycsIHtcbiAgICAgICAgZGlzcGxheU5hbWU6IGBQb3N0b2xpbyAke2Vudmlyb25tZW50fSBBbGFybXNgLFxuICAgICAgfSlcbiAgICAgIFxuICAgICAgYWxhcm1Ub3BpYy5hZGRTdWJzY3JpcHRpb24oXG4gICAgICAgIG5ldyBjZGsuYXdzX3Nuc19zdWJzY3JpcHRpb25zLkVtYWlsU3Vic2NyaXB0aW9uKGFsZXJ0RW1haWwpXG4gICAgICApXG4gICAgICBcbiAgICAgIC8vIEdyYW50IERMUSBwcm9jZXNzb3IgcGVybWlzc2lvbiB0byBwdWJsaXNoIGFsZXJ0c1xuICAgICAgYWxhcm1Ub3BpYy5ncmFudFB1Ymxpc2goZGxxUHJvY2Vzc29yTGFtYmRhKVxuICAgICAgXG4gICAgICAvLyBBZGQgYWxhcm0gdG9waWMgQVJOIHRvIERMUSBwcm9jZXNzb3IgZW52aXJvbm1lbnRcbiAgICAgIGRscVByb2Nlc3NvckxhbWJkYS5hZGRFbnZpcm9ubWVudCgnRExRX0FMRVJUX1RPUElDX0FSTicsIGFsYXJtVG9waWMudG9waWNBcm4pXG4gICAgICBcbiAgICAgIC8vIERMUSBhbGFybVxuICAgICAgbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0RMUUFsYXJtJywge1xuICAgICAgICBtZXRyaWM6IHB1Ymxpc2hlckRMUS5tZXRyaWNBcHByb3hpbWF0ZU51bWJlck9mTWVzc2FnZXNWaXNpYmxlKCksXG4gICAgICAgIHRocmVzaG9sZDogMSxcbiAgICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdNZXNzYWdlcyBpbiBwdWJsaXNoZXIgRExRJyxcbiAgICAgIH0pLmFkZEFsYXJtQWN0aW9uKG5ldyBjZGsuYXdzX2Nsb3Vkd2F0Y2hfYWN0aW9ucy5TbnNBY3Rpb24oYWxhcm1Ub3BpYykpXG4gICAgICBcbiAgICAgIC8vIFRva2VuIHJvdGF0aW9uIGVycm9yc1xuICAgICAgbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ1Rva2VuUm90YXRpb25FcnJvckFsYXJtJywge1xuICAgICAgICBtZXRyaWM6IHRva2VuUm90YXRpb25MYW1iZGEubWV0cmljRXJyb3JzKCksXG4gICAgICAgIHRocmVzaG9sZDogMSxcbiAgICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdUb2tlbiByb3RhdGlvbiBMYW1iZGEgZXJyb3JzJyxcbiAgICAgIH0pLmFkZEFsYXJtQWN0aW9uKG5ldyBjZGsuYXdzX2Nsb3Vkd2F0Y2hfYWN0aW9ucy5TbnNBY3Rpb24oYWxhcm1Ub3BpYykpXG4gICAgfVxuICAgIFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09IENsb3VkV2F0Y2ggRGFzaGJvYXJkcyA9PT09PT09PT09PT09PT09PT09PVxuICAgIGNvbnN0IGRhc2hib2FyZHMgPSBuZXcgQ2xvdWRXYXRjaERhc2hib2FyZHModGhpcywgJ0Rhc2hib2FyZHMnLCB7XG4gICAgICBlbnZpcm9ubWVudCxcbiAgICAgIHRva2VuU2VydmljZUxhbWJkYSxcbiAgICAgIHNjaGVkdWxlclNlcnZpY2VMYW1iZGEsXG4gICAgICBwdWJsaXNoZXJMYW1iZGFzOiB7XG4gICAgICAgIGluc3RhZ3JhbTogaW5zdGFncmFtUHVibGlzaGVyLFxuICAgICAgICBmYWNlYm9vazogZmFjZWJvb2tQdWJsaXNoZXIsXG4gICAgICAgIGxpbmtlZGluOiBsaW5rZWRpblB1Ymxpc2hlcixcbiAgICAgICAgdGlrdG9rOiB0aWt0b2tQdWJsaXNoZXIsXG4gICAgICB9LFxuICAgICAgZGxxUHJvY2Vzc29yTGFtYmRhLFxuICAgICAgdG9rZW5UYWJsZTogdGhpcy50b2tlblRhYmxlLFxuICAgICAgc2NoZWR1bGVUYWJsZTogdGhpcy5zY2hlZHVsZVRhYmxlLFxuICAgICAgc2FnYVN0YXRlVGFibGUsXG4gICAgICBjaXJjdWl0QnJlYWtlclRhYmxlLFxuICAgICAgZGxxU3RhdGVUYWJsZSxcbiAgICAgIHB1Ymxpc2hlclF1ZXVlczoge1xuICAgICAgICBpbnN0YWdyYW06IGluc3RhZ3JhbVF1ZXVlLFxuICAgICAgICBmYWNlYm9vazogZmFjZWJvb2tRdWV1ZSxcbiAgICAgICAgbGlua2VkaW46IGxpbmtlZGluUXVldWUsXG4gICAgICAgIHRpa3RvazogdGlrdG9rUXVldWUsXG4gICAgICB9LFxuICAgICAgcHVibGlzaGVyRExRLFxuICAgICAgZXZlbnRCdXM6IHRoaXMuZXZlbnRCdXMsXG4gICAgfSlcbiAgICBcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PSBPdXRwdXRzID09PT09PT09PT09PT09PT09PT09XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1Rva2VuU2VydmljZUFwaVVybCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnRva2VuU2VydmljZUFwaS51cmwsXG4gICAgICBkZXNjcmlwdGlvbjogJ1Rva2VuIFNlcnZpY2UgQVBJIFVSTCcsXG4gICAgfSlcbiAgICBcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRXZlbnRCdXNBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5ldmVudEJ1cy5ldmVudEJ1c0FybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnUGxhdGZvcm0gRXZlbnQgQnVzIEFSTicsXG4gICAgfSlcbiAgICBcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVG9rZW5UYWJsZU5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy50b2tlblRhYmxlLnRhYmxlTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnVG9rZW4gRHluYW1vREIgVGFibGUgTmFtZScsXG4gICAgfSlcbiAgICBcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU2NoZWR1bGVUYWJsZU5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5zY2hlZHVsZVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2NoZWR1bGUgRHluYW1vREIgVGFibGUgTmFtZScsXG4gICAgfSlcbiAgfVxufSJdfQ==