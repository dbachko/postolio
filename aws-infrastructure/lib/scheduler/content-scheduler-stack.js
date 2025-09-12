"use strict";
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
exports.ContentSchedulerStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const lambdaNodejs = __importStar(require("aws-cdk-lib/aws-lambda-nodejs"));
const apigateway = __importStar(require("aws-cdk-lib/aws-apigateway"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const s3 = __importStar(require("aws-cdk-lib/aws-s3"));
const scheduler = __importStar(require("aws-cdk-lib/aws-scheduler"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const events = __importStar(require("aws-cdk-lib/aws-events"));
const targets = __importStar(require("aws-cdk-lib/aws-events-targets"));
const cloudwatch = __importStar(require("aws-cdk-lib/aws-cloudwatch"));
const sns = __importStar(require("aws-cdk-lib/aws-sns"));
const snsSubscriptions = __importStar(require("aws-cdk-lib/aws-sns-subscriptions"));
const secretsmanager = __importStar(require("aws-cdk-lib/aws-secretsmanager"));
const sqs = __importStar(require("aws-cdk-lib/aws-sqs"));
const wafv2 = __importStar(require("aws-cdk-lib/aws-wafv2"));
const kms = __importStar(require("aws-cdk-lib/aws-kms"));
const cloudwatchActions = __importStar(require("aws-cdk-lib/aws-cloudwatch-actions"));
const aws_lambda_event_sources_1 = require("aws-cdk-lib/aws-lambda-event-sources");
const cdk_nag_1 = require("cdk-nag");
const path = __importStar(require("path"));
const service_discovery_infrastructure_1 = require("../utils/service-discovery-infrastructure");
class ContentSchedulerStack extends cdk.Stack {
    api;
    schedulesTable;
    videoBucket;
    constructor(scope, id, props) {
        super(scope, id, props);
        const { environment, alertEmail, mainAppApiUrl, serviceDiscoveryNamespaceId } = props;
        const prefix = `postolio-scheduler-${environment}`;
        // All environments use the production URL
        const resolvedMainAppApiUrl = mainAppApiUrl || 'https://postolio.example';
        // Publisher Lambda now uses AWS IAM SigV4 authentication instead of API keys
        // Use shared Service Discovery namespace
        const serviceDiscovery = new service_discovery_infrastructure_1.ServiceDiscoveryManager(this, 'ServiceDiscovery', {
            environment,
            existingNamespaceId: serviceDiscoveryNamespaceId || cdk.Fn.importValue(`ServiceDiscovery-${environment}-NamespaceId`),
        });
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
            SCHEDULES_TABLE_BRAND_INDEX: brandIndexName,
            SCHEDULES_TABLE_STATUS_INDEX: statusIndexName,
            RETRY_QUEUE_TABLE: retryQueueTable.tableName,
            AUDIT_LOG_TABLE: auditLogTable.tableName,
            VIDEO_BUCKET: this.videoBucket.bucketName,
            PLATFORM_CREDENTIALS_SECRET: platformCredentials.secretArn,
            // MAIN_APP_API_URL removed - publisher now uses content from DynamoDB
            POWERTOOLS_SERVICE_NAME: 'content-scheduler',
            POWERTOOLS_METRICS_NAMESPACE: 'ContentScheduler',
            LOG_LEVEL: environment === 'prod' ? 'INFO' : 'DEBUG',
            SCHEDULER_GROUP_NAME: `${prefix}-schedules`,
            ...(0, service_discovery_infrastructure_1.getServiceDiscoveryEnvVars)(serviceDiscovery.getClientConfig()),
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
                SCHEDULES_TABLE: this.schedulesTable.tableName,
            },
            layers: [powertoolsLayer],
            // Using default role to avoid circular dependencies
            tracing: lambda.Tracing.ACTIVE,
            // logRetention removed to avoid circular dependencies
        });
        // Schedule Cleanup Lambda: runs daily to clean up orphaned schedules
        const scheduleCleanupLambda = new lambdaNodejs.NodejsFunction(this, 'ScheduleCleanupLambda', {
            functionName: `${prefix}-schedule-cleanup`,
            runtime: lambda.Runtime.NODEJS_22_X,
            handler: 'handler',
            entry: path.join(__dirname, '../lambda/schedule-cleanup/index.ts'),
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
            functionName: `${prefix}-status-sync`,
            runtime: lambda.Runtime.NODEJS_22_X,
            handler: 'handler',
            entry: path.join(__dirname, '../lambda/status-sync/index.ts'),
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
                nodeModules: [
                    '@prisma/client'
                ],
                commandHooks: {
                    beforeBundling() { return []; },
                    beforeInstall() { return []; },
                    afterBundling(inputDir, outputDir) {
                        return [
                            `cp -r ${inputDir}/node_modules/.prisma ${outputDir}/`,
                            `mkdir -p ${outputDir}/node_modules/@prisma/`,
                            `cp -r ${inputDir}/node_modules/@prisma/client ${outputDir}/node_modules/@prisma/`,
                        ];
                    }
                }
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
        });
        // Logging permissions are provided via the shared LambdaExecutionRole (lambdaRole) with scoped resources
        // EventBridge rule to forward platform publishing events to Status Sync Lambda
        const statusSyncRule = new events.Rule(this, 'StatusSyncRule', {
            ruleName: `${prefix}-status-sync`,
            eventPattern: {
                source: ['postolio.platform', 'postolio.scheduler'],
                detailType: ['post.published', 'post.failed', 'schedule.created', 'schedule.updated', 'schedule.canceled'],
            },
        });
        statusSyncRule.addTarget(new targets.LambdaFunction(statusSyncLambda));
        // Add DLQ as event source for retry handler
        retryHandlerLambda.addEventSource(new aws_lambda_event_sources_1.SqsEventSource(deadLetterQueue, {
            batchSize: 10,
            maxBatchingWindow: cdk.Duration.seconds(5),
        }));
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
        const schedulerRole = new iam.Role(this, 'SchedulerRole', {
            assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
        });
        publisherLambda.grantInvoke(schedulerRole);
        // Create scheduler group
        const _schedulerGroup = new scheduler.CfnScheduleGroup(this, 'SchedulerGroup', {
            name: `${prefix}-schedules`,
        });
        // Add environment variables to Lambda functions here
        scheduleManagementLambda.addEnvironment('PUBLISHER_LAMBDA_ARN', publisherLambda.functionArn);
        scheduleManagementLambda.addEnvironment('SCHEDULER_ROLE_ARN', schedulerRole.roleArn);
        // Grant Lambda permission to create/manage EventBridge schedules
        scheduleManagementLambda.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'scheduler:CreateSchedule',
                'scheduler:UpdateSchedule',
                'scheduler:GetSchedule',
                'scheduler:DeleteSchedule',
                'scheduler:ListSchedules',
            ],
            resources: [`arn:aws:scheduler:${this.region}:${this.account}:schedule/${prefix}-schedules/*`],
        }));
        // Grant Publisher Lambda permission to use Service Discovery
        publisherLambda.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'servicediscovery:DiscoverInstances',
                'servicediscovery:GetNamespace',
                'servicediscovery:GetService',
            ],
            resources: ['*'], // Service Discovery requires wildcard for discovery operations
        }));
        // Grant Publisher Lambda permission to invoke Token Service API (IAM-authenticated)
        publisherLambda.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['execute-api:Invoke'],
            resources: [
                // Publisher Lambda only needs to GET tokens from Token Service
                // GET /tokens/{userId}/{platform}?brandId={brandId}
                `arn:aws:execute-api:${this.region}:${this.account}:*/*/GET/tokens/*`,
            ],
        }));
        // Grant Publisher Lambda permission to emit events to EventBridge (default bus)
        publisherLambda.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['events:PutEvents'],
            resources: ['*'],
        }));
        // cdk-nag: suppress wildcard resource for PutEvents with justification
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/PublisherLambda/ServiceRole/DefaultPolicy/Resource`, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'EventBridge PutEvents requires wildcard resource when using default event bus',
                appliesTo: ['Action::events:PutEvents', 'Resource::*'],
            },
        ]);
        // Grant Lambda permission to pass the scheduler role to EventBridge
        scheduleManagementLambda.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['iam:PassRole'],
            resources: [schedulerRole.roleArn],
            conditions: {
                StringEquals: {
                    'iam:PassedToService': 'scheduler.amazonaws.com',
                },
            },
        }));
        // Grant Schedule Cleanup Lambda permission to list and delete EventBridge schedules
        scheduleCleanupLambda.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'scheduler:ListSchedules',
                'scheduler:GetSchedule',
                'scheduler:DeleteSchedule',
            ],
            resources: [`arn:aws:scheduler:${this.region}:${this.account}:schedule/${prefix}-schedules/*`],
        }));
        // Grant Cleanup Lambda permission to list schedules in the group
        scheduleCleanupLambda.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['scheduler:ListSchedules'],
            resources: ['*'], // ListSchedules requires wildcard when specifying GroupName
        }));
        // ==================== API Gateway CloudWatch Logging Role ====================
        // Create IAM role for API Gateway CloudWatch logging (account-level setting)
        const apiGatewayCloudWatchRole = new iam.Role(this, 'ApiGatewayCloudWatchRole', {
            assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonAPIGatewayPushToCloudWatchLogs'),
            ],
            description: 'Role for API Gateway to write logs to CloudWatch',
        });
        // Configure account-level CloudWatch logging for API Gateway
        const cfnAccount = new apigateway.CfnAccount(this, 'ApiGatewayAccount', {
            cloudWatchRoleArn: apiGatewayCloudWatchRole.roleArn,
        });
        // ==================== API Gateway with Request Validation ====================
        this.api = new apigateway.RestApi(this, 'SchedulerApi', {
            restApiName: `${prefix}-api`,
            description: 'Content Scheduler Microservice API',
            deployOptions: {
                stageName: environment,
                tracingEnabled: true,
                // Enable INFO level execution logging & access logs for 403 diagnostics
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                metricsEnabled: true,
                accessLogDestination: new apigateway.LogGroupLogDestination(new logs.LogGroup(this, 'SchedulerApiAccessLogs', {
                    logGroupName: `/aws/apigateway/${prefix}-api-access`,
                    retention: logs.RetentionDays.ONE_WEEK,
                    removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
                })),
                accessLogFormat: apigateway.AccessLogFormat.custom(JSON.stringify({
                    requestId: '$context.requestId',
                    ip: '$context.identity.sourceIp',
                    requestTime: '$context.requestTime',
                    httpMethod: '$context.httpMethod',
                    resourcePath: '$context.resourcePath',
                    path: '$context.path',
                    status: '$context.status',
                    protocol: '$context.protocol',
                    integrationStatus: '$context.integrationStatus',
                    errorMessage: '$context.error.message',
                    responseLength: '$context.responseLength',
                    userAgent: '$context.identity.userAgent',
                    caller: '$context.identity.caller',
                    user: '$context.identity.user'
                })),
                throttlingBurstLimit: 1000,
                throttlingRateLimit: 500,
            },
            defaultCorsPreflightOptions: {
                allowOrigins: environment === 'prod' ? ['https://postolio.example'] : apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: ['Content-Type', 'Authorization'],
            },
        });
        // Ensure API deployment happens after account configuration
        this.api.node.addDependency(cfnAccount);
        // NO AUTHORIZER NEEDED - Using IAM SigV4 authentication
        // This provides secure service-to-service authentication using AWS credentials
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
            authorizationType: apigateway.AuthorizationType.IAM,
            requestValidator,
            requestModels: {
                'application/json': scheduleModel,
            },
        });
        schedulesResource.addMethod('GET', lambdaIntegration, {
            authorizationType: apigateway.AuthorizationType.IAM,
        });
        scheduleResource.addMethod('GET', lambdaIntegration, {
            authorizationType: apigateway.AuthorizationType.IAM,
        });
        scheduleResource.addMethod('PUT', lambdaIntegration, {
            authorizationType: apigateway.AuthorizationType.IAM,
            requestValidator,
            requestModels: {
                'application/json': scheduleModel,
            },
        });
        scheduleResource.addMethod('DELETE', lambdaIntegration, {
            authorizationType: apigateway.AuthorizationType.IAM,
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
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/AccessLogsBucket/Resource`, [
            {
                id: 'AwsSolutions-S10',
                reason: 'Access logs bucket is managed by AWS ELB service which handles SSL enforcement internally'
            },
        ]);
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/AccessLogsBucket/Policy/Resource`, [
            {
                id: 'AwsSolutions-S10',
                reason: 'Access logs bucket is managed by AWS ELB service which handles SSL enforcement internally'
            },
        ]);
        // Suppress S3 bucket SSL enforcement warnings for video bucket (bucket and policy)
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/VideoBucket/Resource`, [
            {
                id: 'AwsSolutions-S10',
                reason: 'Video bucket accessed via pre-signed URLs with HTTPS enforced at application level'
            },
        ]);
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/VideoBucket/Policy/Resource`, [
            {
                id: 'AwsSolutions-S10',
                reason: 'Video bucket accessed via pre-signed URLs with HTTPS enforced at application level'
            },
        ]);
        // Suppress secret rotation warnings
        cdk_nag_1.NagSuppressions.addResourceSuppressions(platformCredentials, [
            {
                id: 'AwsSolutions-SMG4',
                reason: 'Platform API credentials are managed manually by operations team'
            },
        ]);
        // Suppress SQS SSL enforcement warnings
        cdk_nag_1.NagSuppressions.addResourceSuppressions(deadLetterQueue, [
            {
                id: 'AwsSolutions-SQS4',
                reason: 'Dead letter queue is only accessed by Lambda functions within VPC using IAM roles'
            },
        ]);
        // Suppress X-Ray permissions specifically
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/LambdaExecutionRole/DefaultPolicy/Resource`, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Lambda execution role requires wildcard permissions for CloudWatch Logs and X-Ray tracing',
                appliesTo: [
                    'Resource::*',
                    `Resource::arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/postolio-scheduler-${environment}-*`,
                ],
            },
        ]);
        // Suppress API Gateway logging configuration
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/SchedulerApi/Resource`, [
            {
                id: 'AwsSolutions-APIG1',
                reason: 'CloudWatch logging disabled to avoid circular dependency with IAM role. Metrics and tracing are enabled for monitoring.',
            },
        ]);
        // Suppress WAF warning for non-production environments
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/SchedulerApi/DeploymentStage.${environment}/Resource`, [
            {
                id: 'AwsSolutions-APIG3',
                reason: `WAF not required for ${environment} environment. Production uses AWS WAF v2 for protection.`,
            },
        ]);
        // Suppress API Gateway warnings (using IAM auth instead of Cognito)
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/SchedulerApi/Default/schedules/POST/Resource`, [
            {
                id: 'AwsSolutions-APIG4',
                reason: 'Using IAM SigV4 authentication for service-to-service communication',
            },
            {
                id: 'AwsSolutions-COG4',
                reason: 'Using IAM SigV4 authentication for service-to-service communication instead of Cognito user pools',
            },
        ]);
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/SchedulerApi/Default/schedules/GET/Resource`, [
            {
                id: 'AwsSolutions-APIG4',
                reason: 'Using IAM SigV4 authentication for service-to-service communication',
            },
            {
                id: 'AwsSolutions-COG4',
                reason: 'Using IAM SigV4 authentication for service-to-service communication instead of Cognito user pools',
            },
        ]);
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/SchedulerApi/Default/schedules/{scheduleId}/GET/Resource`, [
            {
                id: 'AwsSolutions-APIG4',
                reason: 'Using IAM SigV4 authentication for service-to-service communication',
            },
            {
                id: 'AwsSolutions-COG4',
                reason: 'Using IAM SigV4 authentication for service-to-service communication instead of Cognito user pools',
            },
        ]);
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/SchedulerApi/Default/schedules/{scheduleId}/PUT/Resource`, [
            {
                id: 'AwsSolutions-APIG4',
                reason: 'Using IAM SigV4 authentication for service-to-service communication',
            },
            {
                id: 'AwsSolutions-COG4',
                reason: 'Using IAM SigV4 authentication for service-to-service communication instead of Cognito user pools',
            },
        ]);
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/SchedulerApi/Default/schedules/{scheduleId}/DELETE/Resource`, [
            {
                id: 'AwsSolutions-APIG4',
                reason: 'Using IAM SigV4 authentication for service-to-service communication',
            },
            {
                id: 'AwsSolutions-COG4',
                reason: 'Using IAM SigV4 authentication for service-to-service communication instead of Cognito user pools',
            },
        ]);
        // Suppress access logs bucket logging requirement
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/AccessLogsBucket/Resource`, [
            {
                id: 'AwsSolutions-S1',
                reason: 'This is the access logs bucket itself - enabling access logging would create an infinite loop',
            },
        ]);
        // Suppress Lambda IAM managed policy warnings
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/ScheduleManagementLambda/ServiceRole/Resource`, [
            {
                id: 'AwsSolutions-IAM4',
                reason: 'Lambda functions require AWS managed BasicExecutionRole for CloudWatch Logs',
                appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
            },
        ]);
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/PublisherLambda/ServiceRole/Resource`, [
            {
                id: 'AwsSolutions-IAM4',
                reason: 'Lambda functions require AWS managed BasicExecutionRole for CloudWatch Logs',
                appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
            },
        ]);
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/RetryHandlerLambda/ServiceRole/Resource`, [
            {
                id: 'AwsSolutions-IAM4',
                reason: 'Lambda functions require AWS managed BasicExecutionRole for CloudWatch Logs',
                appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
            },
        ]);
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/ScheduleCleanupLambda/ServiceRole/Resource`, [
            {
                id: 'AwsSolutions-IAM4',
                reason: 'Lambda functions require AWS managed BasicExecutionRole for CloudWatch Logs',
                appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
            },
        ]);
        // Suppress Lambda IAM wildcard permissions
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/ScheduleManagementLambda/ServiceRole/DefaultPolicy/Resource`, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Lambda requires wildcard permissions for X-Ray tracing, DynamoDB GSI access, EventBridge schedules, and KMS operations',
                appliesTo: [
                    'Resource::*',
                    'Action::kms:GenerateDataKey*',
                    'Action::kms:ReEncrypt*',
                    'Resource::<SchedulesTableFBEB0188.Arn>/index/*',
                    `Resource::arn:aws:scheduler:${this.region}:${this.account}:schedule/postolio-scheduler-${environment}-schedules/*`,
                ],
            },
        ]);
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/PublisherLambda/ServiceRole/DefaultPolicy/Resource`, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Publisher Lambda requires wildcard permissions for X-Ray, DynamoDB GSI, S3 operations, KMS, and Token Service API GET access',
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
                    `Resource::arn:aws:execute-api:${this.region}:${this.account}:*/*/GET/tokens/*`,
                ],
            },
        ]);
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/RetryHandlerLambda/ServiceRole/DefaultPolicy/Resource`, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Retry handler requires wildcard permissions for X-Ray, KMS, DynamoDB GSI access, and Lambda invocation',
                appliesTo: [
                    'Resource::*',
                    'Action::kms:GenerateDataKey*',
                    'Action::kms:ReEncrypt*',
                    'Resource::<PublisherLambdaB2749827.Arn>:*',
                    // Grant for DynamoDB GSIs produced by table grants; limited to this table's indexes
                    'Resource::<SchedulesTableFBEB0188.Arn>/index/*',
                ],
            },
        ]);
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/ScheduleCleanupLambda/ServiceRole/DefaultPolicy/Resource`, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Schedule cleanup Lambda requires wildcard permissions for X-Ray, DynamoDB GSI, KMS, and EventBridge Scheduler listing',
                appliesTo: [
                    'Resource::*',
                    'Action::kms:GenerateDataKey*',
                    'Action::kms:ReEncrypt*',
                    'Resource::<SchedulesTableFBEB0188.Arn>/index/*',
                    `Resource::arn:aws:scheduler:${this.region}:${this.account}:schedule/postolio-scheduler-${environment}-schedules/*`,
                ],
            },
        ]);
        // Suppress Scheduler Role IAM wildcard permissions
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/SchedulerRole/DefaultPolicy/Resource`, [
            {
                id: 'AwsSolutions-IAM5',
                reason: 'EventBridge Scheduler role requires wildcard for Lambda invocation',
                appliesTo: ['Resource::<PublisherLambdaB2749827.Arn>:*'],
            },
        ]);
        // Suppress API Gateway CloudWatch Role managed policy
        cdk_nag_1.NagSuppressions.addResourceSuppressionsByPath(this, `/${this.stackName}/ApiGatewayCloudWatchRole/Resource`, [
            {
                id: 'AwsSolutions-IAM4',
                reason: 'API Gateway requires AWS managed policy for CloudWatch logging',
                appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs'],
            },
        ]);
        // Register Content Scheduler with Cloud Map
        (0, service_discovery_infrastructure_1.registerLambdaService)(serviceDiscovery, 'content-scheduler', this.api.url, environment);
        // ==================== Outputs ====================
        new cdk.CfnOutput(this, 'ApiEndpoint', {
            value: this.api.url,
            description: 'Content Scheduler API endpoint',
            // No export needed - services use Cloud Map for discovery
        });
        new cdk.CfnOutput(this, 'ApiArn', {
            value: this.api.arnForExecuteApi(),
            description: 'Content Scheduler API ARN for IAM permissions',
            // No export needed - services use Cloud Map for discovery
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
exports.ContentSchedulerStack = ContentSchedulerStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGVudC1zY2hlZHVsZXItc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjb250ZW50LXNjaGVkdWxlci1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFDbkMsbUVBQXFEO0FBQ3JELCtEQUFpRDtBQUNqRCw0RUFBOEQ7QUFDOUQsdUVBQXlEO0FBQ3pELHlEQUEyQztBQUMzQyx1REFBeUM7QUFDekMscUVBQXVEO0FBQ3ZELDJEQUE2QztBQUM3QywrREFBaUQ7QUFDakQsd0VBQTBEO0FBQzFELHVFQUF5RDtBQUN6RCx5REFBMkM7QUFDM0Msb0ZBQXNFO0FBQ3RFLCtFQUFpRTtBQUNqRSx5REFBMkM7QUFDM0MsNkRBQStDO0FBQy9DLHlEQUEyQztBQUMzQyxzRkFBd0U7QUFDeEUsbUZBQXNFO0FBQ3RFLHFDQUEwQztBQUUxQywyQ0FBNkI7QUFDN0IsZ0dBQXVJO0FBU3ZJLE1BQWEscUJBQXNCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDbEMsR0FBRyxDQUFxQjtJQUN4QixjQUFjLENBQWlCO0lBQy9CLFdBQVcsQ0FBWTtJQUV2QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWlDO1FBQ3pFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sRUFBRSxXQUFXLEVBQUUsVUFBVSxFQUFFLGFBQWEsRUFBRSwyQkFBMkIsRUFBRSxHQUFHLEtBQUssQ0FBQztRQUN0RixNQUFNLE1BQU0sR0FBRyxzQkFBc0IsV0FBVyxFQUFFLENBQUM7UUFFbkQsMENBQTBDO1FBQzFDLE1BQU0scUJBQXFCLEdBQUcsYUFBYSxJQUFJLHVCQUF1QixDQUFDO1FBRXZFLDZFQUE2RTtRQUU3RSx5Q0FBeUM7UUFDekMsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLDBEQUF1QixDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFB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eEMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUN6QyxLQUFLLEVBQUUsSUFBSSxDQUFDLFdBQVcsQ0FBQyxVQUFVO1lBQ2xDLFdBQVcsRUFBRSxzQkFBc0I7WUFDbkMsVUFBVSxFQUFFLEdBQUcsTUFBTSxlQUFlO1NBQ3JDLENBQUMsQ0FBQztRQUVILGlFQUFpRTtJQUNuRSxDQUFDO0NBQ0Y7QUFudUNELHNEQW11Q0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCAqIGFzIGxhbWJkYU5vZGVqcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqcyc7XG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5JztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgKiBhcyBzY2hlZHVsZXIgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNjaGVkdWxlcic7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCAqIGFzIGV2ZW50cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzJztcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcbmltcG9ydCAqIGFzIGNsb3Vkd2F0Y2ggZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gnO1xuaW1wb3J0ICogYXMgc25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMnO1xuaW1wb3J0ICogYXMgc25zU3Vic2NyaXB0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc25zLXN1YnNjcmlwdGlvbnMnO1xuaW1wb3J0ICogYXMgc2VjcmV0c21hbmFnZXIgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNlY3JldHNtYW5hZ2VyJztcbmltcG9ydCAqIGFzIHNxcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3FzJztcbmltcG9ydCAqIGFzIHdhZnYyIGZyb20gJ2F3cy1jZGstbGliL2F3cy13YWZ2Mic7XG5pbXBvcnQgKiBhcyBrbXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWttcyc7XG5pbXBvcnQgKiBhcyBjbG91ZHdhdGNoQWN0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaC1hY3Rpb25zJztcbmltcG9ydCB7IFNxc0V2ZW50U291cmNlIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ldmVudC1zb3VyY2VzJztcbmltcG9ydCB7IE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gJ2Nkay1uYWcnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgU2VydmljZURpc2NvdmVyeU1hbmFnZXIsIHJlZ2lzdGVyTGFtYmRhU2VydmljZSwgZ2V0U2VydmljZURpc2NvdmVyeUVudlZhcnMgfSBmcm9tICcuLi91dGlscy9zZXJ2aWNlLWRpc2NvdmVyeS1pbmZyYXN0cnVjdHVyZSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29udGVudFNjaGVkdWxlclN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIGVudmlyb25tZW50OiAnZGV2JyB8ICdzdGFnaW5nJyB8ICdwcm9kJztcbiAgYWxlcnRFbWFpbD86IHN0cmluZztcbiAgbWFpbkFwcEFwaVVybD86IHN0cmluZztcbiAgc2VydmljZURpc2NvdmVyeU5hbWVzcGFjZUlkPzogc3RyaW5nOyAvLyBVc2Ugc2hhcmVkIG5hbWVzcGFjZVxufVxuXG5leHBvcnQgY2xhc3MgQ29udGVudFNjaGVkdWxlclN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGFwaTogYXBpZ2F0ZXdheS5SZXN0QXBpO1xuICBwdWJsaWMgcmVhZG9ubHkgc2NoZWR1bGVzVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkgdmlkZW9CdWNrZXQ6IHMzLkJ1Y2tldDtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQ29udGVudFNjaGVkdWxlclN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgZW52aXJvbm1lbnQsIGFsZXJ0RW1haWwsIG1haW5BcHBBcGlVcmwsIHNlcnZpY2VEaXNjb3ZlcnlOYW1lc3BhY2VJZCB9ID0gcHJvcHM7XG4gICAgY29uc3QgcHJlZml4ID0gYHBvc3RvbGlvLXNjaGVkdWxlci0ke2Vudmlyb25tZW50fWA7XG4gICAgXG4gICAgLy8gQWxsIGVudmlyb25tZW50cyB1c2UgdGhlIHByb2R1Y3Rpb24gVVJMXG4gICAgY29uc3QgcmVzb2x2ZWRNYWluQXBwQXBpVXJsID0gbWFpbkFwcEFwaVVybCB8fCAnaHR0cHM6Ly9hcHAucG9zdG9sLmlvJztcbiAgICBcbiAgICAvLyBQdWJsaXNoZXIgTGFtYmRhIG5vdyB1c2VzIEFXUyBJQU0gU2lnVjQgYXV0aGVudGljYXRpb24gaW5zdGVhZCBvZiBBUEkga2V5c1xuXG4gICAgLy8gVXNlIHNoYXJlZCBTZXJ2aWNlIERpc2NvdmVyeSBuYW1lc3BhY2VcbiAgICBjb25zdCBzZXJ2aWNlRGlzY292ZXJ5ID0gbmV3IFNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyKHRoaXMsICdTZXJ2aWNlRGlzY292ZXJ5Jywge1xuICAgICAgZW52aXJvbm1lbnQsXG4gICAgICBleGlzdGluZ05hbWVzcGFjZUlkOiBzZXJ2aWNlRGlzY292ZXJ5TmFtZXNwYWNlSWQgfHwgY2RrLkZuLmltcG9ydFZhbHVlKGBTZXJ2aWNlRGlzY292ZXJ5LSR7ZW52aXJvbm1lbnR9LU5hbWVzcGFjZUlkYCksXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PSBLTVMgS2V5cyA9PT09PT09PT09PT09PT09PT09PVxuICAgIFxuICAgIGNvbnN0IGVuY3J5cHRpb25LZXkgPSBuZXcga21zLktleSh0aGlzLCAnRW5jcnlwdGlvbktleScsIHtcbiAgICAgIGFsaWFzOiBgJHtwcmVmaXh9LWtleWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0tNUyBrZXkgZm9yIENvbnRlbnQgU2NoZWR1bGVyIGVuY3J5cHRpb24nLFxuICAgICAgZW5hYmxlS2V5Um90YXRpb246IHRydWUsXG4gICAgICByZW1vdmFsUG9saWN5OiBlbnZpcm9ubWVudCA9PT0gJ3Byb2QnID8gY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOIDogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIC8vIFRoaXMgbWljcm9zZXJ2aWNlIHVzZXMgSUFNIFNpZ1Y0IGF1dGhlbnRpY2F0aW9uLlxuICAgIC8vIFRoZSBtYWluIFBvc3RvbGlvIGFwcGxpY2F0aW9uIGF1dGhlbnRpY2F0ZXMgdXNpbmcgQVdTIElBTSByb2xlcy9jcmVkZW50aWFscy5cblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09IER5bmFtb0RCIFRhYmxlcyB3aXRoIFBJVFIgPT09PT09PT09PT09PT09PT09PT1cbiAgICBcbiAgICAvLyBTY2hlZHVsZXMgVGFibGUgd2l0aCBQSVRSXG4gICAgdGhpcy5zY2hlZHVsZXNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnU2NoZWR1bGVzVGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6IGAke3ByZWZpeH0tc2NoZWR1bGVzYCxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAncGsnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgc29ydEtleTogeyBuYW1lOiAnc2snLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgYmlsbGluZ01vZGU6IGVudmlyb25tZW50ID09PSAncHJvZCcgPyBcbiAgICAgICAgZHluYW1vZGIuQmlsbGluZ01vZGUuUFJPVklTSU9ORUQgOiBcbiAgICAgICAgZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSwgLy8g4pyFIFBJVFIgZW5hYmxlZFxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkNVU1RPTUVSX01BTkFHRUQsXG4gICAgICBlbmNyeXB0aW9uS2V5OiBlbmNyeXB0aW9uS2V5LFxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsXG4gICAgICBzdHJlYW06IGR5bmFtb2RiLlN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFUyxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGVudmlyb25tZW50ID09PSAncHJvZCcgPyBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4gOiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIGF1dG8tc2NhbGluZyBmb3IgcHJvZHVjdGlvblxuICAgIGlmIChlbnZpcm9ubWVudCA9PT0gJ3Byb2QnKSB7XG4gICAgICBjb25zdCByZWFkU2NhbGluZyA9IHRoaXMuc2NoZWR1bGVzVGFibGUuYXV0b1NjYWxlUmVhZENhcGFjaXR5KHtcbiAgICAgICAgbWluQ2FwYWNpdHk6IDUsXG4gICAgICAgIG1heENhcGFjaXR5OiA1MDAsXG4gICAgICB9KTtcbiAgICAgIHJlYWRTY2FsaW5nLnNjYWxlT25VdGlsaXphdGlvbih7XG4gICAgICAgIHRhcmdldFV0aWxpemF0aW9uUGVyY2VudDogNzAsXG4gICAgICB9KTtcblxuICAgICAgY29uc3Qgd3JpdGVTY2FsaW5nID0gdGhpcy5zY2hlZHVsZXNUYWJsZS5hdXRvU2NhbGVXcml0ZUNhcGFjaXR5KHtcbiAgICAgICAgbWluQ2FwYWNpdHk6IDUsXG4gICAgICAgIG1heENhcGFjaXR5OiA1MDAsXG4gICAgICB9KTtcbiAgICAgIHdyaXRlU2NhbGluZy5zY2FsZU9uVXRpbGl6YXRpb24oe1xuICAgICAgICB0YXJnZXRVdGlsaXphdGlvblBlcmNlbnQ6IDcwLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gR1NJIGZvciBxdWVyeWluZyBieSBicmFuZFxuICAgIGNvbnN0IGJyYW5kSW5kZXhOYW1lID0gJ0dTSTEnOyAvLyBLZWVwIGV4aXN0aW5nIG5hbWUgZm9yIG5vd1xuICAgIHRoaXMuc2NoZWR1bGVzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiBicmFuZEluZGV4TmFtZSxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnZ3NpMXBrJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ2dzaTFzaycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxuICAgIH0pO1xuXG4gICAgLy8gR1NJIGZvciBxdWVyeWluZyBieSBzdGF0dXNcbiAgICBjb25zdCBzdGF0dXNJbmRleE5hbWUgPSAnR1NJMic7IC8vIEtlZXAgZXhpc3RpbmcgbmFtZSBmb3Igbm93XG4gICAgdGhpcy5zY2hlZHVsZXNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6IHN0YXR1c0luZGV4TmFtZSxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnc3RhdHVzJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3NjaGVkdWxlZEF0JywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5BTEwsXG4gICAgfSk7XG5cbiAgICAvLyBHU0kgZm9yIGRpcmVjdCBzY2hlZHVsZSBJRCBsb29rdXAgKG9wdGltaXplZCBmb3IgZ2V0U2NoZWR1bGVCeUlkKVxuICAgIGNvbnN0IHNjaGVkdWxlSWRJbmRleE5hbWUgPSAnR1NJLVNjaGVkdWxlSWQnO1xuICAgIHRoaXMuc2NoZWR1bGVzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiBzY2hlZHVsZUlkSW5kZXhOYW1lLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdzY2hlZHVsZUlkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5BTEwsXG4gICAgfSk7XG5cbiAgICAvLyBHU0kgZm9yIGNvbnRlbnQgSUQgbG9va3VwICh0byBjaGVjayBmb3IgZXhpc3Rpbmcgc2NoZWR1bGVzKVxuICAgIGNvbnN0IGNvbnRlbnRJZEluZGV4TmFtZSA9ICdieS1jb250ZW50LWlkJztcbiAgICB0aGlzLnNjaGVkdWxlc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogY29udGVudElkSW5kZXhOYW1lLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdjb250ZW50SWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgc29ydEtleTogeyBuYW1lOiAnc2NoZWR1bGVkQXQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcbiAgICB9KTtcblxuICAgIC8vIFJldHJ5IFF1ZXVlIFRhYmxlIHdpdGggUElUUlxuICAgIGNvbnN0IHJldHJ5UXVldWVUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnUmV0cnlRdWV1ZVRhYmxlJywge1xuICAgICAgdGFibGVOYW1lOiBgJHtwcmVmaXh9LXJldHJ5LXF1ZXVlYCxcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnc2NoZWR1bGVJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdhdHRlbXB0TnVtYmVyJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5OVU1CRVIgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLCAvLyDinIUgUElUUiBlbmFibGVkXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQ1VTVE9NRVJfTUFOQUdFRCxcbiAgICAgIGVuY3J5cHRpb25LZXk6IGVuY3J5cHRpb25LZXksXG4gICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiAndHRsJyxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICAvLyBBdWRpdCBMb2cgVGFibGUgd2l0aCBQSVRSIChHRFBSIENvbXBsaWFuY2UpXG4gICAgY29uc3QgYXVkaXRMb2dUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnQXVkaXRMb2dUYWJsZScsIHtcbiAgICAgIHRhYmxlTmFtZTogYCR7cHJlZml4fS1hdWRpdC1sb2dgLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdwaycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICd0aW1lc3RhbXAnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsIC8vIOKchSBQSVRSIGVuYWJsZWRcbiAgICAgIGVuY3J5cHRpb246IGR5bmFtb2RiLlRhYmxlRW5jcnlwdGlvbi5DVVNUT01FUl9NQU5BR0VELFxuICAgICAgZW5jcnlwdGlvbktleTogZW5jcnlwdGlvbktleSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGVudmlyb25tZW50ID09PSAncHJvZCcgPyBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4gOiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT0gUzMgQnVja2V0cyB3aXRoIEFjY2VzcyBMb2dnaW5nID09PT09PT09PT09PT09PT09PT09XG4gICAgXG4gICAgLy8gQWNjZXNzIExvZ3MgQnVja2V0XG4gICAgY29uc3QgYWNjZXNzTG9nc0J1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ0FjY2Vzc0xvZ3NCdWNrZXQnLCB7XG4gICAgICBidWNrZXROYW1lOiBgJHtwcmVmaXh9LWFjY2Vzcy1sb2dzYCxcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ2RlbGV0ZS1vbGQtbG9ncycsXG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICBleHBpcmF0aW9uOiBjZGsuRHVyYXRpb24uZGF5cygzMCksXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIFZpZGVvIFN0b3JhZ2UgQnVja2V0IHdpdGggQWNjZXNzIExvZ2dpbmdcbiAgICB0aGlzLnZpZGVvQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnVmlkZW9CdWNrZXQnLCB7XG4gICAgICBidWNrZXROYW1lOiBgJHtwcmVmaXh9LXZpZGVvc2AsXG4gICAgICBlbmNyeXB0aW9uOiBzMy5CdWNrZXRFbmNyeXB0aW9uLktNUyxcbiAgICAgIGVuY3J5cHRpb25LZXk6IGVuY3J5cHRpb25LZXksXG4gICAgICBzZXJ2ZXJBY2Nlc3NMb2dzQnVja2V0OiBhY2Nlc3NMb2dzQnVja2V0LCAvLyDinIUgQWNjZXNzIGxvZ2dpbmcgZW5hYmxlZFxuICAgICAgc2VydmVyQWNjZXNzTG9nc1ByZWZpeDogJ3ZpZGVvLWJ1Y2tldC1sb2dzLycsXG4gICAgICB2ZXJzaW9uZWQ6IHRydWUsXG4gICAgICB0cmFuc2ZlckFjY2VsZXJhdGlvbjogdHJ1ZSwgLy8g4pyFIEVuYWJsZSBmb3IgZmFzdGVyIHZpZGVvIHVwbG9hZHNcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ2RlbGV0ZS1pbmNvbXBsZXRlLW11bHRpcGFydC11cGxvYWRzJyxcbiAgICAgICAgICBhYm9ydEluY29tcGxldGVNdWx0aXBhcnRVcGxvYWRBZnRlcjogY2RrLkR1cmF0aW9uLmRheXMoNyksXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ2ludGVsbGlnZW50LXRpZXJpbmcnLFxuICAgICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgdHJhbnNpdGlvbnM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3RvcmFnZUNsYXNzOiBzMy5TdG9yYWdlQ2xhc3MuSU5URUxMSUdFTlRfVElFUklORyxcbiAgICAgICAgICAgICAgdHJhbnNpdGlvbkFmdGVyOiBjZGsuRHVyYXRpb24uZGF5cygwKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnZ2Rwci1jb21wbGlhbmNlLWRlbGV0aW9uJyxcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIGV4cGlyYXRpb246IGNkay5EdXJhdGlvbi5kYXlzKDkwKSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICBjb3JzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogW3MzLkh0dHBNZXRob2RzLkdFVCwgczMuSHR0cE1ldGhvZHMuUFVULCBzMy5IdHRwTWV0aG9kcy5QT1NUXSxcbiAgICAgICAgICBhbGxvd2VkT3JpZ2luczogZW52aXJvbm1lbnQgPT09ICdwcm9kJyA/IFsnaHR0cHM6Ly9wb3N0b2wuaW8nXSA6IFsnaHR0cDovL2xvY2FsaG9zdDozMDAwJ10sXG4gICAgICAgICAgYWxsb3dlZEhlYWRlcnM6IFsnKiddLFxuICAgICAgICAgIG1heEFnZTogMzAwMCxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgICAgcmVtb3ZhbFBvbGljeTogZW52aXJvbm1lbnQgPT09ICdwcm9kJyA/IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTiA6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogZW52aXJvbm1lbnQgIT09ICdwcm9kJyxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09IFNlY3JldHMgd2l0aCBSb3RhdGlvbiA9PT09PT09PT09PT09PT09PT09PVxuICAgIFxuICAgIGNvbnN0IHBsYXRmb3JtQ3JlZGVudGlhbHMgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdQbGF0Zm9ybUNyZWRlbnRpYWxzJywge1xuICAgICAgc2VjcmV0TmFtZTogYCR7cHJlZml4fS1wbGF0Zm9ybS1jcmVkZW50aWFsc2AsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NvY2lhbCBtZWRpYSBwbGF0Zm9ybSBBUEkgY3JlZGVudGlhbHMnLFxuICAgICAgZ2VuZXJhdGVTZWNyZXRTdHJpbmc6IHtcbiAgICAgICAgc2VjcmV0U3RyaW5nVGVtcGxhdGU6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBpbnN0YWdyYW06IHsgY2xpZW50SWQ6ICcnLCBjbGllbnRTZWNyZXQ6ICcnLCBhY2Nlc3NUb2tlbjogJycgfSxcbiAgICAgICAgICB0aWt0b2s6IHsgY2xpZW50S2V5OiAnJywgY2xpZW50U2VjcmV0OiAnJywgYWNjZXNzVG9rZW46ICcnIH0sXG4gICAgICAgICAgeW91dHViZTogeyBhcGlLZXk6ICcnLCBjbGllbnRJZDogJycsIGNsaWVudFNlY3JldDogJycgfSxcbiAgICAgICAgfSksXG4gICAgICAgIGdlbmVyYXRlU3RyaW5nS2V5OiAndGVtcCcsXG4gICAgICB9LFxuICAgICAgLy8gTm90ZTogQXV0b21hdGljIHJvdGF0aW9uIHdvdWxkIGJlIGNvbmZpZ3VyZWQgc2VwYXJhdGVseVxuICAgICAgLy8gYXV0b21hdGljUm90YXRpb24gcmVxdWlyZXMgYSByb3RhdGlvbiBMYW1iZGEgZnVuY3Rpb25cbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09IERlYWQgTGV0dGVyIFF1ZXVlcyA9PT09PT09PT09PT09PT09PT09PVxuICAgIFxuICAgIGNvbnN0IGRlYWRMZXR0ZXJRdWV1ZSA9IG5ldyBzcXMuUXVldWUodGhpcywgJ0RlYWRMZXR0ZXJRdWV1ZScsIHtcbiAgICAgIHF1ZXVlTmFtZTogYCR7cHJlZml4fS1kbHFgLFxuICAgICAgZW5jcnlwdGlvbjogc3FzLlF1ZXVlRW5jcnlwdGlvbi5LTVMsXG4gICAgICBlbmNyeXB0aW9uTWFzdGVyS2V5OiBlbmNyeXB0aW9uS2V5LFxuICAgICAgcmV0ZW50aW9uUGVyaW9kOiBjZGsuRHVyYXRpb24uZGF5cygxNCksXG4gICAgICAvLyBWaXNpYmlsaXR5IHRpbWVvdXQgbXVzdCBiZSA+PSBMYW1iZGEgdGltZW91dCAoNjAgc2Vjb25kcykgKiA2XG4gICAgICB2aXNpYmlsaXR5VGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzYwKSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09IExhbWJkYSBMYXllciBmb3IgUG93ZXJ0b29scyA9PT09PT09PT09PT09PT09PT09PVxuICAgIFxuICAgIGNvbnN0IHBvd2VydG9vbHNMYXllciA9IG5ldyBsYW1iZGEuTGF5ZXJWZXJzaW9uKHRoaXMsICdQb3dlcnRvb2xzTGF5ZXInLCB7XG4gICAgICBsYXllclZlcnNpb25OYW1lOiBgJHtwcmVmaXh9LXBvd2VydG9vbHNgLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9sYXllcnMvcG93ZXJ0b29scycpKSxcbiAgICAgIGNvbXBhdGlibGVSdW50aW1lczogW2xhbWJkYS5SdW50aW1lLk5PREVKU18yMl9YXSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVdTIExhbWJkYSBQb3dlcnRvb2xzIGZvciBUeXBlU2NyaXB0JyxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09IExhbWJkYSBGdW5jdGlvbnMgd2l0aCBCZXN0IFByYWN0aWNlcyA9PT09PT09PT09PT09PT09PT09PVxuICAgIFxuICAgIC8vIFNoYXJlZCBMYW1iZGEgZW52aXJvbm1lbnQgdmFyaWFibGVzIFxuICAgIGNvbnN0IGxhbWJkYUVudmlyb25tZW50ID0ge1xuICAgICAgRU5WSVJPTk1FTlQ6IGVudmlyb25tZW50LFxuICAgICAgU0NIRURVTEVTX1RBQkxFOiB0aGlzLnNjaGVkdWxlc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgIFNDSEVEVUxFU19UQUJMRV9CUkFORF9JTkRFWDogYnJhbmRJbmRleE5hbWUsXG4gICAgICBTQ0hFRFVMRVNfVEFCTEVfU1RBVFVTX0lOREVYOiBzdGF0dXNJbmRleE5hbWUsXG4gICAgICBSRVRSWV9RVUVVRV9UQUJMRTogcmV0cnlRdWV1ZVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgIEFVRElUX0xPR19UQUJMRTogYXVkaXRMb2dUYWJsZS50YWJsZU5hbWUsXG4gICAgICBWSURFT19CVUNLRVQ6IHRoaXMudmlkZW9CdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgIFBMQVRGT1JNX0NSRURFTlRJQUxTX1NFQ1JFVDogcGxhdGZvcm1DcmVkZW50aWFscy5zZWNyZXRBcm4sXG4gICAgICAvLyBNQUlOX0FQUF9BUElfVVJMIHJlbW92ZWQgLSBwdWJsaXNoZXIgbm93IHVzZXMgY29udGVudCBmcm9tIER5bmFtb0RCXG4gICAgICBQT1dFUlRPT0xTX1NFUlZJQ0VfTkFNRTogJ2NvbnRlbnQtc2NoZWR1bGVyJyxcbiAgICAgIFBPV0VSVE9PTFNfTUVUUklDU19OQU1FU1BBQ0U6ICdDb250ZW50U2NoZWR1bGVyJyxcbiAgICAgIExPR19MRVZFTDogZW52aXJvbm1lbnQgPT09ICdwcm9kJyA/ICdJTkZPJyA6ICdERUJVRycsXG4gICAgICBTQ0hFRFVMRVJfR1JPVVBfTkFNRTogYCR7cHJlZml4fS1zY2hlZHVsZXNgLFxuICAgICAgLi4uZ2V0U2VydmljZURpc2NvdmVyeUVudlZhcnMoc2VydmljZURpc2NvdmVyeS5nZXRDbGllbnRDb25maWcoKSksXG4gICAgfTtcblxuICAgIC8vIEN1c3RvbSBJQU0gUm9sZSBmb3IgTGFtYmRhIChMZWFzdCBQcml2aWxlZ2UpXG4gICAgY29uc3QgbGFtYmRhUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnTGFtYmRhRXhlY3V0aW9uUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgZGVzY3JpcHRpb246ICdDdXN0b20gZXhlY3V0aW9uIHJvbGUgZm9yIENvbnRlbnQgU2NoZWR1bGVyIExhbWJkYSBmdW5jdGlvbnMnLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIG9ubHkgbmVjZXNzYXJ5IHBlcm1pc3Npb25zXG4gICAgbGFtYmRhUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdsb2dzOkNyZWF0ZUxvZ0dyb3VwJyxcbiAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nU3RyZWFtJyxcbiAgICAgICAgJ2xvZ3M6UHV0TG9nRXZlbnRzJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtgYXJuOmF3czpsb2dzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpsb2ctZ3JvdXA6L2F3cy9sYW1iZGEvJHtwcmVmaXh9LSpgXSxcbiAgICB9KSk7XG5cbiAgICAvLyBBZGQgWC1SYXkgdHJhY2luZyBwZXJtaXNzaW9uc1xuICAgIGxhbWJkYVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogWyd4cmF5OlB1dFRyYWNlU2VnbWVudHMnLCAneHJheTpQdXRUZWxlbWV0cnlSZWNvcmRzJ10sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIC8vIFNjaGVkdWxlIE1hbmFnZW1lbnQgTGFtYmRhIHdpdGggTm9kZS5qcyAyMi54XG4gICAgY29uc3Qgc2NoZWR1bGVNYW5hZ2VtZW50TGFtYmRhID0gbmV3IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCAnU2NoZWR1bGVNYW5hZ2VtZW50TGFtYmRhJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgJHtwcmVmaXh9LXNjaGVkdWxlLW1hbmFnZW1lbnRgLFxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIyX1gsIC8vIOKchSBMYXRlc3QgcnVudGltZVxuICAgICAgaGFuZGxlcjogJ2hhbmRsZXInLFxuICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9sYW1iZGEvc2NoZWR1bGUtbWFuYWdlbWVudC9pbmRleC50cycpLFxuICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgbWluaWZ5OiBlbnZpcm9ubWVudCA9PT0gJ3Byb2QnLFxuICAgICAgICBzb3VyY2VNYXA6IGVudmlyb25tZW50ICE9PSAncHJvZCcsXG4gICAgICAgIGV4dGVybmFsTW9kdWxlczogW1xuICAgICAgICAgICdAYXdzLWxhbWJkYS1wb3dlcnRvb2xzL2xvZ2dlcicsIFxuICAgICAgICAgICdAYXdzLWxhbWJkYS1wb3dlcnRvb2xzL3RyYWNlcicsIFxuICAgICAgICAgICdAYXdzLWxhbWJkYS1wb3dlcnRvb2xzL21ldHJpY3MnLFxuICAgICAgICAgICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInLFxuICAgICAgICAgICdAYXdzLXNkay9saWItZHluYW1vZGInLFxuICAgICAgICAgICdAYXdzLXNkay9jbGllbnQtc2NoZWR1bGVyJyxcbiAgICAgICAgICAnQGF3cy1zZGsvKidcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICBtZW1vcnlTaXplOiAxMDI0LFxuICAgICAgcmVzZXJ2ZWRDb25jdXJyZW50RXhlY3V0aW9uczogZW52aXJvbm1lbnQgPT09ICdwcm9kJyA/IDEwIDogdW5kZWZpbmVkLFxuICAgICAgZW52aXJvbm1lbnQ6IGxhbWJkYUVudmlyb25tZW50LFxuICAgICAgbGF5ZXJzOiBbcG93ZXJ0b29sc0xheWVyXSxcbiAgICAgIC8vIFVzaW5nIGRlZmF1bHQgcm9sZSB0byBhdm9pZCBjaXJjdWxhciBkZXBlbmRlbmNpZXNcbiAgICAgIHRyYWNpbmc6IGxhbWJkYS5UcmFjaW5nLkFDVElWRSxcbiAgICAgIC8vIGxvZ1JldGVudGlvbiByZW1vdmVkIHRvIGF2b2lkIGNpcmN1bGFyIGRlcGVuZGVuY2llc1xuICAgICAgZGVhZExldHRlclF1ZXVlRW5hYmxlZDogdHJ1ZSxcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZTogZGVhZExldHRlclF1ZXVlLFxuICAgIH0pO1xuXG4gICAgLy8gUHVibGlzaGVyIExhbWJkYSB3aXRoIHByb3BlciBjb25maWd1cmF0aW9uXG4gICAgY29uc3QgcHVibGlzaGVyTGFtYmRhID0gbmV3IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCAnUHVibGlzaGVyTGFtYmRhJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgJHtwcmVmaXh9LXB1Ymxpc2hlcmAsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjJfWCwgLy8g4pyFIExhdGVzdCBydW50aW1lXG4gICAgICBoYW5kbGVyOiAnaGFuZGxlcicsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2xhbWJkYS9wdWJsaXNoZXIvaW5kZXgudHMnKSxcbiAgICAgIGJ1bmRsaW5nOiB7XG4gICAgICAgIG1pbmlmeTogZW52aXJvbm1lbnQgPT09ICdwcm9kJyxcbiAgICAgICAgc291cmNlTWFwOiBlbnZpcm9ubWVudCAhPT0gJ3Byb2QnLFxuICAgICAgICBleHRlcm5hbE1vZHVsZXM6IFtcbiAgICAgICAgICAnQGF3cy1sYW1iZGEtcG93ZXJ0b29scy9sb2dnZXInLCBcbiAgICAgICAgICAnQGF3cy1sYW1iZGEtcG93ZXJ0b29scy90cmFjZXInLCBcbiAgICAgICAgICAnQGF3cy1sYW1iZGEtcG93ZXJ0b29scy9tZXRyaWNzJyxcbiAgICAgICAgICAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJyxcbiAgICAgICAgICAnQGF3cy1zZGsvbGliLWR5bmFtb2RiJyxcbiAgICAgICAgICAnQGF3cy1zZGsvY2xpZW50LXNjaGVkdWxlcicsXG4gICAgICAgICAgJ0Bhd3Mtc2RrLyonXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICBtZW1vcnlTaXplOiAyMDQ4LFxuICAgICAgcmVzZXJ2ZWRDb25jdXJyZW50RXhlY3V0aW9uczogZW52aXJvbm1lbnQgPT09ICdwcm9kJyA/IDUwIDogdW5kZWZpbmVkLFxuICAgICAgZW52aXJvbm1lbnQ6IGxhbWJkYUVudmlyb25tZW50LFxuICAgICAgbGF5ZXJzOiBbcG93ZXJ0b29sc0xheWVyXSxcbiAgICAgIC8vIFVzaW5nIGRlZmF1bHQgcm9sZSB0byBhdm9pZCBjaXJjdWxhciBkZXBlbmRlbmNpZXNcbiAgICAgIHRyYWNpbmc6IGxhbWJkYS5UcmFjaW5nLkFDVElWRSxcbiAgICAgIC8vIGxvZ1JldGVudGlvbiByZW1vdmVkIHRvIGF2b2lkIGNpcmN1bGFyIGRlcGVuZGVuY2llc1xuICAgICAgZGVhZExldHRlclF1ZXVlRW5hYmxlZDogdHJ1ZSxcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZTogZGVhZExldHRlclF1ZXVlLFxuICAgIH0pO1xuXG4gICAgLy8gUmV0cnkgSGFuZGxlciBMYW1iZGFcbiAgICBjb25zdCByZXRyeUhhbmRsZXJMYW1iZGEgPSBuZXcgbGFtYmRhTm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsICdSZXRyeUhhbmRsZXJMYW1iZGEnLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6IGAke3ByZWZpeH0tcmV0cnktaGFuZGxlcmAsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjJfWCwgLy8g4pyFIExhdGVzdCBydW50aW1lXG4gICAgICBoYW5kbGVyOiAnaGFuZGxlcicsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2xhbWJkYS9yZXRyeS1oYW5kbGVyL2luZGV4LnRzJyksXG4gICAgICBidW5kbGluZzoge1xuICAgICAgICBtaW5pZnk6IGVudmlyb25tZW50ID09PSAncHJvZCcsXG4gICAgICAgIHNvdXJjZU1hcDogZW52aXJvbm1lbnQgIT09ICdwcm9kJyxcbiAgICAgICAgZXh0ZXJuYWxNb2R1bGVzOiBbXG4gICAgICAgICAgJ0Bhd3MtbGFtYmRhLXBvd2VydG9vbHMvbG9nZ2VyJywgXG4gICAgICAgICAgJ0Bhd3MtbGFtYmRhLXBvd2VydG9vbHMvdHJhY2VyJywgXG4gICAgICAgICAgJ0Bhd3MtbGFtYmRhLXBvd2VydG9vbHMvbWV0cmljcycsXG4gICAgICAgICAgJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYicsXG4gICAgICAgICAgJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYicsXG4gICAgICAgICAgJ0Bhd3Mtc2RrL2NsaWVudC1zY2hlZHVsZXInLFxuICAgICAgICAgICdAYXdzLXNkay8qJ1xuICAgICAgICBdLFxuICAgICAgfSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpLFxuICAgICAgbWVtb3J5U2l6ZTogNTEyLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgLi4ubGFtYmRhRW52aXJvbm1lbnQsXG4gICAgICAgIFBVQkxJU0hFUl9MQU1CREFfQVJOOiBwdWJsaXNoZXJMYW1iZGEuZnVuY3Rpb25Bcm4sXG4gICAgICAgIFNDSEVEVUxFU19UQUJMRTogdGhpcy5zY2hlZHVsZXNUYWJsZS50YWJsZU5hbWUsXG4gICAgICB9LFxuICAgICAgbGF5ZXJzOiBbcG93ZXJ0b29sc0xheWVyXSxcbiAgICAgIC8vIFVzaW5nIGRlZmF1bHQgcm9sZSB0byBhdm9pZCBjaXJjdWxhciBkZXBlbmRlbmNpZXNcbiAgICAgIHRyYWNpbmc6IGxhbWJkYS5UcmFjaW5nLkFDVElWRSxcbiAgICAgIC8vIGxvZ1JldGVudGlvbiByZW1vdmVkIHRvIGF2b2lkIGNpcmN1bGFyIGRlcGVuZGVuY2llc1xuICAgIH0pO1xuXG4gICAgLy8gU2NoZWR1bGUgQ2xlYW51cCBMYW1iZGE6IHJ1bnMgZGFpbHkgdG8gY2xlYW4gdXAgb3JwaGFuZWQgc2NoZWR1bGVzXG4gICAgY29uc3Qgc2NoZWR1bGVDbGVhbnVwTGFtYmRhID0gbmV3IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCAnU2NoZWR1bGVDbGVhbnVwTGFtYmRhJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgJHtwcmVmaXh9LXNjaGVkdWxlLWNsZWFudXBgLFxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIyX1gsXG4gICAgICBoYW5kbGVyOiAnaGFuZGxlcicsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2xhbWJkYS9zY2hlZHVsZS1jbGVhbnVwL2luZGV4LnRzJyksXG4gICAgICBidW5kbGluZzoge1xuICAgICAgICBtaW5pZnk6IGVudmlyb25tZW50ID09PSAncHJvZCcsXG4gICAgICAgIHNvdXJjZU1hcDogZW52aXJvbm1lbnQgIT09ICdwcm9kJyxcbiAgICAgICAgZXh0ZXJuYWxNb2R1bGVzOiBbXG4gICAgICAgICAgJ0Bhd3MtbGFtYmRhLXBvd2VydG9vbHMvbG9nZ2VyJyxcbiAgICAgICAgICAnQGF3cy1sYW1iZGEtcG93ZXJ0b29scy90cmFjZXInLFxuICAgICAgICAgICdAYXdzLWxhbWJkYS1wb3dlcnRvb2xzL21ldHJpY3MnLFxuICAgICAgICAgICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInLFxuICAgICAgICAgICdAYXdzLXNkay9saWItZHluYW1vZGInLFxuICAgICAgICAgICdAYXdzLXNkay9jbGllbnQtc2NoZWR1bGVyJyxcbiAgICAgICAgICAnQGF3cy1zZGsvKicsXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICBtZW1vcnlTaXplOiA1MTIsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAuLi5sYW1iZGFFbnZpcm9ubWVudCxcbiAgICAgICAgU0NIRURVTEVSX0dST1VQX05BTUU6IGAke3ByZWZpeH0tc2NoZWR1bGVzYCxcbiAgICAgICAgU0NIRURVTEVTX1RBQkxFX1NDSEVEVUxFX0lOREVYOiBzY2hlZHVsZUlkSW5kZXhOYW1lLFxuICAgICAgfSxcbiAgICAgIGxheWVyczogW3Bvd2VydG9vbHNMYXllcl0sXG4gICAgICB0cmFjaW5nOiBsYW1iZGEuVHJhY2luZy5BQ1RJVkUsXG4gICAgfSk7XG4gICAgXG4gICAgLy8gQ3JlYXRlIEV2ZW50QnJpZGdlIHJ1bGUgdG8gcnVuIGNsZWFudXAgTGFtYmRhIGRhaWx5IGF0IDMgQU0gVVRDXG4gICAgY29uc3QgY2xlYW51cFJ1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ1NjaGVkdWxlQ2xlYW51cFJ1bGUnLCB7XG4gICAgICBydWxlTmFtZTogYCR7cHJlZml4fS1jbGVhbnVwLWRhaWx5YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUnVucyBzY2hlZHVsZSBjbGVhbnVwIExhbWJkYSBkYWlseSB0byByZW1vdmUgb3JwaGFuZWQgc2NoZWR1bGVzJyxcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUuY3Jvbih7IGhvdXI6ICczJywgbWludXRlOiAnMCcgfSksIC8vIERhaWx5IGF0IDM6MDAgQU0gVVRDXG4gICAgfSk7XG4gICAgXG4gICAgLy8gQWRkIExhbWJkYSBhcyB0YXJnZXQgZm9yIHRoZSBFdmVudEJyaWRnZSBydWxlXG4gICAgY2xlYW51cFJ1bGUuYWRkVGFyZ2V0KG5ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKHNjaGVkdWxlQ2xlYW51cExhbWJkYSkpO1xuXG4gICAgLy8gU3RhdHVzIFN5bmMgTGFtYmRhOiB1cGRhdGVzIG1haW4gUG9zdGdyZVNRTCBiYXNlZCBvbiBFdmVudEJyaWRnZSBldmVudHNcbiAgICBjb25zdCBzdGF0dXNTeW5jTGFtYmRhID0gbmV3IGxhbWJkYU5vZGVqcy5Ob2RlanNGdW5jdGlvbih0aGlzLCAnU3RhdHVzU3luY0xhbWJkYScsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogYCR7cHJlZml4fS1zdGF0dXMtc3luY2AsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjJfWCxcbiAgICAgIGhhbmRsZXI6ICdoYW5kbGVyJyxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vbGFtYmRhL3N0YXR1cy1zeW5jL2luZGV4LnRzJyksXG4gICAgICByb2xlOiBsYW1iZGFSb2xlLFxuICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgbWluaWZ5OiBlbnZpcm9ubWVudCA9PT0gJ3Byb2QnLFxuICAgICAgICBzb3VyY2VNYXA6IGVudmlyb25tZW50ICE9PSAncHJvZCcsXG4gICAgICAgIGV4dGVybmFsTW9kdWxlczogW1xuICAgICAgICAgICdAYXdzLXNkay8qJyxcbiAgICAgICAgICAnQGF3cy1sYW1iZGEtcG93ZXJ0b29scy9sb2dnZXInLFxuICAgICAgICAgICdAYXdzLWxhbWJkYS1wb3dlcnRvb2xzL3RyYWNlcicsXG4gICAgICAgICAgJ0Bhd3MtbGFtYmRhLXBvd2VydG9vbHMvbWV0cmljcycsXG4gICAgICAgIF0sXG4gICAgICAgIG5vZGVNb2R1bGVzOiBbXG4gICAgICAgICAgJ0BwcmlzbWEvY2xpZW50J1xuICAgICAgICBdLFxuICAgICAgICBjb21tYW5kSG9va3M6IHtcbiAgICAgICAgICBiZWZvcmVCdW5kbGluZygpIHsgcmV0dXJuIFtdIH0sXG4gICAgICAgICAgYmVmb3JlSW5zdGFsbCgpIHsgcmV0dXJuIFtdIH0sXG4gICAgICAgICAgYWZ0ZXJCdW5kbGluZyhpbnB1dERpcjogc3RyaW5nLCBvdXRwdXREaXI6IHN0cmluZykge1xuICAgICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICAgYGNwIC1yICR7aW5wdXREaXJ9L25vZGVfbW9kdWxlcy8ucHJpc21hICR7b3V0cHV0RGlyfS9gLFxuICAgICAgICAgICAgICBgbWtkaXIgLXAgJHtvdXRwdXREaXJ9L25vZGVfbW9kdWxlcy9AcHJpc21hL2AsXG4gICAgICAgICAgICAgIGBjcCAtciAke2lucHV0RGlyfS9ub2RlX21vZHVsZXMvQHByaXNtYS9jbGllbnQgJHtvdXRwdXREaXJ9L25vZGVfbW9kdWxlcy9AcHJpc21hL2AsXG4gICAgICAgICAgICBdXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgbWVtb3J5U2l6ZTogMTAyNCxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIC4uLmxhbWJkYUVudmlyb25tZW50LFxuICAgICAgICAvLyBFeHBlY3QgREFUQUJBU0VfVVJMIHRvIGJlIHNldCB2aWEgc3RhY2sgcGFyYW1ldGVycyBvciBlbnZpcm9ubWVudCBjb25maWdcbiAgICAgIH0sXG4gICAgICB0cmFjaW5nOiBsYW1iZGEuVHJhY2luZy5BQ1RJVkUsXG4gICAgICBkZWFkTGV0dGVyUXVldWVFbmFibGVkOiB0cnVlLFxuICAgICAgZGVhZExldHRlclF1ZXVlOiBkZWFkTGV0dGVyUXVldWUsXG4gICAgfSk7XG5cbiAgICAvLyBMb2dnaW5nIHBlcm1pc3Npb25zIGFyZSBwcm92aWRlZCB2aWEgdGhlIHNoYXJlZCBMYW1iZGFFeGVjdXRpb25Sb2xlIChsYW1iZGFSb2xlKSB3aXRoIHNjb3BlZCByZXNvdXJjZXNcblxuICAgIC8vIEV2ZW50QnJpZGdlIHJ1bGUgdG8gZm9yd2FyZCBwbGF0Zm9ybSBwdWJsaXNoaW5nIGV2ZW50cyB0byBTdGF0dXMgU3luYyBMYW1iZGFcbiAgICBjb25zdCBzdGF0dXNTeW5jUnVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCAnU3RhdHVzU3luY1J1bGUnLCB7XG4gICAgICBydWxlTmFtZTogYCR7cHJlZml4fS1zdGF0dXMtc3luY2AsXG4gICAgICBldmVudFBhdHRlcm46IHtcbiAgICAgICAgc291cmNlOiBbJ3Bvc3RvbGlvLnBsYXRmb3JtJywgJ3Bvc3RvbGlvLnNjaGVkdWxlciddLFxuICAgICAgICBkZXRhaWxUeXBlOiBbJ3Bvc3QucHVibGlzaGVkJywgJ3Bvc3QuZmFpbGVkJywgJ3NjaGVkdWxlLmNyZWF0ZWQnLCAnc2NoZWR1bGUudXBkYXRlZCcsICdzY2hlZHVsZS5jYW5jZWxlZCddLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBzdGF0dXNTeW5jUnVsZS5hZGRUYXJnZXQobmV3IHRhcmdldHMuTGFtYmRhRnVuY3Rpb24oc3RhdHVzU3luY0xhbWJkYSkpO1xuXG4gICAgLy8gQWRkIERMUSBhcyBldmVudCBzb3VyY2UgZm9yIHJldHJ5IGhhbmRsZXJcbiAgICByZXRyeUhhbmRsZXJMYW1iZGEuYWRkRXZlbnRTb3VyY2UobmV3IFNxc0V2ZW50U291cmNlKGRlYWRMZXR0ZXJRdWV1ZSwge1xuICAgICAgYmF0Y2hTaXplOiAxMCxcbiAgICAgIG1heEJhdGNoaW5nV2luZG93OiBjZGsuRHVyYXRpb24uc2Vjb25kcyg1KSxcbiAgICB9KSk7XG5cbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyB1c2luZyBsZWFzdCBwcml2aWxlZ2VcbiAgICB0aGlzLnNjaGVkdWxlc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShzY2hlZHVsZU1hbmFnZW1lbnRMYW1iZGEpO1xuICAgIHRoaXMuc2NoZWR1bGVzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHB1Ymxpc2hlckxhbWJkYSk7XG4gICAgdGhpcy5zY2hlZHVsZXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEocmV0cnlIYW5kbGVyTGFtYmRhKTsgLy8gTmVlZCB0byB1cGRhdGUgc2NoZWR1bGUgc3RhdHVzIG9uIGZhaWx1cmVcbiAgICB0aGlzLnNjaGVkdWxlc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShzY2hlZHVsZUNsZWFudXBMYW1iZGEpOyAvLyBOZWVkIHRvIGNsZWFudXAgb3JwaGFuZWQgZW50cmllc1xuICAgIHJldHJ5UXVldWVUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEocHVibGlzaGVyTGFtYmRhKTtcbiAgICByZXRyeVF1ZXVlVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHJldHJ5SGFuZGxlckxhbWJkYSk7XG4gICAgYXVkaXRMb2dUYWJsZS5ncmFudFdyaXRlRGF0YShzY2hlZHVsZU1hbmFnZW1lbnRMYW1iZGEpO1xuICAgIGF1ZGl0TG9nVGFibGUuZ3JhbnRXcml0ZURhdGEocHVibGlzaGVyTGFtYmRhKTtcbiAgICB0aGlzLnZpZGVvQnVja2V0LmdyYW50UmVhZFdyaXRlKHB1Ymxpc2hlckxhbWJkYSk7XG4gICAgcGxhdGZvcm1DcmVkZW50aWFscy5ncmFudFJlYWQocHVibGlzaGVyTGFtYmRhKTtcbiAgICBwdWJsaXNoZXJMYW1iZGEuZ3JhbnRJbnZva2UocmV0cnlIYW5kbGVyTGFtYmRhKTtcbiAgICBkZWFkTGV0dGVyUXVldWUuZ3JhbnRDb25zdW1lTWVzc2FnZXMocmV0cnlIYW5kbGVyTGFtYmRhKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09IEV2ZW50QnJpZGdlIFNjaGVkdWxlciAoTW9kZXJuIEFQSSkgPT09PT09PT09PT09PT09PT09PT1cbiAgICBcbiAgICBjb25zdCBzY2hlZHVsZXJSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdTY2hlZHVsZXJSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ3NjaGVkdWxlci5hbWF6b25hd3MuY29tJyksXG4gICAgfSk7XG5cbiAgICBwdWJsaXNoZXJMYW1iZGEuZ3JhbnRJbnZva2Uoc2NoZWR1bGVyUm9sZSk7XG5cbiAgICAvLyBDcmVhdGUgc2NoZWR1bGVyIGdyb3VwXG4gIGNvbnN0IF9zY2hlZHVsZXJHcm91cCA9IG5ldyBzY2hlZHVsZXIuQ2ZuU2NoZWR1bGVHcm91cCh0aGlzLCAnU2NoZWR1bGVyR3JvdXAnLCB7XG4gICAgICBuYW1lOiBgJHtwcmVmaXh9LXNjaGVkdWxlc2AsXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgZW52aXJvbm1lbnQgdmFyaWFibGVzIHRvIExhbWJkYSBmdW5jdGlvbnMgaGVyZVxuICAgIHNjaGVkdWxlTWFuYWdlbWVudExhbWJkYS5hZGRFbnZpcm9ubWVudCgnUFVCTElTSEVSX0xBTUJEQV9BUk4nLCBwdWJsaXNoZXJMYW1iZGEuZnVuY3Rpb25Bcm4pO1xuICAgIHNjaGVkdWxlTWFuYWdlbWVudExhbWJkYS5hZGRFbnZpcm9ubWVudCgnU0NIRURVTEVSX1JPTEVfQVJOJywgc2NoZWR1bGVyUm9sZS5yb2xlQXJuKTtcblxuICAgIC8vIEdyYW50IExhbWJkYSBwZXJtaXNzaW9uIHRvIGNyZWF0ZS9tYW5hZ2UgRXZlbnRCcmlkZ2Ugc2NoZWR1bGVzXG4gICAgc2NoZWR1bGVNYW5hZ2VtZW50TGFtYmRhLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdzY2hlZHVsZXI6Q3JlYXRlU2NoZWR1bGUnLFxuICAgICAgICAnc2NoZWR1bGVyOlVwZGF0ZVNjaGVkdWxlJyxcbiAgICAgICAgJ3NjaGVkdWxlcjpHZXRTY2hlZHVsZScsXG4gICAgICAgICdzY2hlZHVsZXI6RGVsZXRlU2NoZWR1bGUnLFxuICAgICAgICAnc2NoZWR1bGVyOkxpc3RTY2hlZHVsZXMnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOnNjaGVkdWxlcjoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06c2NoZWR1bGUvJHtwcmVmaXh9LXNjaGVkdWxlcy8qYF0sXG4gICAgfSkpO1xuXG4gICAgLy8gR3JhbnQgUHVibGlzaGVyIExhbWJkYSBwZXJtaXNzaW9uIHRvIHVzZSBTZXJ2aWNlIERpc2NvdmVyeVxuICAgIHB1Ymxpc2hlckxhbWJkYS5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnc2VydmljZWRpc2NvdmVyeTpEaXNjb3Zlckluc3RhbmNlcycsXG4gICAgICAgICdzZXJ2aWNlZGlzY292ZXJ5OkdldE5hbWVzcGFjZScsXG4gICAgICAgICdzZXJ2aWNlZGlzY292ZXJ5OkdldFNlcnZpY2UnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sIC8vIFNlcnZpY2UgRGlzY292ZXJ5IHJlcXVpcmVzIHdpbGRjYXJkIGZvciBkaXNjb3Zlcnkgb3BlcmF0aW9uc1xuICAgIH0pKTtcblxuICAgIC8vIEdyYW50IFB1Ymxpc2hlciBMYW1iZGEgcGVybWlzc2lvbiB0byBpbnZva2UgVG9rZW4gU2VydmljZSBBUEkgKElBTS1hdXRoZW50aWNhdGVkKVxuICAgIHB1Ymxpc2hlckxhbWJkYS5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogWydleGVjdXRlLWFwaTpJbnZva2UnXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICAvLyBQdWJsaXNoZXIgTGFtYmRhIG9ubHkgbmVlZHMgdG8gR0VUIHRva2VucyBmcm9tIFRva2VuIFNlcnZpY2VcbiAgICAgICAgLy8gR0VUIC90b2tlbnMve3VzZXJJZH0ve3BsYXRmb3JtfT9icmFuZElkPXticmFuZElkfVxuICAgICAgICBgYXJuOmF3czpleGVjdXRlLWFwaToke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06Ki8qL0dFVC90b2tlbnMvKmAsXG4gICAgICBdLFxuICAgIH0pKTtcblxuICAgIC8vIEdyYW50IFB1Ymxpc2hlciBMYW1iZGEgcGVybWlzc2lvbiB0byBlbWl0IGV2ZW50cyB0byBFdmVudEJyaWRnZSAoZGVmYXVsdCBidXMpXG4gICAgcHVibGlzaGVyTGFtYmRhLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbJ2V2ZW50czpQdXRFdmVudHMnXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSkpO1xuXG4gICAgLy8gY2RrLW5hZzogc3VwcHJlc3Mgd2lsZGNhcmQgcmVzb3VyY2UgZm9yIFB1dEV2ZW50cyB3aXRoIGp1c3RpZmljYXRpb25cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnNCeVBhdGgoXG4gICAgICB0aGlzLFxuICAgICAgYC8ke3RoaXMuc3RhY2tOYW1lfS9QdWJsaXNoZXJMYW1iZGEvU2VydmljZVJvbGUvRGVmYXVsdFBvbGljeS9SZXNvdXJjZWAsXG4gICAgICBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgICByZWFzb246ICdFdmVudEJyaWRnZSBQdXRFdmVudHMgcmVxdWlyZXMgd2lsZGNhcmQgcmVzb3VyY2Ugd2hlbiB1c2luZyBkZWZhdWx0IGV2ZW50IGJ1cycsXG4gICAgICAgICAgYXBwbGllc1RvOiBbJ0FjdGlvbjo6ZXZlbnRzOlB1dEV2ZW50cycsICdSZXNvdXJjZTo6KiddLFxuICAgICAgICB9LFxuICAgICAgXVxuICAgICk7XG5cbiAgICAvLyBHcmFudCBMYW1iZGEgcGVybWlzc2lvbiB0byBwYXNzIHRoZSBzY2hlZHVsZXIgcm9sZSB0byBFdmVudEJyaWRnZVxuICAgIHNjaGVkdWxlTWFuYWdlbWVudExhbWJkYS5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogWydpYW06UGFzc1JvbGUnXSxcbiAgICAgIHJlc291cmNlczogW3NjaGVkdWxlclJvbGUucm9sZUFybl0sXG4gICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgIFN0cmluZ0VxdWFsczoge1xuICAgICAgICAgICdpYW06UGFzc2VkVG9TZXJ2aWNlJzogJ3NjaGVkdWxlci5hbWF6b25hd3MuY29tJyxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSkpO1xuICAgIFxuICAgIC8vIEdyYW50IFNjaGVkdWxlIENsZWFudXAgTGFtYmRhIHBlcm1pc3Npb24gdG8gbGlzdCBhbmQgZGVsZXRlIEV2ZW50QnJpZGdlIHNjaGVkdWxlc1xuICAgIHNjaGVkdWxlQ2xlYW51cExhbWJkYS5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnc2NoZWR1bGVyOkxpc3RTY2hlZHVsZXMnLFxuICAgICAgICAnc2NoZWR1bGVyOkdldFNjaGVkdWxlJyxcbiAgICAgICAgJ3NjaGVkdWxlcjpEZWxldGVTY2hlZHVsZScsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6c2NoZWR1bGVyOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpzY2hlZHVsZS8ke3ByZWZpeH0tc2NoZWR1bGVzLypgXSxcbiAgICB9KSk7XG4gICAgXG4gICAgLy8gR3JhbnQgQ2xlYW51cCBMYW1iZGEgcGVybWlzc2lvbiB0byBsaXN0IHNjaGVkdWxlcyBpbiB0aGUgZ3JvdXBcbiAgICBzY2hlZHVsZUNsZWFudXBMYW1iZGEuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFsnc2NoZWR1bGVyOkxpc3RTY2hlZHVsZXMnXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sIC8vIExpc3RTY2hlZHVsZXMgcmVxdWlyZXMgd2lsZGNhcmQgd2hlbiBzcGVjaWZ5aW5nIEdyb3VwTmFtZVxuICAgIH0pKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09IEFQSSBHYXRld2F5IENsb3VkV2F0Y2ggTG9nZ2luZyBSb2xlID09PT09PT09PT09PT09PT09PT09XG4gICAgXG4gICAgLy8gQ3JlYXRlIElBTSByb2xlIGZvciBBUEkgR2F0ZXdheSBDbG91ZFdhdGNoIGxvZ2dpbmcgKGFjY291bnQtbGV2ZWwgc2V0dGluZylcbiAgICBjb25zdCBhcGlHYXRld2F5Q2xvdWRXYXRjaFJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0FwaUdhdGV3YXlDbG91ZFdhdGNoUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdhcGlnYXRld2F5LmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BbWF6b25BUElHYXRld2F5UHVzaFRvQ2xvdWRXYXRjaExvZ3MnKSxcbiAgICAgIF0sXG4gICAgICBkZXNjcmlwdGlvbjogJ1JvbGUgZm9yIEFQSSBHYXRld2F5IHRvIHdyaXRlIGxvZ3MgdG8gQ2xvdWRXYXRjaCcsXG4gICAgfSk7XG5cbiAgICAvLyBDb25maWd1cmUgYWNjb3VudC1sZXZlbCBDbG91ZFdhdGNoIGxvZ2dpbmcgZm9yIEFQSSBHYXRld2F5XG4gICAgY29uc3QgY2ZuQWNjb3VudCA9IG5ldyBhcGlnYXRld2F5LkNmbkFjY291bnQodGhpcywgJ0FwaUdhdGV3YXlBY2NvdW50Jywge1xuICAgICAgY2xvdWRXYXRjaFJvbGVBcm46IGFwaUdhdGV3YXlDbG91ZFdhdGNoUm9sZS5yb2xlQXJuLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT0gQVBJIEdhdGV3YXkgd2l0aCBSZXF1ZXN0IFZhbGlkYXRpb24gPT09PT09PT09PT09PT09PT09PT1cbiAgICBcbiAgICB0aGlzLmFwaSA9IG5ldyBhcGlnYXRld2F5LlJlc3RBcGkodGhpcywgJ1NjaGVkdWxlckFwaScsIHtcbiAgICAgIHJlc3RBcGlOYW1lOiBgJHtwcmVmaXh9LWFwaWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvbnRlbnQgU2NoZWR1bGVyIE1pY3Jvc2VydmljZSBBUEknLFxuICAgICAgZGVwbG95T3B0aW9uczoge1xuICAgICAgICBzdGFnZU5hbWU6IGVudmlyb25tZW50LFxuICAgICAgICB0cmFjaW5nRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgLy8gRW5hYmxlIElORk8gbGV2ZWwgZXhlY3V0aW9uIGxvZ2dpbmcgJiBhY2Nlc3MgbG9ncyBmb3IgNDAzIGRpYWdub3N0aWNzXG4gICAgICAgIGxvZ2dpbmdMZXZlbDogYXBpZ2F0ZXdheS5NZXRob2RMb2dnaW5nTGV2ZWwuSU5GTyxcbiAgICAgICAgbWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICAgIGFjY2Vzc0xvZ0Rlc3RpbmF0aW9uOiBuZXcgYXBpZ2F0ZXdheS5Mb2dHcm91cExvZ0Rlc3RpbmF0aW9uKG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdTY2hlZHVsZXJBcGlBY2Nlc3NMb2dzJywge1xuICAgICAgICAgIGxvZ0dyb3VwTmFtZTogYC9hd3MvYXBpZ2F0ZXdheS8ke3ByZWZpeH0tYXBpLWFjY2Vzc2AsXG4gICAgICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICAgICAgcmVtb3ZhbFBvbGljeTogZW52aXJvbm1lbnQgPT09ICdwcm9kJyA/IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTiA6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgIH0pKSxcbiAgICAgICAgYWNjZXNzTG9nRm9ybWF0OiBhcGlnYXRld2F5LkFjY2Vzc0xvZ0Zvcm1hdC5jdXN0b20oSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIHJlcXVlc3RJZDogJyRjb250ZXh0LnJlcXVlc3RJZCcsXG4gICAgICAgICAgaXA6ICckY29udGV4dC5pZGVudGl0eS5zb3VyY2VJcCcsXG4gICAgICAgICAgcmVxdWVzdFRpbWU6ICckY29udGV4dC5yZXF1ZXN0VGltZScsXG4gICAgICAgICAgaHR0cE1ldGhvZDogJyRjb250ZXh0Lmh0dHBNZXRob2QnLFxuICAgICAgICAgIHJlc291cmNlUGF0aDogJyRjb250ZXh0LnJlc291cmNlUGF0aCcsXG4gICAgICAgICAgcGF0aDogJyRjb250ZXh0LnBhdGgnLFxuICAgICAgICAgIHN0YXR1czogJyRjb250ZXh0LnN0YXR1cycsXG4gICAgICAgICAgcHJvdG9jb2w6ICckY29udGV4dC5wcm90b2NvbCcsXG4gICAgICAgICAgaW50ZWdyYXRpb25TdGF0dXM6ICckY29udGV4dC5pbnRlZ3JhdGlvblN0YXR1cycsXG4gICAgICAgICAgZXJyb3JNZXNzYWdlOiAnJGNvbnRleHQuZXJyb3IubWVzc2FnZScsXG4gICAgICAgICAgcmVzcG9uc2VMZW5ndGg6ICckY29udGV4dC5yZXNwb25zZUxlbmd0aCcsXG4gICAgICAgICAgdXNlckFnZW50OiAnJGNvbnRleHQuaWRlbnRpdHkudXNlckFnZW50JyxcbiAgICAgICAgICBjYWxsZXI6ICckY29udGV4dC5pZGVudGl0eS5jYWxsZXInLFxuICAgICAgICAgIHVzZXI6ICckY29udGV4dC5pZGVudGl0eS51c2VyJ1xuICAgICAgICB9KSksXG4gICAgICAgIHRocm90dGxpbmdCdXJzdExpbWl0OiAxMDAwLFxuICAgICAgICB0aHJvdHRsaW5nUmF0ZUxpbWl0OiA1MDAsXG4gICAgICB9LFxuICAgICAgZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zOiB7XG4gICAgICAgIGFsbG93T3JpZ2luczogZW52aXJvbm1lbnQgPT09ICdwcm9kJyA/IFsnaHR0cHM6Ly9wb3N0b2wuaW8nXSA6IGFwaWdhdGV3YXkuQ29ycy5BTExfT1JJR0lOUyxcbiAgICAgICAgYWxsb3dNZXRob2RzOiBhcGlnYXRld2F5LkNvcnMuQUxMX01FVEhPRFMsXG4gICAgICAgIGFsbG93SGVhZGVyczogWydDb250ZW50LVR5cGUnLCAnQXV0aG9yaXphdGlvbiddLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEVuc3VyZSBBUEkgZGVwbG95bWVudCBoYXBwZW5zIGFmdGVyIGFjY291bnQgY29uZmlndXJhdGlvblxuICAgIHRoaXMuYXBpLm5vZGUuYWRkRGVwZW5kZW5jeShjZm5BY2NvdW50KTtcblxuICAgIC8vIE5PIEFVVEhPUklaRVIgTkVFREVEIC0gVXNpbmcgSUFNIFNpZ1Y0IGF1dGhlbnRpY2F0aW9uXG4gICAgLy8gVGhpcyBwcm92aWRlcyBzZWN1cmUgc2VydmljZS10by1zZXJ2aWNlIGF1dGhlbnRpY2F0aW9uIHVzaW5nIEFXUyBjcmVkZW50aWFsc1xuXG4gICAgLy8gUmVxdWVzdCBWYWxpZGF0b3JcbiAgICBjb25zdCByZXF1ZXN0VmFsaWRhdG9yID0gbmV3IGFwaWdhdGV3YXkuUmVxdWVzdFZhbGlkYXRvcih0aGlzLCAnUmVxdWVzdFZhbGlkYXRvcicsIHtcbiAgICAgIHJlc3RBcGk6IHRoaXMuYXBpLFxuICAgICAgcmVxdWVzdFZhbGlkYXRvck5hbWU6ICdyZXF1ZXN0LXZhbGlkYXRvcicsXG4gICAgICB2YWxpZGF0ZVJlcXVlc3RCb2R5OiB0cnVlLFxuICAgICAgdmFsaWRhdGVSZXF1ZXN0UGFyYW1ldGVyczogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIEFQSSBNb2RlbCBmb3IgcmVxdWVzdCB2YWxpZGF0aW9uXG4gICAgY29uc3Qgc2NoZWR1bGVNb2RlbCA9IG5ldyBhcGlnYXRld2F5Lk1vZGVsKHRoaXMsICdTY2hlZHVsZU1vZGVsJywge1xuICAgICAgcmVzdEFwaTogdGhpcy5hcGksXG4gICAgICBjb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgbW9kZWxOYW1lOiAnU2NoZWR1bGVNb2RlbCcsXG4gICAgICBzY2hlbWE6IHtcbiAgICAgICAgc2NoZW1hOiBhcGlnYXRld2F5Lkpzb25TY2hlbWFWZXJzaW9uLkRSQUZUNCxcbiAgICAgICAgdGl0bGU6ICdTY2hlZHVsZScsXG4gICAgICAgIHR5cGU6IGFwaWdhdGV3YXkuSnNvblNjaGVtYVR5cGUuT0JKRUNULFxuICAgICAgICByZXF1aXJlZDogWydicmFuZElkJywgJ2NvbnRlbnRJZCcsICdwbGF0Zm9ybScsICdzY2hlZHVsZWRBdCddLFxuICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgYnJhbmRJZDogeyB0eXBlOiBhcGlnYXRld2F5Lkpzb25TY2hlbWFUeXBlLlNUUklORyB9LFxuICAgICAgICAgIGNvbnRlbnRJZDogeyB0eXBlOiBhcGlnYXRld2F5Lkpzb25TY2hlbWFUeXBlLlNUUklORyB9LFxuICAgICAgICAgIHBsYXRmb3JtOiB7IFxuICAgICAgICAgICAgdHlwZTogYXBpZ2F0ZXdheS5Kc29uU2NoZW1hVHlwZS5TVFJJTkcsXG4gICAgICAgICAgICBlbnVtOiBbJ2luc3RhZ3JhbScsICd0aWt0b2snLCAneW91dHViZSddLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgc2NoZWR1bGVkQXQ6IHsgXG4gICAgICAgICAgICB0eXBlOiBhcGlnYXRld2F5Lkpzb25TY2hlbWFUeXBlLlNUUklORyxcbiAgICAgICAgICAgIGZvcm1hdDogJ2RhdGUtdGltZScsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBjb250ZW50VHlwZTogeyBcbiAgICAgICAgICAgIHR5cGU6IGFwaWdhdGV3YXkuSnNvblNjaGVtYVR5cGUuU1RSSU5HLFxuICAgICAgICAgICAgZW51bTogWydpbWFnZScsICd2aWRlbyddLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgdmlkZW9Vcmw6IHsgdHlwZTogYXBpZ2F0ZXdheS5Kc29uU2NoZW1hVHlwZS5TVFJJTkcgfSxcbiAgICAgICAgICBjYXB0aW9uOiB7IHR5cGU6IGFwaWdhdGV3YXkuSnNvblNjaGVtYVR5cGUuU1RSSU5HIH0sXG4gICAgICAgICAgaGFzaHRhZ3M6IHtcbiAgICAgICAgICAgIHR5cGU6IGFwaWdhdGV3YXkuSnNvblNjaGVtYVR5cGUuQVJSQVksXG4gICAgICAgICAgICBpdGVtczogeyB0eXBlOiBhcGlnYXRld2F5Lkpzb25TY2hlbWFUeXBlLlNUUklORyB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQVBJIFJlc291cmNlcyB3aXRoIGF1dGhvcml6YXRpb25cbiAgICBjb25zdCBzY2hlZHVsZXNSZXNvdXJjZSA9IHRoaXMuYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ3NjaGVkdWxlcycpO1xuICAgIGNvbnN0IHNjaGVkdWxlUmVzb3VyY2UgPSBzY2hlZHVsZXNSZXNvdXJjZS5hZGRSZXNvdXJjZSgne3NjaGVkdWxlSWR9Jyk7XG5cbiAgICAvLyBBUEkgTWV0aG9kcyB3aXRoIHZhbGlkYXRpb24gYW5kIGF1dGhvcml6YXRpb25cbiAgICBjb25zdCBsYW1iZGFJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHNjaGVkdWxlTWFuYWdlbWVudExhbWJkYSk7XG4gICAgXG4gICAgc2NoZWR1bGVzUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgbGFtYmRhSW50ZWdyYXRpb24sIHtcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLklBTSxcbiAgICAgIHJlcXVlc3RWYWxpZGF0b3IsXG4gICAgICByZXF1ZXN0TW9kZWxzOiB7XG4gICAgICAgICdhcHBsaWNhdGlvbi9qc29uJzogc2NoZWR1bGVNb2RlbCxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICBzY2hlZHVsZXNSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIGxhbWJkYUludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5JQU0sXG4gICAgfSk7XG5cbiAgICBzY2hlZHVsZVJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbGFtYmRhSW50ZWdyYXRpb24sIHtcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLklBTSxcbiAgICB9KTtcblxuICAgIHNjaGVkdWxlUmVzb3VyY2UuYWRkTWV0aG9kKCdQVVQnLCBsYW1iZGFJbnRlZ3JhdGlvbiwge1xuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuSUFNLFxuICAgICAgcmVxdWVzdFZhbGlkYXRvcixcbiAgICAgIHJlcXVlc3RNb2RlbHM6IHtcbiAgICAgICAgJ2FwcGxpY2F0aW9uL2pzb24nOiBzY2hlZHVsZU1vZGVsLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHNjaGVkdWxlUmVzb3VyY2UuYWRkTWV0aG9kKCdERUxFVEUnLCBsYW1iZGFJbnRlZ3JhdGlvbiwge1xuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuSUFNLFxuICAgIH0pO1xuXG4gICAgLy8gRW52aXJvbm1lbnQgdmFyaWFibGVzIG1vdmVkIHRvIExhbWJkYSBkZWZpbml0aW9uIHRvIGF2b2lkIGNpcmN1bGFyIGRlcGVuZGVuY2llc1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT0gV0FGIGZvciBBUEkgUHJvdGVjdGlvbiA9PT09PT09PT09PT09PT09PT09PVxuICAgIFxuICAgIGlmIChlbnZpcm9ubWVudCA9PT0gJ3Byb2QnKSB7XG4gICAgICBjb25zdCB3ZWJBY2wgPSBuZXcgd2FmdjIuQ2ZuV2ViQUNMKHRoaXMsICdXZWJBY2wnLCB7XG4gICAgICAgIHNjb3BlOiAnUkVHSU9OQUwnLFxuICAgICAgICBkZWZhdWx0QWN0aW9uOiB7IGFsbG93OiB7fSB9LFxuICAgICAgICBydWxlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIG5hbWU6ICdSYXRlTGltaXRSdWxlJyxcbiAgICAgICAgICAgIHByaW9yaXR5OiAxLFxuICAgICAgICAgICAgc3RhdGVtZW50OiB7XG4gICAgICAgICAgICAgIHJhdGVCYXNlZFN0YXRlbWVudDoge1xuICAgICAgICAgICAgICAgIGxpbWl0OiAyMDAwLFxuICAgICAgICAgICAgICAgIGFnZ3JlZ2F0ZUtleVR5cGU6ICdJUCcsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgYWN0aW9uOiB7IGJsb2NrOiB7fSB9LFxuICAgICAgICAgICAgdmlzaWJpbGl0eUNvbmZpZzoge1xuICAgICAgICAgICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLFxuICAgICAgICAgICAgICBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdSYXRlTGltaXRSdWxlJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiAnQVdTTWFuYWdlZFJ1bGVzQ29tbW9uUnVsZVNldCcsXG4gICAgICAgICAgICBwcmlvcml0eTogMixcbiAgICAgICAgICAgIHN0YXRlbWVudDoge1xuICAgICAgICAgICAgICBtYW5hZ2VkUnVsZUdyb3VwU3RhdGVtZW50OiB7XG4gICAgICAgICAgICAgICAgdmVuZG9yTmFtZTogJ0FXUycsXG4gICAgICAgICAgICAgICAgbmFtZTogJ0FXU01hbmFnZWRSdWxlc0NvbW1vblJ1bGVTZXQnLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG92ZXJyaWRlQWN0aW9uOiB7IG5vbmU6IHt9IH0sXG4gICAgICAgICAgICB2aXNpYmlsaXR5Q29uZmlnOiB7XG4gICAgICAgICAgICAgIHNhbXBsZWRSZXF1ZXN0c0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgICAgIGNsb3VkV2F0Y2hNZXRyaWNzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0NvbW1vblJ1bGVTZXQnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgICB2aXNpYmlsaXR5Q29uZmlnOiB7XG4gICAgICAgICAgc2FtcGxlZFJlcXVlc3RzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgbWV0cmljTmFtZTogJ1dlYkFjbCcsXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgbmV3IHdhZnYyLkNmbldlYkFDTEFzc29jaWF0aW9uKHRoaXMsICdXZWJBY2xBc3NvY2lhdGlvbicsIHtcbiAgICAgICAgcmVzb3VyY2VBcm46IHRoaXMuYXBpLmRlcGxveW1lbnRTdGFnZS5zdGFnZUFybixcbiAgICAgICAgd2ViQWNsQXJuOiB3ZWJBY2wuYXR0ckFybixcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09IENsb3VkV2F0Y2ggQWxhcm1zIHdpdGggS01TID09PT09PT09PT09PT09PT09PT09XG4gICAgXG4gICAgY29uc3QgYWxhcm1Ub3BpYyA9IG5ldyBzbnMuVG9waWModGhpcywgJ0FsYXJtVG9waWMnLCB7XG4gICAgICB0b3BpY05hbWU6IGAke3ByZWZpeH0tYWxhcm1zYCxcbiAgICAgIGRpc3BsYXlOYW1lOiAnQ29udGVudCBTY2hlZHVsZXIgQWxhcm1zJyxcbiAgICAgIG1hc3RlcktleTogZW5jcnlwdGlvbktleSwgLy8g4pyFIFNOUyBlbmNyeXB0aW9uXG4gICAgfSk7XG5cbiAgICBpZiAoYWxlcnRFbWFpbCkge1xuICAgICAgYWxhcm1Ub3BpYy5hZGRTdWJzY3JpcHRpb24obmV3IHNuc1N1YnNjcmlwdGlvbnMuRW1haWxTdWJzY3JpcHRpb24oYWxlcnRFbWFpbCkpO1xuICAgIH1cblxuICAgIC8vIFB1Ymxpc2hpbmcgZmFpbHVyZSBhbGFybVxuICAgIG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdQdWJsaXNoaW5nRmFpbHVyZUFsYXJtJywge1xuICAgICAgYWxhcm1OYW1lOiBgJHtwcmVmaXh9LXB1Ymxpc2hpbmctZmFpbHVyZXNgLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdBV1MvTGFtYmRhJyxcbiAgICAgICAgbWV0cmljTmFtZTogJ0Vycm9ycycsXG4gICAgICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgICAgICBGdW5jdGlvbk5hbWU6IHB1Ymxpc2hlckxhbWJkYS5mdW5jdGlvbk5hbWUsXG4gICAgICAgIH0sXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogNSxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gICAgICBhY3Rpb25zRW5hYmxlZDogdHJ1ZSxcbiAgICB9KS5hZGRBbGFybUFjdGlvbihuZXcgY2xvdWR3YXRjaEFjdGlvbnMuU25zQWN0aW9uKGFsYXJtVG9waWMpKTtcblxuICAgIC8vIEhpZ2ggcmV0cnkgcmF0ZSBhbGFybVxuICAgIG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdIaWdoUmV0cnlSYXRlQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6IGAke3ByZWZpeH0taGlnaC1yZXRyeS1yYXRlYCxcbiAgICAgIG1ldHJpYzogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgbmFtZXNwYWNlOiAnQ29udGVudFNjaGVkdWxlcicsXG4gICAgICAgIG1ldHJpY05hbWU6ICdSZXRyeUNvdW50JyxcbiAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAxMDAsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pLmFkZEFsYXJtQWN0aW9uKG5ldyBjbG91ZHdhdGNoQWN0aW9ucy5TbnNBY3Rpb24oYWxhcm1Ub3BpYykpO1xuXG4gICAgLy8gRExRIG1lc3NhZ2UgY291bnQgYWxhcm1cbiAgICBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnRExRQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6IGAke3ByZWZpeH0tZGxxLW1lc3NhZ2VzYCxcbiAgICAgIG1ldHJpYzogZGVhZExldHRlclF1ZXVlLm1ldHJpY0FwcHJveGltYXRlTnVtYmVyT2ZNZXNzYWdlc1Zpc2libGUoKSxcbiAgICAgIHRocmVzaG9sZDogMTAsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICB9KS5hZGRBbGFybUFjdGlvbihuZXcgY2xvdWR3YXRjaEFjdGlvbnMuU25zQWN0aW9uKGFsYXJtVG9waWMpKTtcbiAgICBcbiAgICAvLyBPcnBoYW5lZCBzY2hlZHVsZXMgYWxhcm0gLSB0cmlnZ2VycyBpZiB0b28gbWFueSBvcnBoYW5lZCBzY2hlZHVsZXMgYXJlIGZvdW5kXG4gICAgbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ09ycGhhbmVkU2NoZWR1bGVzQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6IGAke3ByZWZpeH0tb3JwaGFuZWQtc2NoZWR1bGVzYCxcbiAgICAgIG1ldHJpYzogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgbmFtZXNwYWNlOiAnQ29udGVudFNjaGVkdWxlcicsXG4gICAgICAgIG1ldHJpY05hbWU6ICdPcnBoYW5lZFNjaGVkdWxlc0NsZWFuZWQnLFxuICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5ob3VycygyNCksXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogNTAsIC8vIEFsZXJ0IGlmIG1vcmUgdGhhbiA1MCBvcnBoYW5lZCBzY2hlZHVsZXMgYXJlIGNsZWFuZWQgaW4gYSBkYXlcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gICAgfSkuYWRkQWxhcm1BY3Rpb24obmV3IGNsb3Vkd2F0Y2hBY3Rpb25zLlNuc0FjdGlvbihhbGFybVRvcGljKSk7XG4gICAgXG4gICAgLy8gRmFpbGVkIHNjaGVkdWxlcyBhbGFybSAtIHRyaWdnZXJzIGlmIG1hbnkgc2NoZWR1bGVzIGFyZSBmYWlsaW5nXG4gICAgbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0ZhaWxlZFNjaGVkdWxlc0FsYXJtJywge1xuICAgICAgYWxhcm1OYW1lOiBgJHtwcmVmaXh9LWZhaWxlZC1zY2hlZHVsZXNgLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdDb250ZW50U2NoZWR1bGVyJyxcbiAgICAgICAgbWV0cmljTmFtZTogJ0ZhaWxlZFNjaGVkdWxlc0NsZWFuZWQnLFxuICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5ob3VycygyNCksXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogMzAsIC8vIEFsZXJ0IGlmIG1vcmUgdGhhbiAzMCBmYWlsZWQgc2NoZWR1bGVzIGFyZSBjbGVhbmVkIGluIGEgZGF5XG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pLmFkZEFsYXJtQWN0aW9uKG5ldyBjbG91ZHdhdGNoQWN0aW9ucy5TbnNBY3Rpb24oYWxhcm1Ub3BpYykpO1xuICAgIFxuICAgIC8vIENsZWFudXAgam9iIGZhaWx1cmUgYWxhcm1cbiAgICBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnQ2xlYW51cEpvYkZhaWx1cmVBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogYCR7cHJlZml4fS1jbGVhbnVwLWpvYi1mYWlsdXJlYCxcbiAgICAgIG1ldHJpYzogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgbmFtZXNwYWNlOiAnQVdTL0xhbWJkYScsXG4gICAgICAgIG1ldHJpY05hbWU6ICdFcnJvcnMnLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgRnVuY3Rpb25OYW1lOiBzY2hlZHVsZUNsZWFudXBMYW1iZGEuZnVuY3Rpb25OYW1lLFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDEsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pLmFkZEFsYXJtQWN0aW9uKG5ldyBjbG91ZHdhdGNoQWN0aW9ucy5TbnNBY3Rpb24oYWxhcm1Ub3BpYykpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT0gQ0RLIE5hZyBTdXBwcmVzc2lvbnMgd2l0aCBKdXN0aWZpY2F0aW9ucyA9PT09PT09PT09PT09PT09PT09PVxuICAgIFxuICAgIC8vIFN1cHByZXNzIFMzIGJ1Y2tldCBTU0wgZW5mb3JjZW1lbnQgd2FybmluZ3MgZm9yIGFjY2VzcyBsb2dzIGJ1Y2tldCAoYnVja2V0IGFuZCBwb2xpY3kpXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zQnlQYXRoKFxuICAgICAgdGhpcyxcbiAgICAgIGAvJHt0aGlzLnN0YWNrTmFtZX0vQWNjZXNzTG9nc0J1Y2tldC9SZXNvdXJjZWAsXG4gICAgICBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1TMTAnLFxuICAgICAgICAgIHJlYXNvbjogJ0FjY2VzcyBsb2dzIGJ1Y2tldCBpcyBtYW5hZ2VkIGJ5IEFXUyBFTEIgc2VydmljZSB3aGljaCBoYW5kbGVzIFNTTCBlbmZvcmNlbWVudCBpbnRlcm5hbGx5J1xuICAgICAgICB9LFxuICAgICAgXVxuICAgICk7XG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zQnlQYXRoKFxuICAgICAgdGhpcyxcbiAgICAgIGAvJHt0aGlzLnN0YWNrTmFtZX0vQWNjZXNzTG9nc0J1Y2tldC9Qb2xpY3kvUmVzb3VyY2VgLFxuICAgICAgW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtUzEwJyxcbiAgICAgICAgICByZWFzb246ICdBY2Nlc3MgbG9ncyBidWNrZXQgaXMgbWFuYWdlZCBieSBBV1MgRUxCIHNlcnZpY2Ugd2hpY2ggaGFuZGxlcyBTU0wgZW5mb3JjZW1lbnQgaW50ZXJuYWxseSdcbiAgICAgICAgfSxcbiAgICAgIF1cbiAgICApO1xuXG4gICAgLy8gU3VwcHJlc3MgUzMgYnVja2V0IFNTTCBlbmZvcmNlbWVudCB3YXJuaW5ncyBmb3IgdmlkZW8gYnVja2V0IChidWNrZXQgYW5kIHBvbGljeSlcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnNCeVBhdGgoXG4gICAgICB0aGlzLFxuICAgICAgYC8ke3RoaXMuc3RhY2tOYW1lfS9WaWRlb0J1Y2tldC9SZXNvdXJjZWAsXG4gICAgICBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1TMTAnLFxuICAgICAgICAgIHJlYXNvbjogJ1ZpZGVvIGJ1Y2tldCBhY2Nlc3NlZCB2aWEgcHJlLXNpZ25lZCBVUkxzIHdpdGggSFRUUFMgZW5mb3JjZWQgYXQgYXBwbGljYXRpb24gbGV2ZWwnXG4gICAgICAgIH0sXG4gICAgICBdXG4gICAgKTtcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnNCeVBhdGgoXG4gICAgICB0aGlzLFxuICAgICAgYC8ke3RoaXMuc3RhY2tOYW1lfS9WaWRlb0J1Y2tldC9Qb2xpY3kvUmVzb3VyY2VgLFxuICAgICAgW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtUzEwJyxcbiAgICAgICAgICByZWFzb246ICdWaWRlbyBidWNrZXQgYWNjZXNzZWQgdmlhIHByZS1zaWduZWQgVVJMcyB3aXRoIEhUVFBTIGVuZm9yY2VkIGF0IGFwcGxpY2F0aW9uIGxldmVsJ1xuICAgICAgICB9LFxuICAgICAgXVxuICAgICk7XG5cbiAgICAvLyBTdXBwcmVzcyBzZWNyZXQgcm90YXRpb24gd2FybmluZ3NcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICBwbGF0Zm9ybUNyZWRlbnRpYWxzLFxuICAgICAgW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtU01HNCcsXG4gICAgICAgICAgcmVhc29uOiAnUGxhdGZvcm0gQVBJIGNyZWRlbnRpYWxzIGFyZSBtYW5hZ2VkIG1hbnVhbGx5IGJ5IG9wZXJhdGlvbnMgdGVhbSdcbiAgICAgICAgfSxcbiAgICAgIF1cbiAgICApO1xuXG4gICAgLy8gU3VwcHJlc3MgU1FTIFNTTCBlbmZvcmNlbWVudCB3YXJuaW5nc1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZSxcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLVNRUzQnLFxuICAgICAgICAgIHJlYXNvbjogJ0RlYWQgbGV0dGVyIHF1ZXVlIGlzIG9ubHkgYWNjZXNzZWQgYnkgTGFtYmRhIGZ1bmN0aW9ucyB3aXRoaW4gVlBDIHVzaW5nIElBTSByb2xlcydcbiAgICAgICAgfSxcbiAgICAgIF1cbiAgICApO1xuXG4gICAgLy8gU3VwcHJlc3MgWC1SYXkgcGVybWlzc2lvbnMgc3BlY2lmaWNhbGx5XG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zQnlQYXRoKFxuICAgICAgdGhpcyxcbiAgICAgIGAvJHt0aGlzLnN0YWNrTmFtZX0vTGFtYmRhRXhlY3V0aW9uUm9sZS9EZWZhdWx0UG9saWN5L1Jlc291cmNlYCxcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICAgIHJlYXNvbjogJ0xhbWJkYSBleGVjdXRpb24gcm9sZSByZXF1aXJlcyB3aWxkY2FyZCBwZXJtaXNzaW9ucyBmb3IgQ2xvdWRXYXRjaCBMb2dzIGFuZCBYLVJheSB0cmFjaW5nJyxcbiAgICAgICAgICBhcHBsaWVzVG86IFtcbiAgICAgICAgICAgICdSZXNvdXJjZTo6KicsXG4gICAgICAgICAgICBgUmVzb3VyY2U6OmFybjphd3M6bG9nczoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06bG9nLWdyb3VwOi9hd3MvbGFtYmRhL3Bvc3RvbGlvLXNjaGVkdWxlci0ke2Vudmlyb25tZW50fS0qYCxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgXVxuICAgICk7XG5cbiAgICAvLyBTdXBwcmVzcyBBUEkgR2F0ZXdheSBsb2dnaW5nIGNvbmZpZ3VyYXRpb25cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnNCeVBhdGgoXG4gICAgICB0aGlzLFxuICAgICAgYC8ke3RoaXMuc3RhY2tOYW1lfS9TY2hlZHVsZXJBcGkvUmVzb3VyY2VgLFxuICAgICAgW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQVBJRzEnLFxuICAgICAgICAgIHJlYXNvbjogJ0Nsb3VkV2F0Y2ggbG9nZ2luZyBkaXNhYmxlZCB0byBhdm9pZCBjaXJjdWxhciBkZXBlbmRlbmN5IHdpdGggSUFNIHJvbGUuIE1ldHJpY3MgYW5kIHRyYWNpbmcgYXJlIGVuYWJsZWQgZm9yIG1vbml0b3JpbmcuJyxcbiAgICAgICAgfSxcbiAgICAgIF1cbiAgICApO1xuXG4gICAgLy8gU3VwcHJlc3MgV0FGIHdhcm5pbmcgZm9yIG5vbi1wcm9kdWN0aW9uIGVudmlyb25tZW50c1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9uc0J5UGF0aChcbiAgICAgIHRoaXMsXG4gICAgICBgLyR7dGhpcy5zdGFja05hbWV9L1NjaGVkdWxlckFwaS9EZXBsb3ltZW50U3RhZ2UuJHtlbnZpcm9ubWVudH0vUmVzb3VyY2VgLFxuICAgICAgW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQVBJRzMnLFxuICAgICAgICAgIHJlYXNvbjogYFdBRiBub3QgcmVxdWlyZWQgZm9yICR7ZW52aXJvbm1lbnR9IGVudmlyb25tZW50LiBQcm9kdWN0aW9uIHVzZXMgQVdTIFdBRiB2MiBmb3IgcHJvdGVjdGlvbi5gLFxuICAgICAgICB9LFxuICAgICAgXVxuICAgICk7XG5cbiAgICAvLyBTdXBwcmVzcyBBUEkgR2F0ZXdheSB3YXJuaW5ncyAodXNpbmcgSUFNIGF1dGggaW5zdGVhZCBvZiBDb2duaXRvKVxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9uc0J5UGF0aChcbiAgICAgIHRoaXMsXG4gICAgICBgLyR7dGhpcy5zdGFja05hbWV9L1NjaGVkdWxlckFwaS9EZWZhdWx0L3NjaGVkdWxlcy9QT1NUL1Jlc291cmNlYCxcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUFQSUc0JyxcbiAgICAgICAgICByZWFzb246ICdVc2luZyBJQU0gU2lnVjQgYXV0aGVudGljYXRpb24gZm9yIHNlcnZpY2UtdG8tc2VydmljZSBjb21tdW5pY2F0aW9uJyxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNPRzQnLFxuICAgICAgICAgIHJlYXNvbjogJ1VzaW5nIElBTSBTaWdWNCBhdXRoZW50aWNhdGlvbiBmb3Igc2VydmljZS10by1zZXJ2aWNlIGNvbW11bmljYXRpb24gaW5zdGVhZCBvZiBDb2duaXRvIHVzZXIgcG9vbHMnLFxuICAgICAgICB9LFxuICAgICAgXVxuICAgICk7XG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zQnlQYXRoKFxuICAgICAgdGhpcyxcbiAgICAgIGAvJHt0aGlzLnN0YWNrTmFtZX0vU2NoZWR1bGVyQXBpL0RlZmF1bHQvc2NoZWR1bGVzL0dFVC9SZXNvdXJjZWAsXG4gICAgICBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1BUElHNCcsXG4gICAgICAgICAgcmVhc29uOiAnVXNpbmcgSUFNIFNpZ1Y0IGF1dGhlbnRpY2F0aW9uIGZvciBzZXJ2aWNlLXRvLXNlcnZpY2UgY29tbXVuaWNhdGlvbicsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1DT0c0JyxcbiAgICAgICAgICByZWFzb246ICdVc2luZyBJQU0gU2lnVjQgYXV0aGVudGljYXRpb24gZm9yIHNlcnZpY2UtdG8tc2VydmljZSBjb21tdW5pY2F0aW9uIGluc3RlYWQgb2YgQ29nbml0byB1c2VyIHBvb2xzJyxcbiAgICAgICAgfSxcbiAgICAgIF1cbiAgICApO1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9uc0J5UGF0aChcbiAgICAgIHRoaXMsXG4gICAgICBgLyR7dGhpcy5zdGFja05hbWV9L1NjaGVkdWxlckFwaS9EZWZhdWx0L3NjaGVkdWxlcy97c2NoZWR1bGVJZH0vR0VUL1Jlc291cmNlYCxcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUFQSUc0JyxcbiAgICAgICAgICByZWFzb246ICdVc2luZyBJQU0gU2lnVjQgYXV0aGVudGljYXRpb24gZm9yIHNlcnZpY2UtdG8tc2VydmljZSBjb21tdW5pY2F0aW9uJyxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNPRzQnLFxuICAgICAgICAgIHJlYXNvbjogJ1VzaW5nIElBTSBTaWdWNCBhdXRoZW50aWNhdGlvbiBmb3Igc2VydmljZS10by1zZXJ2aWNlIGNvbW11bmljYXRpb24gaW5zdGVhZCBvZiBDb2duaXRvIHVzZXIgcG9vbHMnLFxuICAgICAgICB9LFxuICAgICAgXVxuICAgICk7XG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zQnlQYXRoKFxuICAgICAgdGhpcyxcbiAgICAgIGAvJHt0aGlzLnN0YWNrTmFtZX0vU2NoZWR1bGVyQXBpL0RlZmF1bHQvc2NoZWR1bGVzL3tzY2hlZHVsZUlkfS9QVVQvUmVzb3VyY2VgLFxuICAgICAgW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQVBJRzQnLFxuICAgICAgICAgIHJlYXNvbjogJ1VzaW5nIElBTSBTaWdWNCBhdXRoZW50aWNhdGlvbiBmb3Igc2VydmljZS10by1zZXJ2aWNlIGNvbW11bmljYXRpb24nLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQ09HNCcsXG4gICAgICAgICAgcmVhc29uOiAnVXNpbmcgSUFNIFNpZ1Y0IGF1dGhlbnRpY2F0aW9uIGZvciBzZXJ2aWNlLXRvLXNlcnZpY2UgY29tbXVuaWNhdGlvbiBpbnN0ZWFkIG9mIENvZ25pdG8gdXNlciBwb29scycsXG4gICAgICAgIH0sXG4gICAgICBdXG4gICAgKTtcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnNCeVBhdGgoXG4gICAgICB0aGlzLFxuICAgICAgYC8ke3RoaXMuc3RhY2tOYW1lfS9TY2hlZHVsZXJBcGkvRGVmYXVsdC9zY2hlZHVsZXMve3NjaGVkdWxlSWR9L0RFTEVURS9SZXNvdXJjZWAsXG4gICAgICBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1BUElHNCcsXG4gICAgICAgICAgcmVhc29uOiAnVXNpbmcgSUFNIFNpZ1Y0IGF1dGhlbnRpY2F0aW9uIGZvciBzZXJ2aWNlLXRvLXNlcnZpY2UgY29tbXVuaWNhdGlvbicsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1DT0c0JyxcbiAgICAgICAgICByZWFzb246ICdVc2luZyBJQU0gU2lnVjQgYXV0aGVudGljYXRpb24gZm9yIHNlcnZpY2UtdG8tc2VydmljZSBjb21tdW5pY2F0aW9uIGluc3RlYWQgb2YgQ29nbml0byB1c2VyIHBvb2xzJyxcbiAgICAgICAgfSxcbiAgICAgIF1cbiAgICApO1xuXG4gICAgLy8gU3VwcHJlc3MgYWNjZXNzIGxvZ3MgYnVja2V0IGxvZ2dpbmcgcmVxdWlyZW1lbnRcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnNCeVBhdGgoXG4gICAgICB0aGlzLFxuICAgICAgYC8ke3RoaXMuc3RhY2tOYW1lfS9BY2Nlc3NMb2dzQnVja2V0L1Jlc291cmNlYCxcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLVMxJyxcbiAgICAgICAgICByZWFzb246ICdUaGlzIGlzIHRoZSBhY2Nlc3MgbG9ncyBidWNrZXQgaXRzZWxmIC0gZW5hYmxpbmcgYWNjZXNzIGxvZ2dpbmcgd291bGQgY3JlYXRlIGFuIGluZmluaXRlIGxvb3AnLFxuICAgICAgICB9LFxuICAgICAgXVxuICAgICk7XG5cbiAgICAvLyBTdXBwcmVzcyBMYW1iZGEgSUFNIG1hbmFnZWQgcG9saWN5IHdhcm5pbmdzXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zQnlQYXRoKFxuICAgICAgdGhpcyxcbiAgICAgIGAvJHt0aGlzLnN0YWNrTmFtZX0vU2NoZWR1bGVNYW5hZ2VtZW50TGFtYmRhL1NlcnZpY2VSb2xlL1Jlc291cmNlYCxcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTQnLFxuICAgICAgICAgIHJlYXNvbjogJ0xhbWJkYSBmdW5jdGlvbnMgcmVxdWlyZSBBV1MgbWFuYWdlZCBCYXNpY0V4ZWN1dGlvblJvbGUgZm9yIENsb3VkV2F0Y2ggTG9ncycsXG4gICAgICAgICAgYXBwbGllc1RvOiBbJ1BvbGljeTo6YXJuOjxBV1M6OlBhcnRpdGlvbj46aWFtOjphd3M6cG9saWN5L3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnXSxcbiAgICAgICAgfSxcbiAgICAgIF1cbiAgICApO1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9uc0J5UGF0aChcbiAgICAgIHRoaXMsXG4gICAgICBgLyR7dGhpcy5zdGFja05hbWV9L1B1Ymxpc2hlckxhbWJkYS9TZXJ2aWNlUm9sZS9SZXNvdXJjZWAsXG4gICAgICBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU00JyxcbiAgICAgICAgICByZWFzb246ICdMYW1iZGEgZnVuY3Rpb25zIHJlcXVpcmUgQVdTIG1hbmFnZWQgQmFzaWNFeGVjdXRpb25Sb2xlIGZvciBDbG91ZFdhdGNoIExvZ3MnLFxuICAgICAgICAgIGFwcGxpZXNUbzogWydQb2xpY3k6OmFybjo8QVdTOjpQYXJ0aXRpb24+OmlhbTo6YXdzOnBvbGljeS9zZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJ10sXG4gICAgICAgIH0sXG4gICAgICBdXG4gICAgKTtcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnNCeVBhdGgoXG4gICAgICB0aGlzLFxuICAgICAgYC8ke3RoaXMuc3RhY2tOYW1lfS9SZXRyeUhhbmRsZXJMYW1iZGEvU2VydmljZVJvbGUvUmVzb3VyY2VgLFxuICAgICAgW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNCcsXG4gICAgICAgICAgcmVhc29uOiAnTGFtYmRhIGZ1bmN0aW9ucyByZXF1aXJlIEFXUyBtYW5hZ2VkIEJhc2ljRXhlY3V0aW9uUm9sZSBmb3IgQ2xvdWRXYXRjaCBMb2dzJyxcbiAgICAgICAgICBhcHBsaWVzVG86IFsnUG9saWN5Ojphcm46PEFXUzo6UGFydGl0aW9uPjppYW06OmF3czpwb2xpY3kvc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZSddLFxuICAgICAgICB9LFxuICAgICAgXVxuICAgICk7XG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zQnlQYXRoKFxuICAgICAgdGhpcyxcbiAgICAgIGAvJHt0aGlzLnN0YWNrTmFtZX0vU2NoZWR1bGVDbGVhbnVwTGFtYmRhL1NlcnZpY2VSb2xlL1Jlc291cmNlYCxcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTQnLFxuICAgICAgICAgIHJlYXNvbjogJ0xhbWJkYSBmdW5jdGlvbnMgcmVxdWlyZSBBV1MgbWFuYWdlZCBCYXNpY0V4ZWN1dGlvblJvbGUgZm9yIENsb3VkV2F0Y2ggTG9ncycsXG4gICAgICAgICAgYXBwbGllc1RvOiBbJ1BvbGljeTo6YXJuOjxBV1M6OlBhcnRpdGlvbj46aWFtOjphd3M6cG9saWN5L3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnXSxcbiAgICAgICAgfSxcbiAgICAgIF1cbiAgICApO1xuXG4gICAgLy8gU3VwcHJlc3MgTGFtYmRhIElBTSB3aWxkY2FyZCBwZXJtaXNzaW9uc1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9uc0J5UGF0aChcbiAgICAgIHRoaXMsXG4gICAgICBgLyR7dGhpcy5zdGFja05hbWV9L1NjaGVkdWxlTWFuYWdlbWVudExhbWJkYS9TZXJ2aWNlUm9sZS9EZWZhdWx0UG9saWN5L1Jlc291cmNlYCxcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICAgIHJlYXNvbjogJ0xhbWJkYSByZXF1aXJlcyB3aWxkY2FyZCBwZXJtaXNzaW9ucyBmb3IgWC1SYXkgdHJhY2luZywgRHluYW1vREIgR1NJIGFjY2VzcywgRXZlbnRCcmlkZ2Ugc2NoZWR1bGVzLCBhbmQgS01TIG9wZXJhdGlvbnMnLFxuICAgICAgICAgIGFwcGxpZXNUbzogW1xuICAgICAgICAgICAgJ1Jlc291cmNlOjoqJyxcbiAgICAgICAgICAgICdBY3Rpb246OmttczpHZW5lcmF0ZURhdGFLZXkqJyxcbiAgICAgICAgICAgICdBY3Rpb246OmttczpSZUVuY3J5cHQqJyxcbiAgICAgICAgICAgICdSZXNvdXJjZTo6PFNjaGVkdWxlc1RhYmxlRkJFQjAxODguQXJuPi9pbmRleC8qJyxcbiAgICAgICAgICAgIGBSZXNvdXJjZTo6YXJuOmF3czpzY2hlZHVsZXI6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnNjaGVkdWxlL3Bvc3RvbGlvLXNjaGVkdWxlci0ke2Vudmlyb25tZW50fS1zY2hlZHVsZXMvKmAsXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgIF1cbiAgICApO1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9uc0J5UGF0aChcbiAgICAgIHRoaXMsXG4gICAgICBgLyR7dGhpcy5zdGFja05hbWV9L1B1Ymxpc2hlckxhbWJkYS9TZXJ2aWNlUm9sZS9EZWZhdWx0UG9saWN5L1Jlc291cmNlYCxcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICAgIHJlYXNvbjogJ1B1Ymxpc2hlciBMYW1iZGEgcmVxdWlyZXMgd2lsZGNhcmQgcGVybWlzc2lvbnMgZm9yIFgtUmF5LCBEeW5hbW9EQiBHU0ksIFMzIG9wZXJhdGlvbnMsIEtNUywgYW5kIFRva2VuIFNlcnZpY2UgQVBJIEdFVCBhY2Nlc3MnLFxuICAgICAgICAgIGFwcGxpZXNUbzogW1xuICAgICAgICAgICAgJ1Jlc291cmNlOjoqJyxcbiAgICAgICAgICAgICdBY3Rpb246OmttczpHZW5lcmF0ZURhdGFLZXkqJyxcbiAgICAgICAgICAgICdBY3Rpb246OmttczpSZUVuY3J5cHQqJyxcbiAgICAgICAgICAgICdBY3Rpb246OnMzOkFib3J0KicsXG4gICAgICAgICAgICAnQWN0aW9uOjpzMzpEZWxldGVPYmplY3QqJyxcbiAgICAgICAgICAgICdBY3Rpb246OnMzOkdldEJ1Y2tldConLFxuICAgICAgICAgICAgJ0FjdGlvbjo6czM6R2V0T2JqZWN0KicsXG4gICAgICAgICAgICAnQWN0aW9uOjpzMzpMaXN0KicsXG4gICAgICAgICAgICAnUmVzb3VyY2U6OjxTY2hlZHVsZXNUYWJsZUZCRUIwMTg4LkFybj4vaW5kZXgvKicsXG4gICAgICAgICAgICAnUmVzb3VyY2U6OjxWaWRlb0J1Y2tldDZFRDhFMUFGLkFybj4vKicsXG4gICAgICAgICAgICBgUmVzb3VyY2U6OmFybjphd3M6ZXhlY3V0ZS1hcGk6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OiovKi9HRVQvdG9rZW5zLypgLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICBdXG4gICAgKTtcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnNCeVBhdGgoXG4gICAgICB0aGlzLFxuICAgICAgYC8ke3RoaXMuc3RhY2tOYW1lfS9SZXRyeUhhbmRsZXJMYW1iZGEvU2VydmljZVJvbGUvRGVmYXVsdFBvbGljeS9SZXNvdXJjZWAsXG4gICAgICBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgICByZWFzb246ICdSZXRyeSBoYW5kbGVyIHJlcXVpcmVzIHdpbGRjYXJkIHBlcm1pc3Npb25zIGZvciBYLVJheSwgS01TLCBEeW5hbW9EQiBHU0kgYWNjZXNzLCBhbmQgTGFtYmRhIGludm9jYXRpb24nLFxuICAgICAgICAgIGFwcGxpZXNUbzogW1xuICAgICAgICAgICAgJ1Jlc291cmNlOjoqJyxcbiAgICAgICAgICAgICdBY3Rpb246OmttczpHZW5lcmF0ZURhdGFLZXkqJyxcbiAgICAgICAgICAgICdBY3Rpb246OmttczpSZUVuY3J5cHQqJyxcbiAgICAgICAgICAgICdSZXNvdXJjZTo6PFB1Ymxpc2hlckxhbWJkYUIyNzQ5ODI3LkFybj46KicsXG4gICAgICAgICAgICAvLyBHcmFudCBmb3IgRHluYW1vREIgR1NJcyBwcm9kdWNlZCBieSB0YWJsZSBncmFudHM7IGxpbWl0ZWQgdG8gdGhpcyB0YWJsZSdzIGluZGV4ZXNcbiAgICAgICAgICAgICdSZXNvdXJjZTo6PFNjaGVkdWxlc1RhYmxlRkJFQjAxODguQXJuPi9pbmRleC8qJyxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgXVxuICAgICk7XG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zQnlQYXRoKFxuICAgICAgdGhpcyxcbiAgICAgIGAvJHt0aGlzLnN0YWNrTmFtZX0vU2NoZWR1bGVDbGVhbnVwTGFtYmRhL1NlcnZpY2VSb2xlL0RlZmF1bHRQb2xpY3kvUmVzb3VyY2VgLFxuICAgICAgW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNScsXG4gICAgICAgICAgcmVhc29uOiAnU2NoZWR1bGUgY2xlYW51cCBMYW1iZGEgcmVxdWlyZXMgd2lsZGNhcmQgcGVybWlzc2lvbnMgZm9yIFgtUmF5LCBEeW5hbW9EQiBHU0ksIEtNUywgYW5kIEV2ZW50QnJpZGdlIFNjaGVkdWxlciBsaXN0aW5nJyxcbiAgICAgICAgICBhcHBsaWVzVG86IFtcbiAgICAgICAgICAgICdSZXNvdXJjZTo6KicsXG4gICAgICAgICAgICAnQWN0aW9uOjprbXM6R2VuZXJhdGVEYXRhS2V5KicsXG4gICAgICAgICAgICAnQWN0aW9uOjprbXM6UmVFbmNyeXB0KicsXG4gICAgICAgICAgICAnUmVzb3VyY2U6OjxTY2hlZHVsZXNUYWJsZUZCRUIwMTg4LkFybj4vaW5kZXgvKicsXG4gICAgICAgICAgICBgUmVzb3VyY2U6OmFybjphd3M6c2NoZWR1bGVyOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpzY2hlZHVsZS9wb3N0b2xpby1zY2hlZHVsZXItJHtlbnZpcm9ubWVudH0tc2NoZWR1bGVzLypgLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICBdXG4gICAgKTtcblxuICAgIC8vIFN1cHByZXNzIFNjaGVkdWxlciBSb2xlIElBTSB3aWxkY2FyZCBwZXJtaXNzaW9uc1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9uc0J5UGF0aChcbiAgICAgIHRoaXMsXG4gICAgICBgLyR7dGhpcy5zdGFja05hbWV9L1NjaGVkdWxlclJvbGUvRGVmYXVsdFBvbGljeS9SZXNvdXJjZWAsXG4gICAgICBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1JQU01JyxcbiAgICAgICAgICByZWFzb246ICdFdmVudEJyaWRnZSBTY2hlZHVsZXIgcm9sZSByZXF1aXJlcyB3aWxkY2FyZCBmb3IgTGFtYmRhIGludm9jYXRpb24nLFxuICAgICAgICAgIGFwcGxpZXNUbzogWydSZXNvdXJjZTo6PFB1Ymxpc2hlckxhbWJkYUIyNzQ5ODI3LkFybj46KiddLFxuICAgICAgICB9LFxuICAgICAgXVxuICAgICk7XG5cbiAgICAvLyBTdXBwcmVzcyBBUEkgR2F0ZXdheSBDbG91ZFdhdGNoIFJvbGUgbWFuYWdlZCBwb2xpY3lcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnNCeVBhdGgoXG4gICAgICB0aGlzLFxuICAgICAgYC8ke3RoaXMuc3RhY2tOYW1lfS9BcGlHYXRld2F5Q2xvdWRXYXRjaFJvbGUvUmVzb3VyY2VgLFxuICAgICAgW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNCcsXG4gICAgICAgICAgcmVhc29uOiAnQVBJIEdhdGV3YXkgcmVxdWlyZXMgQVdTIG1hbmFnZWQgcG9saWN5IGZvciBDbG91ZFdhdGNoIGxvZ2dpbmcnLFxuICAgICAgICAgIGFwcGxpZXNUbzogWydQb2xpY3k6OmFybjo8QVdTOjpQYXJ0aXRpb24+OmlhbTo6YXdzOnBvbGljeS9zZXJ2aWNlLXJvbGUvQW1hem9uQVBJR2F0ZXdheVB1c2hUb0Nsb3VkV2F0Y2hMb2dzJ10sXG4gICAgICAgIH0sXG4gICAgICBdXG4gICAgKTtcblxuICAgIC8vIFJlZ2lzdGVyIENvbnRlbnQgU2NoZWR1bGVyIHdpdGggQ2xvdWQgTWFwXG4gICAgcmVnaXN0ZXJMYW1iZGFTZXJ2aWNlKFxuICAgICAgc2VydmljZURpc2NvdmVyeSxcbiAgICAgICdjb250ZW50LXNjaGVkdWxlcicsXG4gICAgICB0aGlzLmFwaS51cmwsXG4gICAgICBlbnZpcm9ubWVudFxuICAgICk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PSBPdXRwdXRzID09PT09PT09PT09PT09PT09PT09XG4gICAgXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FwaUVuZHBvaW50Jywge1xuICAgICAgdmFsdWU6IHRoaXMuYXBpLnVybCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29udGVudCBTY2hlZHVsZXIgQVBJIGVuZHBvaW50JyxcbiAgICAgIC8vIE5vIGV4cG9ydCBuZWVkZWQgLSBzZXJ2aWNlcyB1c2UgQ2xvdWQgTWFwIGZvciBkaXNjb3ZlcnlcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcGlBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5hcGkuYXJuRm9yRXhlY3V0ZUFwaSgpLFxuICAgICAgZGVzY3JpcHRpb246ICdDb250ZW50IFNjaGVkdWxlciBBUEkgQVJOIGZvciBJQU0gcGVybWlzc2lvbnMnLFxuICAgICAgLy8gTm8gZXhwb3J0IG5lZWRlZCAtIHNlcnZpY2VzIHVzZSBDbG91ZCBNYXAgZm9yIGRpc2NvdmVyeVxuICAgIH0pO1xuXG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU2NoZWR1bGVzVGFibGVOYW1lJywge1xuICAgICAgdmFsdWU6IHRoaXMuc2NoZWR1bGVzVGFibGUudGFibGVOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdEeW5hbW9EQiBTY2hlZHVsZXMgdGFibGUgbmFtZScsXG4gICAgICBleHBvcnROYW1lOiBgJHtwcmVmaXh9LXNjaGVkdWxlcy10YWJsZWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVmlkZW9CdWNrZXROYW1lJywge1xuICAgICAgdmFsdWU6IHRoaXMudmlkZW9CdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUzMgVmlkZW8gYnVja2V0IG5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogYCR7cHJlZml4fS12aWRlby1idWNrZXRgLFxuICAgIH0pO1xuXG4gICAgLy8gU2VydmljZSBjbGllbnQgc2VjcmV0IHJlbW92ZWQgLSB1c2luZyBJQU0gU2lnVjQgYXV0aGVudGljYXRpb25cbiAgfVxufVxuIl19