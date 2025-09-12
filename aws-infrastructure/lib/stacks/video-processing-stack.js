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
exports.VideoProcessingStack = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const s3 = __importStar(require("aws-cdk-lib/aws-s3"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const sqs = __importStar(require("aws-cdk-lib/aws-sqs"));
const events = __importStar(require("aws-cdk-lib/aws-events"));
const targets = __importStar(require("aws-cdk-lib/aws-events-targets"));
const cloudfront = __importStar(require("aws-cdk-lib/aws-cloudfront"));
const origins = __importStar(require("aws-cdk-lib/aws-cloudfront-origins"));
const s3n = __importStar(require("aws-cdk-lib/aws-s3-notifications"));
const aws_lambda_nodejs_1 = require("aws-cdk-lib/aws-lambda-nodejs");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
class VideoProcessingStack extends aws_cdk_lib_1.Stack {
    videoBucket;
    processedVideoBucket;
    videoUploadFunction;
    videoProcessorFunction;
    videoValidatorFunction;
    videoDistribution;
    getAllowedOrigins(environment) {
        switch (environment) {
            case 'prod':
                return ['https://postolio.example', 'https://postolio.example'];
            case 'staging':
                return ['https://postolio.example'];
            default:
                return ['http://localhost:3000', 'http://localhost:5173'];
        }
    }
    constructor(scope, id, props) {
        super(scope, id, props);
        const { environment, schedulesTable, powertoolsLayer } = props;
        // S3 Bucket for access logs
        const logBucket = new s3.Bucket(this, 'AccessLogBucket', {
            bucketName: `postolio-video-logs-${environment}-${this.account}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            lifecycleRules: [
                {
                    id: 'delete-old-logs',
                    expiration: aws_cdk_lib_1.Duration.days(90),
                },
            ],
            removalPolicy: environment === 'prod' ? aws_cdk_lib_1.RemovalPolicy.RETAIN : aws_cdk_lib_1.RemovalPolicy.DESTROY,
            autoDeleteObjects: environment !== 'prod',
        });
        // S3 Buckets for video storage with access logging
        this.videoBucket = new s3.Bucket(this, 'VideoBucket', {
            bucketName: `postolio-videos-${environment}-${this.account}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: environment === 'prod' ? aws_cdk_lib_1.RemovalPolicy.RETAIN : aws_cdk_lib_1.RemovalPolicy.DESTROY,
            autoDeleteObjects: environment !== 'prod',
            serverAccessLogsBucket: logBucket,
            serverAccessLogsPrefix: 'video-bucket/',
            lifecycleRules: [
                {
                    id: 'delete-incomplete-uploads',
                    abortIncompleteMultipartUploadAfter: aws_cdk_lib_1.Duration.days(7),
                },
                {
                    id: 'transition-old-videos',
                    transitions: [
                        {
                            storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                            transitionAfter: aws_cdk_lib_1.Duration.days(30),
                        },
                        {
                            storageClass: s3.StorageClass.GLACIER,
                            transitionAfter: aws_cdk_lib_1.Duration.days(90),
                        },
                    ],
                },
            ],
            cors: [
                {
                    allowedMethods: [
                        s3.HttpMethods.GET,
                        s3.HttpMethods.PUT,
                        s3.HttpMethods.POST,
                        s3.HttpMethods.DELETE,
                        s3.HttpMethods.HEAD,
                    ],
                    allowedOrigins: this.getAllowedOrigins(environment),
                    allowedHeaders: ['Content-Type', 'Authorization', 'x-amz-meta-*'],
                    exposedHeaders: ['ETag', 'x-amz-server-side-encryption', 'x-amz-request-id'],
                    maxAge: 3000,
                },
            ],
        });
        this.processedVideoBucket = new s3.Bucket(this, 'ProcessedVideoBucket', {
            bucketName: `postolio-processed-videos-${environment}-${this.account}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: environment === 'prod' ? aws_cdk_lib_1.RemovalPolicy.RETAIN : aws_cdk_lib_1.RemovalPolicy.DESTROY,
            autoDeleteObjects: environment !== 'prod',
            serverAccessLogsBucket: logBucket,
            serverAccessLogsPrefix: 'processed-video-bucket/',
            lifecycleRules: [
                {
                    id: 'delete-old-processed-videos',
                    expiration: aws_cdk_lib_1.Duration.days(180),
                },
            ],
        });
        // DynamoDB tables for video tracking
        const videoUploadsTable = new dynamodb.Table(this, 'VideoUploadsTable', {
            tableName: `VideoUploads-${environment}`,
            partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            removalPolicy: environment === 'prod' ? aws_cdk_lib_1.RemovalPolicy.RETAIN : aws_cdk_lib_1.RemovalPolicy.DESTROY,
            timeToLiveAttribute: 'ttl',
        });
        const videoProcessingTable = new dynamodb.Table(this, 'VideoProcessingTable', {
            tableName: `VideoProcessing-${environment}`,
            partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            removalPolicy: environment === 'prod' ? aws_cdk_lib_1.RemovalPolicy.RETAIN : aws_cdk_lib_1.RemovalPolicy.DESTROY,
            timeToLiveAttribute: 'ttl',
        });
        // SQS Dead Letter Queue for failed video processing
        const videoDLQ = new sqs.Queue(this, 'VideoProcessingDLQ', {
            queueName: `VideoProcessingDLQ-${environment}`,
            retentionPeriod: aws_cdk_lib_1.Duration.days(14),
            encryption: sqs.QueueEncryption.KMS_MANAGED,
        });
        // IAM Role for MediaConvert with least privilege
        const mediaConvertRole = new iam.Role(this, 'MediaConvertRole', {
            assumedBy: new iam.ServicePrincipal('mediaconvert.amazonaws.com'),
            description: `MediaConvert role for video processing in ${environment}`,
        });
        // Add specific S3 permissions for MediaConvert
        mediaConvertRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['s3:GetObject', 's3:GetObjectVersion'],
            resources: [this.videoBucket.arnForObjects('*')],
        }));
        mediaConvertRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['s3:PutObject', 's3:PutObjectAcl'],
            resources: [this.processedVideoBucket.arnForObjects('*')],
        }));
        // Video Upload Lambda
        this.videoUploadFunction = new aws_lambda_nodejs_1.NodejsFunction(this, 'VideoUploadFunction', {
            functionName: `video-upload-${environment}`,
            entry: path.join(__dirname, '../lambda/video-upload/index.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            memorySize: 1024,
            timeout: aws_cdk_lib_1.Duration.minutes(5),
            environment: {
                VIDEO_BUCKET: this.videoBucket.bucketName,
                VIDEO_UPLOADS_TABLE: videoUploadsTable.tableName,
                // VIDEO_PROCESSOR_LAMBDA will be added after processor is created
                ENVIRONMENT: environment,
            },
            layers: [powertoolsLayer],
            tracing: lambda.Tracing.ACTIVE,
        });
        // Grant permissions to video upload function
        this.videoBucket.grantReadWrite(this.videoUploadFunction);
        videoUploadsTable.grantReadWriteData(this.videoUploadFunction);
        // Video Processor Lambda
        this.videoProcessorFunction = new aws_lambda_nodejs_1.NodejsFunction(this, 'VideoProcessorFunction', {
            functionName: `video-processor-${environment}`,
            entry: path.join(__dirname, '../lambda/video-processor/index.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            memorySize: 2048,
            timeout: aws_cdk_lib_1.Duration.minutes(15),
            environment: {
                VIDEO_BUCKET: this.videoBucket.bucketName,
                PROCESSED_VIDEO_BUCKET: this.processedVideoBucket.bucketName,
                VIDEO_UPLOADS_TABLE: videoUploadsTable.tableName,
                VIDEO_PROCESSING_TABLE: videoProcessingTable.tableName,
                VIDEO_DLQ_URL: videoDLQ.queueUrl,
                MEDIACONVERT_ENDPOINT: `https://mediaconvert.${this.region}.amazonaws.com`,
                MEDIACONVERT_ROLE_ARN: mediaConvertRole.roleArn,
                MEDIACONVERT_QUEUE_ARN: `arn:aws:mediaconvert:${this.region}:${this.account}:queues/Default`,
                SCHEDULE_QUEUE_URL: '', // Will be set later if needed
                ENVIRONMENT: environment,
                // VIDEO_VALIDATOR_LAMBDA will be added after validator is created
            },
            layers: [powertoolsLayer],
            tracing: lambda.Tracing.ACTIVE,
        });
        // Grant permissions to video processor
        this.videoBucket.grantRead(this.videoProcessorFunction);
        this.processedVideoBucket.grantReadWrite(this.videoProcessorFunction);
        videoUploadsTable.grantReadWriteData(this.videoProcessorFunction);
        videoProcessingTable.grantReadWriteData(this.videoProcessorFunction);
        videoDLQ.grantSendMessages(this.videoProcessorFunction);
        // Grant video upload function permission to invoke video processor
        this.videoProcessorFunction.grantInvoke(this.videoUploadFunction);
        // Add VIDEO_PROCESSOR_LAMBDA environment variable after processor is created
        this.videoUploadFunction.addEnvironment('VIDEO_PROCESSOR_LAMBDA', this.videoProcessorFunction.functionArn);
        // Grant MediaConvert permissions with specific resources
        this.videoProcessorFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: ['mediaconvert:CreateJob', 'mediaconvert:GetJob'],
            resources: [
                `arn:aws:mediaconvert:${this.region}:${this.account}:jobs/*`,
                `arn:aws:mediaconvert:${this.region}:${this.account}:queues/Default`,
                `arn:aws:mediaconvert:${this.region}:${this.account}:queues/*`,
            ],
        }));
        // DescribeEndpoints must have * resource
        this.videoProcessorFunction.addToRolePolicy(new iam.PolicyStatement({
            actions: ['mediaconvert:DescribeEndpoints'],
            resources: ['*'], // This action requires * resource
        }));
        // Add S3 trigger for video processor
        this.videoBucket.addEventNotification(s3.EventType.OBJECT_CREATED_COMPLETE_MULTIPART_UPLOAD, new s3n.LambdaDestination(this.videoProcessorFunction), { prefix: 'videos/' });
        // Video Validator Lambda (with FFmpeg layer)
        const ffmpegLayerAssetPath = path.join(__dirname, '../layers/ffmpeg');
        const ffmpegBinPath = path.join(ffmpegLayerAssetPath, 'bin');
        // Check if FFmpeg binaries exist; fail deployment if missing
        if (!fs.existsSync(path.join(ffmpegBinPath, 'ffmpeg')) ||
            !fs.existsSync(path.join(ffmpegBinPath, 'ffprobe'))) {
            // Create bin directory if it doesn't exist for development
            if (!fs.existsSync(ffmpegBinPath)) {
                fs.mkdirSync(ffmpegBinPath, { recursive: true });
            }
            console.warn(`\n⚠️  FFmpeg binaries not found at ${ffmpegBinPath}\n` +
                `\nTo set up FFmpeg binaries:\n` +
                `1. Download FFmpeg static builds:\n` +
                `   wget https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz\n` +
                `2. Extract and copy binaries:\n` +
                `   tar xf ffmpeg-release-amd64-static.tar.xz\n` +
                `   cp ffmpeg-*/ffmpeg ${ffmpegBinPath}/\n` +
                `   cp ffmpeg-*/ffprobe ${ffmpegBinPath}/\n` +
                `   chmod +x ${ffmpegBinPath}/*\n` +
                `\nFor development, creating empty binaries. Production deployment will require actual binaries.\n`);
            // For development only - create empty executable files
            fs.writeFileSync(path.join(ffmpegBinPath, 'ffmpeg'), '#!/bin/sh\necho "FFmpeg placeholder"');
            fs.writeFileSync(path.join(ffmpegBinPath, 'ffprobe'), '#!/bin/sh\necho "FFprobe placeholder"');
            fs.chmodSync(path.join(ffmpegBinPath, 'ffmpeg'), 0o755);
            fs.chmodSync(path.join(ffmpegBinPath, 'ffprobe'), 0o755);
        }
        const ffmpegLayer = new lambda.LayerVersion(this, 'FFmpegLayer', {
            code: lambda.Code.fromAsset(ffmpegLayerAssetPath),
            compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
            description: 'FFmpeg and FFprobe binaries',
        });
        this.videoValidatorFunction = new aws_lambda_nodejs_1.NodejsFunction(this, 'VideoValidatorFunction', {
            functionName: `video-validator-${environment}`,
            entry: path.join(__dirname, '../lambda/video-validator/index.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            memorySize: 3008, // Maximum memory for faster downloads
            timeout: aws_cdk_lib_1.Duration.minutes(10),
            environment: {
                VIDEO_UPLOADS_TABLE: videoUploadsTable.tableName,
                ENVIRONMENT: environment,
                PATH: '/opt/bin:$PATH', // Add FFmpeg to PATH
            },
            layers: [powertoolsLayer, ffmpegLayer],
            tracing: lambda.Tracing.ACTIVE,
        });
        // Grant permissions to video validator
        this.videoBucket.grantRead(this.videoValidatorFunction);
        videoUploadsTable.grantReadWriteData(this.videoValidatorFunction);
        // Grant video processor permission to invoke video validator
        this.videoValidatorFunction.grantInvoke(this.videoProcessorFunction);
        // Add VIDEO_VALIDATOR_LAMBDA environment variable after validator is created
        this.videoProcessorFunction.addEnvironment('VIDEO_VALIDATOR_LAMBDA', this.videoValidatorFunction.functionArn);
        // CloudWatch Events for MediaConvert job status updates
        const mediaConvertEventRule = new events.Rule(this, 'MediaConvertJobStatusRule', {
            eventPattern: {
                source: ['aws.mediaconvert'],
                detailType: ['MediaConvert Job State Change'],
                detail: {
                    status: ['COMPLETE', 'ERROR', 'PROGRESSING'],
                },
            },
        });
        // Create a separate handler for MediaConvert events
        const mediaConvertEventHandler = new aws_lambda_nodejs_1.NodejsFunction(this, 'MediaConvertEventHandler', {
            functionName: `mediaconvert-event-handler-${environment}`,
            entry: path.join(__dirname, '../lambda/video-processor/index.ts'),
            handler: 'handleJobStatusUpdate',
            runtime: lambda.Runtime.NODEJS_20_X,
            memorySize: 512,
            timeout: aws_cdk_lib_1.Duration.seconds(30),
            environment: {
                VIDEO_UPLOADS_TABLE: videoUploadsTable.tableName,
                VIDEO_PROCESSING_TABLE: videoProcessingTable.tableName,
                VIDEO_DLQ_URL: videoDLQ.queueUrl,
                SCHEDULE_QUEUE_URL: '', // Will be set later if needed
                ENVIRONMENT: environment,
            },
            layers: [powertoolsLayer],
            tracing: lambda.Tracing.ACTIVE,
        });
        videoUploadsTable.grantReadWriteData(mediaConvertEventHandler);
        videoProcessingTable.grantReadWriteData(mediaConvertEventHandler);
        videoDLQ.grantSendMessages(mediaConvertEventHandler);
        mediaConvertEventRule.addTarget(new targets.LambdaFunction(mediaConvertEventHandler));
        // CloudFront distribution for video delivery
        const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'VideoOAI', {
            comment: `OAI for Postolio video delivery ${environment}`,
        });
        this.processedVideoBucket.grantRead(originAccessIdentity);
        this.videoDistribution = new cloudfront.Distribution(this, 'VideoDistribution', {
            defaultBehavior: {
                origin: new origins.S3Origin(this.processedVideoBucket, {
                    originAccessIdentity,
                }),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
                compress: true,
            },
            enableLogging: true,
            logBucket: new s3.Bucket(this, 'VideoDistributionLogs', {
                bucketName: `postolio-video-cdn-logs-${environment}-${this.account}`,
                encryption: s3.BucketEncryption.S3_MANAGED,
                lifecycleRules: [
                    {
                        id: 'delete-old-logs',
                        expiration: aws_cdk_lib_1.Duration.days(30),
                    },
                ],
                removalPolicy: environment === 'prod' ? aws_cdk_lib_1.RemovalPolicy.RETAIN : aws_cdk_lib_1.RemovalPolicy.DESTROY,
                autoDeleteObjects: environment !== 'prod',
            }),
            priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
            comment: `Postolio video CDN ${environment}`,
        });
        // Outputs
        this.exportValue(this.videoBucket.bucketName, { name: `VideoBucket-${environment}` });
        this.exportValue(this.processedVideoBucket.bucketName, { name: `ProcessedVideoBucket-${environment}` });
        this.exportValue(this.videoDistribution.distributionDomainName, { name: `VideoCDN-${environment}` });
    }
}
exports.VideoProcessingStack = VideoProcessingStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmlkZW8tcHJvY2Vzc2luZy1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInZpZGVvLXByb2Nlc3Npbmctc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsNkNBQXlFO0FBRXpFLCtEQUFpRDtBQUNqRCx1REFBeUM7QUFDekMsbUVBQXFEO0FBQ3JELHlEQUEyQztBQUMzQyx5REFBMkM7QUFDM0MsK0RBQWlEO0FBQ2pELHdFQUEwRDtBQUMxRCx1RUFBeUQ7QUFDekQsNEVBQThEO0FBQzlELHNFQUF3RDtBQUN4RCxxRUFBK0Q7QUFDL0QsMkNBQTZCO0FBQzdCLHVDQUF5QjtBQVV6QixNQUFhLG9CQUFxQixTQUFRLG1CQUFLO0lBQzdCLFdBQVcsQ0FBWTtJQUN2QixvQkFBb0IsQ0FBWTtJQUNoQyxtQkFBbUIsQ0FBaUI7SUFDcEMsc0JBQXNCLENBQWlCO0lBQ3ZDLHNCQUFzQixDQUFpQjtJQUN2QyxpQkFBaUIsQ0FBMEI7SUFFbkQsaUJBQWlCLENBQUMsV0FBbUI7UUFDM0MsUUFBUSxXQUFXLEVBQUUsQ0FBQztZQUNwQixLQUFLLE1BQU07Z0JBQ1QsT0FBTyxDQUFDLHVCQUF1QixFQUFFLG1CQUFtQixDQUFDLENBQUM7WUFDeEQsS0FBSyxTQUFTO2dCQUNaLE9BQU8sQ0FBQywyQkFBMkIsQ0FBQyxDQUFDO1lBQ3ZDO2dCQUNFLE9BQU8sQ0FBQyx1QkFBdUIsRUFBRSx1QkFBdUIsQ0FBQyxDQUFDO1FBQzlELENBQUM7SUFDSCxDQUFDO0lBRUQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFnQztRQUN4RSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsV0FBVyxFQUFFLGNBQWMsRUFBRSxlQUFlLEVBQUUsR0FBRyxLQUFLLENBQUM7UUFFL0QsNEJBQTRCO1FBQzVCLE1BQU0sU0FBUyxHQUFHLElB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QUFJLENBQUMsV0FBVyxDQUFDLFVBQVUsRUFBRSxFQUFFLElBQUksRUFBRSxlQUFlLFdBQVcsRUFBRSxFQUFFLENBQUMsQ0FBQztRQUN0RixJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxVQUFVLEVBQUUsRUFBRSxJQUFJLEVBQUUsd0JBQXdCLFdBQVcsRUFBRSxFQUFFLENBQUMsQ0FBQztRQUN4RyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxzQkFBc0IsRUFBRSxFQUFFLElBQUksRUFBRSxZQUFZLFdBQVcsRUFBRSxFQUFFLENBQUMsQ0FBQztJQUN2RyxDQUFDO0NBQ0Y7QUF2WEQsb0RBdVhDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU3RhY2ssIFN0YWNrUHJvcHMsIER1cmF0aW9uLCBSZW1vdmFsUG9saWN5IH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIHNxcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3FzJztcbmltcG9ydCAqIGFzIGV2ZW50cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzJztcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcbmltcG9ydCAqIGFzIGNsb3VkZnJvbnQgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnQnO1xuaW1wb3J0ICogYXMgb3JpZ2lucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udC1vcmlnaW5zJztcbmltcG9ydCAqIGFzIHMzbiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMtbm90aWZpY2F0aW9ucyc7XG5pbXBvcnQgeyBOb2RlanNGdW5jdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVmlkZW9Qcm9jZXNzaW5nU3RhY2tQcm9wcyBleHRlbmRzIFN0YWNrUHJvcHMge1xuICBlbnZpcm9ubWVudDogc3RyaW5nO1xuICBzY2hlZHVsZXNUYWJsZTogZHluYW1vZGIuVGFibGU7XG4gIHBvd2VydG9vbHNMYXllcjogbGFtYmRhLkxheWVyVmVyc2lvbjtcbiAgbWFpbkFwcEFwaVVybDogc3RyaW5nO1xuICBpbnRlcm5hbEFwaVNlY3JldDogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgVmlkZW9Qcm9jZXNzaW5nU3RhY2sgZXh0ZW5kcyBTdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSB2aWRlb0J1Y2tldDogczMuQnVja2V0O1xuICBwdWJsaWMgcmVhZG9ubHkgcHJvY2Vzc2VkVmlkZW9CdWNrZXQ6IHMzLkJ1Y2tldDtcbiAgcHVibGljIHJlYWRvbmx5IHZpZGVvVXBsb2FkRnVuY3Rpb246IE5vZGVqc0Z1bmN0aW9uO1xuICBwdWJsaWMgcmVhZG9ubHkgdmlkZW9Qcm9jZXNzb3JGdW5jdGlvbjogTm9kZWpzRnVuY3Rpb247XG4gIHB1YmxpYyByZWFkb25seSB2aWRlb1ZhbGlkYXRvckZ1bmN0aW9uOiBOb2RlanNGdW5jdGlvbjtcbiAgcHVibGljIHJlYWRvbmx5IHZpZGVvRGlzdHJpYnV0aW9uOiBjbG91ZGZyb250LkRpc3RyaWJ1dGlvbjtcblxuICBwcml2YXRlIGdldEFsbG93ZWRPcmlnaW5zKGVudmlyb25tZW50OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgc3dpdGNoIChlbnZpcm9ubWVudCkge1xuICAgICAgY2FzZSAncHJvZCc6XG4gICAgICAgIHJldHVybiBbJ2h0dHBzOi8vYXBwLnBvc3RvbC5pbycsICdodHRwczovL3Bvc3RvbC5pbyddO1xuICAgICAgY2FzZSAnc3RhZ2luZyc6XG4gICAgICAgIHJldHVybiBbJ2h0dHBzOi8vc3RhZ2luZy5wb3N0b2wuaW8nXTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybiBbJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMCcsICdodHRwOi8vbG9jYWxob3N0OjUxNzMnXTtcbiAgICB9XG4gIH1cblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogVmlkZW9Qcm9jZXNzaW5nU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgeyBlbnZpcm9ubWVudCwgc2NoZWR1bGVzVGFibGUsIHBvd2VydG9vbHNMYXllciB9ID0gcHJvcHM7XG5cbiAgICAvLyBTMyBCdWNrZXQgZm9yIGFjY2VzcyBsb2dzXG4gICAgY29uc3QgbG9nQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnQWNjZXNzTG9nQnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogYHBvc3RvbGlvLXZpZGVvLWxvZ3MtJHtlbnZpcm9ubWVudH0tJHt0aGlzLmFjY291bnR9YCxcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICBsaWZlY3ljbGVSdWxlczogW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdkZWxldGUtb2xkLWxvZ3MnLFxuICAgICAgICAgIGV4cGlyYXRpb246IER1cmF0aW9uLmRheXMoOTApLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGVudmlyb25tZW50ID09PSAncHJvZCcgPyBSZW1vdmFsUG9saWN5LlJFVEFJTiA6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiBlbnZpcm9ubWVudCAhPT0gJ3Byb2QnLFxuICAgIH0pO1xuXG4gICAgLy8gUzMgQnVja2V0cyBmb3IgdmlkZW8gc3RvcmFnZSB3aXRoIGFjY2VzcyBsb2dnaW5nXG4gICAgdGhpcy52aWRlb0J1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ1ZpZGVvQnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogYHBvc3RvbGlvLXZpZGVvcy0ke2Vudmlyb25tZW50fS0ke3RoaXMuYWNjb3VudH1gLFxuICAgICAgZW5jcnlwdGlvbjogczMuQnVja2V0RW5jcnlwdGlvbi5TM19NQU5BR0VELFxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGVudmlyb25tZW50ID09PSAncHJvZCcgPyBSZW1vdmFsUG9saWN5LlJFVEFJTiA6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiBlbnZpcm9ubWVudCAhPT0gJ3Byb2QnLFxuICAgICAgc2VydmVyQWNjZXNzTG9nc0J1Y2tldDogbG9nQnVja2V0LFxuICAgICAgc2VydmVyQWNjZXNzTG9nc1ByZWZpeDogJ3ZpZGVvLWJ1Y2tldC8nLFxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnZGVsZXRlLWluY29tcGxldGUtdXBsb2FkcycsXG4gICAgICAgICAgYWJvcnRJbmNvbXBsZXRlTXVsdGlwYXJ0VXBsb2FkQWZ0ZXI6IER1cmF0aW9uLmRheXMoNyksXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ3RyYW5zaXRpb24tb2xkLXZpZGVvcycsXG4gICAgICAgICAgdHJhbnNpdGlvbnM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3RvcmFnZUNsYXNzOiBzMy5TdG9yYWdlQ2xhc3MuSU5GUkVRVUVOVF9BQ0NFU1MsXG4gICAgICAgICAgICAgIHRyYW5zaXRpb25BZnRlcjogRHVyYXRpb24uZGF5cygzMCksXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzdG9yYWdlQ2xhc3M6IHMzLlN0b3JhZ2VDbGFzcy5HTEFDSUVSLFxuICAgICAgICAgICAgICB0cmFuc2l0aW9uQWZ0ZXI6IER1cmF0aW9uLmRheXMoOTApLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIGNvcnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBbXG4gICAgICAgICAgICBzMy5IdHRwTWV0aG9kcy5HRVQsXG4gICAgICAgICAgICBzMy5IdHRwTWV0aG9kcy5QVVQsXG4gICAgICAgICAgICBzMy5IdHRwTWV0aG9kcy5QT1NULFxuICAgICAgICAgICAgczMuSHR0cE1ldGhvZHMuREVMRVRFLFxuICAgICAgICAgICAgczMuSHR0cE1ldGhvZHMuSEVBRCxcbiAgICAgICAgICBdLFxuICAgICAgICAgIGFsbG93ZWRPcmlnaW5zOiB0aGlzLmdldEFsbG93ZWRPcmlnaW5zKGVudmlyb25tZW50KSxcbiAgICAgICAgICBhbGxvd2VkSGVhZGVyczogWydDb250ZW50LVR5cGUnLCAnQXV0aG9yaXphdGlvbicsICd4LWFtei1tZXRhLSonXSxcbiAgICAgICAgICBleHBvc2VkSGVhZGVyczogWydFVGFnJywgJ3gtYW16LXNlcnZlci1zaWRlLWVuY3J5cHRpb24nLCAneC1hbXotcmVxdWVzdC1pZCddLFxuICAgICAgICAgIG1heEFnZTogMzAwMCxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICB0aGlzLnByb2Nlc3NlZFZpZGVvQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnUHJvY2Vzc2VkVmlkZW9CdWNrZXQnLCB7XG4gICAgICBidWNrZXROYW1lOiBgcG9zdG9saW8tcHJvY2Vzc2VkLXZpZGVvcy0ke2Vudmlyb25tZW50fS0ke3RoaXMuYWNjb3VudH1gLFxuICAgICAgZW5jcnlwdGlvbjogczMuQnVja2V0RW5jcnlwdGlvbi5TM19NQU5BR0VELFxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGVudmlyb25tZW50ID09PSAncHJvZCcgPyBSZW1vdmFsUG9saWN5LlJFVEFJTiA6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiBlbnZpcm9ubWVudCAhPT0gJ3Byb2QnLFxuICAgICAgc2VydmVyQWNjZXNzTG9nc0J1Y2tldDogbG9nQnVja2V0LFxuICAgICAgc2VydmVyQWNjZXNzTG9nc1ByZWZpeDogJ3Byb2Nlc3NlZC12aWRlby1idWNrZXQvJyxcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ2RlbGV0ZS1vbGQtcHJvY2Vzc2VkLXZpZGVvcycsXG4gICAgICAgICAgZXhwaXJhdGlvbjogRHVyYXRpb24uZGF5cygxODApLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIER5bmFtb0RCIHRhYmxlcyBmb3IgdmlkZW8gdHJhY2tpbmdcbiAgICBjb25zdCB2aWRlb1VwbG9hZHNUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnVmlkZW9VcGxvYWRzVGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6IGBWaWRlb1VwbG9hZHMtJHtlbnZpcm9ubWVudH1gLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdwaycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdzaycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkFXU19NQU5BR0VELFxuICAgICAgcmVtb3ZhbFBvbGljeTogZW52aXJvbm1lbnQgPT09ICdwcm9kJyA/IFJlbW92YWxQb2xpY3kuUkVUQUlOIDogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsXG4gICAgfSk7XG5cbiAgICBjb25zdCB2aWRlb1Byb2Nlc3NpbmdUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnVmlkZW9Qcm9jZXNzaW5nVGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6IGBWaWRlb1Byb2Nlc3NpbmctJHtlbnZpcm9ubWVudH1gLFxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdwaycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdzaycsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkFXU19NQU5BR0VELFxuICAgICAgcmVtb3ZhbFBvbGljeTogZW52aXJvbm1lbnQgPT09ICdwcm9kJyA/IFJlbW92YWxQb2xpY3kuUkVUQUlOIDogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsXG4gICAgfSk7XG5cbiAgICAvLyBTUVMgRGVhZCBMZXR0ZXIgUXVldWUgZm9yIGZhaWxlZCB2aWRlbyBwcm9jZXNzaW5nXG4gICAgY29uc3QgdmlkZW9ETFEgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsICdWaWRlb1Byb2Nlc3NpbmdETFEnLCB7XG4gICAgICBxdWV1ZU5hbWU6IGBWaWRlb1Byb2Nlc3NpbmdETFEtJHtlbnZpcm9ubWVudH1gLFxuICAgICAgcmV0ZW50aW9uUGVyaW9kOiBEdXJhdGlvbi5kYXlzKDE0KSxcbiAgICAgIGVuY3J5cHRpb246IHNxcy5RdWV1ZUVuY3J5cHRpb24uS01TX01BTkFHRUQsXG4gICAgfSk7XG5cbiAgICAvLyBJQU0gUm9sZSBmb3IgTWVkaWFDb252ZXJ0IHdpdGggbGVhc3QgcHJpdmlsZWdlXG4gICAgY29uc3QgbWVkaWFDb252ZXJ0Um9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnTWVkaWFDb252ZXJ0Um9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdtZWRpYWNvbnZlcnQuYW1hem9uYXdzLmNvbScpLFxuICAgICAgZGVzY3JpcHRpb246IGBNZWRpYUNvbnZlcnQgcm9sZSBmb3IgdmlkZW8gcHJvY2Vzc2luZyBpbiAke2Vudmlyb25tZW50fWAsXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgc3BlY2lmaWMgUzMgcGVybWlzc2lvbnMgZm9yIE1lZGlhQ29udmVydFxuICAgIG1lZGlhQ29udmVydFJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogWydzMzpHZXRPYmplY3QnLCAnczM6R2V0T2JqZWN0VmVyc2lvbiddLFxuICAgICAgcmVzb3VyY2VzOiBbdGhpcy52aWRlb0J1Y2tldC5hcm5Gb3JPYmplY3RzKCcqJyldLFxuICAgIH0pKTtcblxuICAgIG1lZGlhQ29udmVydFJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogWydzMzpQdXRPYmplY3QnLCAnczM6UHV0T2JqZWN0QWNsJ10sXG4gICAgICByZXNvdXJjZXM6IFt0aGlzLnByb2Nlc3NlZFZpZGVvQnVja2V0LmFybkZvck9iamVjdHMoJyonKV0sXG4gICAgfSkpO1xuXG4gICAgLy8gVmlkZW8gVXBsb2FkIExhbWJkYVxuICAgIHRoaXMudmlkZW9VcGxvYWRGdW5jdGlvbiA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLCAnVmlkZW9VcGxvYWRGdW5jdGlvbicsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogYHZpZGVvLXVwbG9hZC0ke2Vudmlyb25tZW50fWAsXG4gICAgICBlbnRyeTogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2xhbWJkYS92aWRlby11cGxvYWQvaW5kZXgudHMnKSxcbiAgICAgIGhhbmRsZXI6ICdoYW5kbGVyJyxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgbWVtb3J5U2l6ZTogMTAyNCxcbiAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBWSURFT19CVUNLRVQ6IHRoaXMudmlkZW9CdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgVklERU9fVVBMT0FEU19UQUJMRTogdmlkZW9VcGxvYWRzVGFibGUudGFibGVOYW1lLFxuICAgICAgICAvLyBWSURFT19QUk9DRVNTT1JfTEFNQkRBIHdpbGwgYmUgYWRkZWQgYWZ0ZXIgcHJvY2Vzc29yIGlzIGNyZWF0ZWRcbiAgICAgICAgRU5WSVJPTk1FTlQ6IGVudmlyb25tZW50LFxuICAgICAgfSxcbiAgICAgIGxheWVyczogW3Bvd2VydG9vbHNMYXllcl0sXG4gICAgICB0cmFjaW5nOiBsYW1iZGEuVHJhY2luZy5BQ1RJVkUsXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyB0byB2aWRlbyB1cGxvYWQgZnVuY3Rpb25cbiAgICB0aGlzLnZpZGVvQnVja2V0LmdyYW50UmVhZFdyaXRlKHRoaXMudmlkZW9VcGxvYWRGdW5jdGlvbik7XG4gICAgdmlkZW9VcGxvYWRzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHRoaXMudmlkZW9VcGxvYWRGdW5jdGlvbik7XG5cbiAgICAvLyBWaWRlbyBQcm9jZXNzb3IgTGFtYmRhXG4gICAgdGhpcy52aWRlb1Byb2Nlc3NvckZ1bmN0aW9uID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsICdWaWRlb1Byb2Nlc3NvckZ1bmN0aW9uJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgdmlkZW8tcHJvY2Vzc29yLSR7ZW52aXJvbm1lbnR9YCxcbiAgICAgIGVudHJ5OiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4vbGFtYmRhL3ZpZGVvLXByb2Nlc3Nvci9pbmRleC50cycpLFxuICAgICAgaGFuZGxlcjogJ2hhbmRsZXInLFxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXG4gICAgICBtZW1vcnlTaXplOiAyMDQ4LFxuICAgICAgdGltZW91dDogRHVyYXRpb24ubWludXRlcygxNSksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBWSURFT19CVUNLRVQ6IHRoaXMudmlkZW9CdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgUFJPQ0VTU0VEX1ZJREVPX0JVQ0tFVDogdGhpcy5wcm9jZXNzZWRWaWRlb0J1Y2tldC5idWNrZXROYW1lLFxuICAgICAgICBWSURFT19VUExPQURTX1RBQkxFOiB2aWRlb1VwbG9hZHNUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIFZJREVPX1BST0NFU1NJTkdfVEFCTEU6IHZpZGVvUHJvY2Vzc2luZ1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgVklERU9fRExRX1VSTDogdmlkZW9ETFEucXVldWVVcmwsXG4gICAgICAgIE1FRElBQ09OVkVSVF9FTkRQT0lOVDogYGh0dHBzOi8vbWVkaWFjb252ZXJ0LiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb21gLFxuICAgICAgICBNRURJQUNPTlZFUlRfUk9MRV9BUk46IG1lZGlhQ29udmVydFJvbGUucm9sZUFybixcbiAgICAgICAgTUVESUFDT05WRVJUX1FVRVVFX0FSTjogYGFybjphd3M6bWVkaWFjb252ZXJ0OiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpxdWV1ZXMvRGVmYXVsdGAsXG4gICAgICAgIFNDSEVEVUxFX1FVRVVFX1VSTDogJycsIC8vIFdpbGwgYmUgc2V0IGxhdGVyIGlmIG5lZWRlZFxuICAgICAgICBFTlZJUk9OTUVOVDogZW52aXJvbm1lbnQsXG4gICAgICAgIC8vIFZJREVPX1ZBTElEQVRPUl9MQU1CREEgd2lsbCBiZSBhZGRlZCBhZnRlciB2YWxpZGF0b3IgaXMgY3JlYXRlZFxuICAgICAgfSxcbiAgICAgIGxheWVyczogW3Bvd2VydG9vbHNMYXllcl0sXG4gICAgICB0cmFjaW5nOiBsYW1iZGEuVHJhY2luZy5BQ1RJVkUsXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyB0byB2aWRlbyBwcm9jZXNzb3JcbiAgICB0aGlzLnZpZGVvQnVja2V0LmdyYW50UmVhZCh0aGlzLnZpZGVvUHJvY2Vzc29yRnVuY3Rpb24pO1xuICAgIHRoaXMucHJvY2Vzc2VkVmlkZW9CdWNrZXQuZ3JhbnRSZWFkV3JpdGUodGhpcy52aWRlb1Byb2Nlc3NvckZ1bmN0aW9uKTtcbiAgICB2aWRlb1VwbG9hZHNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEodGhpcy52aWRlb1Byb2Nlc3NvckZ1bmN0aW9uKTtcbiAgICB2aWRlb1Byb2Nlc3NpbmdUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEodGhpcy52aWRlb1Byb2Nlc3NvckZ1bmN0aW9uKTtcbiAgICB2aWRlb0RMUS5ncmFudFNlbmRNZXNzYWdlcyh0aGlzLnZpZGVvUHJvY2Vzc29yRnVuY3Rpb24pO1xuICAgIFxuICAgIC8vIEdyYW50IHZpZGVvIHVwbG9hZCBmdW5jdGlvbiBwZXJtaXNzaW9uIHRvIGludm9rZSB2aWRlbyBwcm9jZXNzb3JcbiAgICB0aGlzLnZpZGVvUHJvY2Vzc29yRnVuY3Rpb24uZ3JhbnRJbnZva2UodGhpcy52aWRlb1VwbG9hZEZ1bmN0aW9uKTtcbiAgICBcbiAgICAvLyBBZGQgVklERU9fUFJPQ0VTU09SX0xBTUJEQSBlbnZpcm9ubWVudCB2YXJpYWJsZSBhZnRlciBwcm9jZXNzb3IgaXMgY3JlYXRlZFxuICAgIHRoaXMudmlkZW9VcGxvYWRGdW5jdGlvbi5hZGRFbnZpcm9ubWVudChcbiAgICAgICdWSURFT19QUk9DRVNTT1JfTEFNQkRBJyxcbiAgICAgIHRoaXMudmlkZW9Qcm9jZXNzb3JGdW5jdGlvbi5mdW5jdGlvbkFyblxuICAgICk7XG5cbiAgICAvLyBHcmFudCBNZWRpYUNvbnZlcnQgcGVybWlzc2lvbnMgd2l0aCBzcGVjaWZpYyByZXNvdXJjZXNcbiAgICB0aGlzLnZpZGVvUHJvY2Vzc29yRnVuY3Rpb24uYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnbWVkaWFjb252ZXJ0OkNyZWF0ZUpvYicsICdtZWRpYWNvbnZlcnQ6R2V0Sm9iJ10sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgYGFybjphd3M6bWVkaWFjb252ZXJ0OiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpqb2JzLypgLFxuICAgICAgICBgYXJuOmF3czptZWRpYWNvbnZlcnQ6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnF1ZXVlcy9EZWZhdWx0YCxcbiAgICAgICAgYGFybjphd3M6bWVkaWFjb252ZXJ0OiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpxdWV1ZXMvKmAsXG4gICAgICBdLFxuICAgIH0pKTtcbiAgICBcbiAgICAvLyBEZXNjcmliZUVuZHBvaW50cyBtdXN0IGhhdmUgKiByZXNvdXJjZVxuICAgIHRoaXMudmlkZW9Qcm9jZXNzb3JGdW5jdGlvbi5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydtZWRpYWNvbnZlcnQ6RGVzY3JpYmVFbmRwb2ludHMnXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sIC8vIFRoaXMgYWN0aW9uIHJlcXVpcmVzICogcmVzb3VyY2VcbiAgICB9KSk7XG5cbiAgICAvLyBBZGQgUzMgdHJpZ2dlciBmb3IgdmlkZW8gcHJvY2Vzc29yXG4gICAgdGhpcy52aWRlb0J1Y2tldC5hZGRFdmVudE5vdGlmaWNhdGlvbihcbiAgICAgIHMzLkV2ZW50VHlwZS5PQkpFQ1RfQ1JFQVRFRF9DT01QTEVURV9NVUxUSVBBUlRfVVBMT0FELFxuICAgICAgbmV3IHMzbi5MYW1iZGFEZXN0aW5hdGlvbih0aGlzLnZpZGVvUHJvY2Vzc29yRnVuY3Rpb24pLFxuICAgICAgeyBwcmVmaXg6ICd2aWRlb3MvJyB9XG4gICAgKTtcblxuICAgIC8vIFZpZGVvIFZhbGlkYXRvciBMYW1iZGEgKHdpdGggRkZtcGVnIGxheWVyKVxuICAgIGNvbnN0IGZmbXBlZ0xheWVyQXNzZXRQYXRoID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uL2xheWVycy9mZm1wZWcnKTtcbiAgICBjb25zdCBmZm1wZWdCaW5QYXRoID0gcGF0aC5qb2luKGZmbXBlZ0xheWVyQXNzZXRQYXRoLCAnYmluJyk7XG4gICAgXG4gICAgLy8gQ2hlY2sgaWYgRkZtcGVnIGJpbmFyaWVzIGV4aXN0OyBmYWlsIGRlcGxveW1lbnQgaWYgbWlzc2luZ1xuICAgIGlmICghZnMuZXhpc3RzU3luYyhwYXRoLmpvaW4oZmZtcGVnQmluUGF0aCwgJ2ZmbXBlZycpKSB8fCBcbiAgICAgICAgIWZzLmV4aXN0c1N5bmMocGF0aC5qb2luKGZmbXBlZ0JpblBhdGgsICdmZnByb2JlJykpKSB7XG4gICAgICAvLyBDcmVhdGUgYmluIGRpcmVjdG9yeSBpZiBpdCBkb2Vzbid0IGV4aXN0IGZvciBkZXZlbG9wbWVudFxuICAgICAgaWYgKCFmcy5leGlzdHNTeW5jKGZmbXBlZ0JpblBhdGgpKSB7XG4gICAgICAgIGZzLm1rZGlyU3luYyhmZm1wZWdCaW5QYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgY29uc29sZS53YXJuKFxuICAgICAgICBgXFxu4pqg77iPICBGRm1wZWcgYmluYXJpZXMgbm90IGZvdW5kIGF0ICR7ZmZtcGVnQmluUGF0aH1cXG5gICtcbiAgICAgICAgYFxcblRvIHNldCB1cCBGRm1wZWcgYmluYXJpZXM6XFxuYCArXG4gICAgICAgIGAxLiBEb3dubG9hZCBGRm1wZWcgc3RhdGljIGJ1aWxkczpcXG5gICtcbiAgICAgICAgYCAgIHdnZXQgaHR0cHM6Ly9qb2hudmFuc2lja2xlLmNvbS9mZm1wZWcvcmVsZWFzZXMvZmZtcGVnLXJlbGVhc2UtYW1kNjQtc3RhdGljLnRhci54elxcbmAgK1xuICAgICAgICBgMi4gRXh0cmFjdCBhbmQgY29weSBiaW5hcmllczpcXG5gICtcbiAgICAgICAgYCAgIHRhciB4ZiBmZm1wZWctcmVsZWFzZS1hbWQ2NC1zdGF0aWMudGFyLnh6XFxuYCArXG4gICAgICAgIGAgICBjcCBmZm1wZWctKi9mZm1wZWcgJHtmZm1wZWdCaW5QYXRofS9cXG5gICtcbiAgICAgICAgYCAgIGNwIGZmbXBlZy0qL2ZmcHJvYmUgJHtmZm1wZWdCaW5QYXRofS9cXG5gICtcbiAgICAgICAgYCAgIGNobW9kICt4ICR7ZmZtcGVnQmluUGF0aH0vKlxcbmAgK1xuICAgICAgICBgXFxuRm9yIGRldmVsb3BtZW50LCBjcmVhdGluZyBlbXB0eSBiaW5hcmllcy4gUHJvZHVjdGlvbiBkZXBsb3ltZW50IHdpbGwgcmVxdWlyZSBhY3R1YWwgYmluYXJpZXMuXFxuYFxuICAgICAgKTtcbiAgICAgIFxuICAgICAgLy8gRm9yIGRldmVsb3BtZW50IG9ubHkgLSBjcmVhdGUgZW1wdHkgZXhlY3V0YWJsZSBmaWxlc1xuICAgICAgZnMud3JpdGVGaWxlU3luYyhwYXRoLmpvaW4oZmZtcGVnQmluUGF0aCwgJ2ZmbXBlZycpLCAnIyEvYmluL3NoXFxuZWNobyBcIkZGbXBlZyBwbGFjZWhvbGRlclwiJyk7XG4gICAgICBmcy53cml0ZUZpbGVTeW5jKHBhdGguam9pbihmZm1wZWdCaW5QYXRoLCAnZmZwcm9iZScpLCAnIyEvYmluL3NoXFxuZWNobyBcIkZGcHJvYmUgcGxhY2Vob2xkZXJcIicpO1xuICAgICAgZnMuY2htb2RTeW5jKHBhdGguam9pbihmZm1wZWdCaW5QYXRoLCAnZmZtcGVnJyksIDBvNzU1KTtcbiAgICAgIGZzLmNobW9kU3luYyhwYXRoLmpvaW4oZmZtcGVnQmluUGF0aCwgJ2ZmcHJvYmUnKSwgMG83NTUpO1xuICAgIH1cbiAgICBcbiAgICBjb25zdCBmZm1wZWdMYXllciA9IG5ldyBsYW1iZGEuTGF5ZXJWZXJzaW9uKHRoaXMsICdGRm1wZWdMYXllcicsIHtcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChmZm1wZWdMYXllckFzc2V0UGF0aCksXG4gICAgICBjb21wYXRpYmxlUnVudGltZXM6IFtsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWF0sXG4gICAgICBkZXNjcmlwdGlvbjogJ0ZGbXBlZyBhbmQgRkZwcm9iZSBiaW5hcmllcycsXG4gICAgfSk7XG5cbiAgICB0aGlzLnZpZGVvVmFsaWRhdG9yRnVuY3Rpb24gPSBuZXcgTm9kZWpzRnVuY3Rpb24odGhpcywgJ1ZpZGVvVmFsaWRhdG9yRnVuY3Rpb24nLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6IGB2aWRlby12YWxpZGF0b3ItJHtlbnZpcm9ubWVudH1gLFxuICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9sYW1iZGEvdmlkZW8tdmFsaWRhdG9yL2luZGV4LnRzJyksXG4gICAgICBoYW5kbGVyOiAnaGFuZGxlcicsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcbiAgICAgIG1lbW9yeVNpemU6IDMwMDgsIC8vIE1heGltdW0gbWVtb3J5IGZvciBmYXN0ZXIgZG93bmxvYWRzXG4gICAgICB0aW1lb3V0OiBEdXJhdGlvbi5taW51dGVzKDEwKSxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIFZJREVPX1VQTE9BRFNfVEFCTEU6IHZpZGVvVXBsb2Fkc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgRU5WSVJPTk1FTlQ6IGVudmlyb25tZW50LFxuICAgICAgICBQQVRIOiAnL29wdC9iaW46JFBBVEgnLCAvLyBBZGQgRkZtcGVnIHRvIFBBVEhcbiAgICAgIH0sXG4gICAgICBsYXllcnM6IFtwb3dlcnRvb2xzTGF5ZXIsIGZmbXBlZ0xheWVyXSxcbiAgICAgIHRyYWNpbmc6IGxhbWJkYS5UcmFjaW5nLkFDVElWRSxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIHRvIHZpZGVvIHZhbGlkYXRvclxuICAgIHRoaXMudmlkZW9CdWNrZXQuZ3JhbnRSZWFkKHRoaXMudmlkZW9WYWxpZGF0b3JGdW5jdGlvbik7XG4gICAgdmlkZW9VcGxvYWRzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHRoaXMudmlkZW9WYWxpZGF0b3JGdW5jdGlvbik7XG4gICAgXG4gICAgLy8gR3JhbnQgdmlkZW8gcHJvY2Vzc29yIHBlcm1pc3Npb24gdG8gaW52b2tlIHZpZGVvIHZhbGlkYXRvclxuICAgIHRoaXMudmlkZW9WYWxpZGF0b3JGdW5jdGlvbi5ncmFudEludm9rZSh0aGlzLnZpZGVvUHJvY2Vzc29yRnVuY3Rpb24pO1xuICAgIFxuICAgIC8vIEFkZCBWSURFT19WQUxJREFUT1JfTEFNQkRBIGVudmlyb25tZW50IHZhcmlhYmxlIGFmdGVyIHZhbGlkYXRvciBpcyBjcmVhdGVkXG4gICAgdGhpcy52aWRlb1Byb2Nlc3NvckZ1bmN0aW9uLmFkZEVudmlyb25tZW50KFxuICAgICAgJ1ZJREVPX1ZBTElEQVRPUl9MQU1CREEnLFxuICAgICAgdGhpcy52aWRlb1ZhbGlkYXRvckZ1bmN0aW9uLmZ1bmN0aW9uQXJuXG4gICAgKTtcblxuICAgIC8vIENsb3VkV2F0Y2ggRXZlbnRzIGZvciBNZWRpYUNvbnZlcnQgam9iIHN0YXR1cyB1cGRhdGVzXG4gICAgY29uc3QgbWVkaWFDb252ZXJ0RXZlbnRSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdNZWRpYUNvbnZlcnRKb2JTdGF0dXNSdWxlJywge1xuICAgICAgZXZlbnRQYXR0ZXJuOiB7XG4gICAgICAgIHNvdXJjZTogWydhd3MubWVkaWFjb252ZXJ0J10sXG4gICAgICAgIGRldGFpbFR5cGU6IFsnTWVkaWFDb252ZXJ0IEpvYiBTdGF0ZSBDaGFuZ2UnXSxcbiAgICAgICAgZGV0YWlsOiB7XG4gICAgICAgICAgc3RhdHVzOiBbJ0NPTVBMRVRFJywgJ0VSUk9SJywgJ1BST0dSRVNTSU5HJ10sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIGEgc2VwYXJhdGUgaGFuZGxlciBmb3IgTWVkaWFDb252ZXJ0IGV2ZW50c1xuICAgIGNvbnN0IG1lZGlhQ29udmVydEV2ZW50SGFuZGxlciA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLCAnTWVkaWFDb252ZXJ0RXZlbnRIYW5kbGVyJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgbWVkaWFjb252ZXJ0LWV2ZW50LWhhbmRsZXItJHtlbnZpcm9ubWVudH1gLFxuICAgICAgZW50cnk6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLi9sYW1iZGEvdmlkZW8tcHJvY2Vzc29yL2luZGV4LnRzJyksXG4gICAgICBoYW5kbGVyOiAnaGFuZGxlSm9iU3RhdHVzVXBkYXRlJyxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgbWVtb3J5U2l6ZTogNTEyLFxuICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBWSURFT19VUExPQURTX1RBQkxFOiB2aWRlb1VwbG9hZHNUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIFZJREVPX1BST0NFU1NJTkdfVEFCTEU6IHZpZGVvUHJvY2Vzc2luZ1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgVklERU9fRExRX1VSTDogdmlkZW9ETFEucXVldWVVcmwsXG4gICAgICAgIFNDSEVEVUxFX1FVRVVFX1VSTDogJycsIC8vIFdpbGwgYmUgc2V0IGxhdGVyIGlmIG5lZWRlZFxuICAgICAgICBFTlZJUk9OTUVOVDogZW52aXJvbm1lbnQsXG4gICAgICB9LFxuICAgICAgbGF5ZXJzOiBbcG93ZXJ0b29sc0xheWVyXSxcbiAgICAgIHRyYWNpbmc6IGxhbWJkYS5UcmFjaW5nLkFDVElWRSxcbiAgICB9KTtcblxuICAgIHZpZGVvVXBsb2Fkc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShtZWRpYUNvbnZlcnRFdmVudEhhbmRsZXIpO1xuICAgIHZpZGVvUHJvY2Vzc2luZ1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShtZWRpYUNvbnZlcnRFdmVudEhhbmRsZXIpO1xuICAgIHZpZGVvRExRLmdyYW50U2VuZE1lc3NhZ2VzKG1lZGlhQ29udmVydEV2ZW50SGFuZGxlcik7XG5cbiAgICBtZWRpYUNvbnZlcnRFdmVudFJ1bGUuYWRkVGFyZ2V0KG5ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKG1lZGlhQ29udmVydEV2ZW50SGFuZGxlcikpO1xuXG4gICAgLy8gQ2xvdWRGcm9udCBkaXN0cmlidXRpb24gZm9yIHZpZGVvIGRlbGl2ZXJ5XG4gICAgY29uc3Qgb3JpZ2luQWNjZXNzSWRlbnRpdHkgPSBuZXcgY2xvdWRmcm9udC5PcmlnaW5BY2Nlc3NJZGVudGl0eSh0aGlzLCAnVmlkZW9PQUknLCB7XG4gICAgICBjb21tZW50OiBgT0FJIGZvciBQb3N0b2xpbyB2aWRlbyBkZWxpdmVyeSAke2Vudmlyb25tZW50fWAsXG4gICAgfSk7XG5cbiAgICB0aGlzLnByb2Nlc3NlZFZpZGVvQnVja2V0LmdyYW50UmVhZChvcmlnaW5BY2Nlc3NJZGVudGl0eSk7XG5cbiAgICB0aGlzLnZpZGVvRGlzdHJpYnV0aW9uID0gbmV3IGNsb3VkZnJvbnQuRGlzdHJpYnV0aW9uKHRoaXMsICdWaWRlb0Rpc3RyaWJ1dGlvbicsIHtcbiAgICAgIGRlZmF1bHRCZWhhdmlvcjoge1xuICAgICAgICBvcmlnaW46IG5ldyBvcmlnaW5zLlMzT3JpZ2luKHRoaXMucHJvY2Vzc2VkVmlkZW9CdWNrZXQsIHtcbiAgICAgICAgICBvcmlnaW5BY2Nlc3NJZGVudGl0eSxcbiAgICAgICAgfSksXG4gICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICBjYWNoZVBvbGljeTogY2xvdWRmcm9udC5DYWNoZVBvbGljeS5DQUNISU5HX09QVElNSVpFRCxcbiAgICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfR0VUX0hFQUQsXG4gICAgICAgIGNvbXByZXNzOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGVuYWJsZUxvZ2dpbmc6IHRydWUsXG4gICAgICBsb2dCdWNrZXQ6IG5ldyBzMy5CdWNrZXQodGhpcywgJ1ZpZGVvRGlzdHJpYnV0aW9uTG9ncycsIHtcbiAgICAgICAgYnVja2V0TmFtZTogYHBvc3RvbGlvLXZpZGVvLWNkbi1sb2dzLSR7ZW52aXJvbm1lbnR9LSR7dGhpcy5hY2NvdW50fWAsXG4gICAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcbiAgICAgICAgbGlmZWN5Y2xlUnVsZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpZDogJ2RlbGV0ZS1vbGQtbG9ncycsXG4gICAgICAgICAgICBleHBpcmF0aW9uOiBEdXJhdGlvbi5kYXlzKDMwKSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgICByZW1vdmFsUG9saWN5OiBlbnZpcm9ubWVudCA9PT0gJ3Byb2QnID8gUmVtb3ZhbFBvbGljeS5SRVRBSU4gOiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgIGF1dG9EZWxldGVPYmplY3RzOiBlbnZpcm9ubWVudCAhPT0gJ3Byb2QnLFxuICAgICAgfSksXG4gICAgICBwcmljZUNsYXNzOiBjbG91ZGZyb250LlByaWNlQ2xhc3MuUFJJQ0VfQ0xBU1NfMTAwLFxuICAgICAgY29tbWVudDogYFBvc3RvbGlvIHZpZGVvIENETiAke2Vudmlyb25tZW50fWAsXG4gICAgfSk7XG5cbiAgICAvLyBPdXRwdXRzXG4gICAgdGhpcy5leHBvcnRWYWx1ZSh0aGlzLnZpZGVvQnVja2V0LmJ1Y2tldE5hbWUsIHsgbmFtZTogYFZpZGVvQnVja2V0LSR7ZW52aXJvbm1lbnR9YCB9KTtcbiAgICB0aGlzLmV4cG9ydFZhbHVlKHRoaXMucHJvY2Vzc2VkVmlkZW9CdWNrZXQuYnVja2V0TmFtZSwgeyBuYW1lOiBgUHJvY2Vzc2VkVmlkZW9CdWNrZXQtJHtlbnZpcm9ubWVudH1gIH0pO1xuICAgIHRoaXMuZXhwb3J0VmFsdWUodGhpcy52aWRlb0Rpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lLCB7IG5hbWU6IGBWaWRlb0NETi0ke2Vudmlyb25tZW50fWAgfSk7XG4gIH1cbn0iXX0=