import { Stack, StackProps, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import * as fs from 'fs';

export interface VideoProcessingStackProps extends StackProps {
  environment: string;
  schedulesTable: dynamodb.Table;
  powertoolsLayer: lambda.LayerVersion;
  mainAppApiUrl: string;
  internalApiSecret: string;
}

export class VideoProcessingStack extends Stack {
  public readonly videoBucket: s3.Bucket;
  public readonly processedVideoBucket: s3.Bucket;
  public readonly videoUploadFunction: NodejsFunction;
  public readonly videoProcessorFunction: NodejsFunction;
  public readonly videoValidatorFunction: NodejsFunction;
  public readonly videoDistribution: cloudfront.Distribution;

  private getAllowedOrigins(environment: string): string[] {
    switch (environment) {
      case 'prod':
        return ['https://postolio.example', 'https://postolio.example'];
      case 'staging':
        return ['https://postolio.example'];
      default:
        return ['http://localhost:3000', 'http://localhost:5173'];
    }
  }

  constructor(scope: Construct, id: string, props: VideoProcessingStackProps) {
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
          expiration: Duration.days(90),
        },
      ],
      removalPolicy: environment === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: environment !== 'prod',
    });

    // S3 Buckets for video storage with access logging
    this.videoBucket = new s3.Bucket(this, 'VideoBucket', {
      bucketName: `postolio-videos-${environment}-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: environment === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: environment !== 'prod',
      serverAccessLogsBucket: logBucket,
      serverAccessLogsPrefix: 'video-bucket/',
      lifecycleRules: [
        {
          id: 'delete-incomplete-uploads',
          abortIncompleteMultipartUploadAfter: Duration.days(7),
        },
        {
          id: 'transition-old-videos',
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: Duration.days(90),
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
      removalPolicy: environment === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: environment !== 'prod',
      serverAccessLogsBucket: logBucket,
      serverAccessLogsPrefix: 'processed-video-bucket/',
      lifecycleRules: [
        {
          id: 'delete-old-processed-videos',
          expiration: Duration.days(180),
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
      removalPolicy: environment === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    const videoProcessingTable = new dynamodb.Table(this, 'VideoProcessingTable', {
      tableName: `VideoProcessing-${environment}`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: environment === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // SQS Dead Letter Queue for failed video processing
    const videoDLQ = new sqs.Queue(this, 'VideoProcessingDLQ', {
      queueName: `VideoProcessingDLQ-${environment}`,
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.KMS_MANAGED,
    });

    // IAM Role for MediaConvert with least privilege
    const mediaConvertRole = new iam.Role(this, 'MediaConvertRole', {
      assumedBy: new iam.ServicePrincipal('mediaconvert.amazonaws.com'),
      description: `MediaConvert role for video processing in ${environment}`,
    });

    // Add specific S3 permissions for MediaConvert
    mediaConvertRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:GetObjectVersion'],
        resources: [this.videoBucket.arnForObjects('*')],
      })
    );

    mediaConvertRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject', 's3:PutObjectAcl'],
        resources: [this.processedVideoBucket.arnForObjects('*')],
      })
    );

    // Video Upload Lambda
    this.videoUploadFunction = new NodejsFunction(this, 'VideoUploadFunction', {
      functionName: `postolio-${environment}-video-upload`,
      entry: path.join(__dirname, '../lambda/video-upload/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 1024,
      timeout: Duration.minutes(5),
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
    this.videoProcessorFunction = new NodejsFunction(this, 'VideoProcessorFunction', {
      functionName: `postolio-${environment}-video-processor`,
      entry: path.join(__dirname, '../lambda/video-processor/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 2048,
      timeout: Duration.minutes(15),
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
    this.videoUploadFunction.addEnvironment(
      'VIDEO_PROCESSOR_LAMBDA',
      this.videoProcessorFunction.functionArn
    );

    // Grant MediaConvert permissions with specific resources
    this.videoProcessorFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['mediaconvert:CreateJob', 'mediaconvert:GetJob'],
        resources: [
          `arn:aws:mediaconvert:${this.region}:${this.account}:jobs/*`,
          `arn:aws:mediaconvert:${this.region}:${this.account}:queues/Default`,
          `arn:aws:mediaconvert:${this.region}:${this.account}:queues/*`,
        ],
      })
    );

    // DescribeEndpoints must have * resource
    this.videoProcessorFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['mediaconvert:DescribeEndpoints'],
        resources: ['*'], // This action requires * resource
      })
    );

    // Add S3 trigger for video processor
    this.videoBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED_COMPLETE_MULTIPART_UPLOAD,
      new s3n.LambdaDestination(this.videoProcessorFunction),
      { prefix: 'videos/' }
    );

    // Video Validator Lambda (with FFmpeg layer)
    const ffmpegLayerAssetPath = path.join(__dirname, '../layers/ffmpeg');
    const ffmpegBinPath = path.join(ffmpegLayerAssetPath, 'bin');

    // Check if FFmpeg binaries exist; fail deployment if missing
    if (
      !fs.existsSync(path.join(ffmpegBinPath, 'ffmpeg')) ||
      !fs.existsSync(path.join(ffmpegBinPath, 'ffprobe'))
    ) {
      // Create bin directory if it doesn't exist for development
      if (!fs.existsSync(ffmpegBinPath)) {
        fs.mkdirSync(ffmpegBinPath, { recursive: true });
      }

      console.warn(
        `\n⚠️  FFmpeg binaries not found at ${ffmpegBinPath}\n` +
          `\nTo set up FFmpeg binaries:\n` +
          `1. Download FFmpeg static builds:\n` +
          `   wget https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz\n` +
          `2. Extract and copy binaries:\n` +
          `   tar xf ffmpeg-release-amd64-static.tar.xz\n` +
          `   cp ffmpeg-*/ffmpeg ${ffmpegBinPath}/\n` +
          `   cp ffmpeg-*/ffprobe ${ffmpegBinPath}/\n` +
          `   chmod +x ${ffmpegBinPath}/*\n` +
          `\nFor development, creating empty binaries. Production deployment will require actual binaries.\n`
      );

      // For development only - create empty executable files
      fs.writeFileSync(path.join(ffmpegBinPath, 'ffmpeg'), '#!/bin/sh\necho "FFmpeg placeholder"');
      fs.writeFileSync(
        path.join(ffmpegBinPath, 'ffprobe'),
        '#!/bin/sh\necho "FFprobe placeholder"'
      );
      fs.chmodSync(path.join(ffmpegBinPath, 'ffmpeg'), 0o755);
      fs.chmodSync(path.join(ffmpegBinPath, 'ffprobe'), 0o755);
    }

    const ffmpegLayer = new lambda.LayerVersion(this, 'FFmpegLayer', {
      code: lambda.Code.fromAsset(ffmpegLayerAssetPath),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: 'FFmpeg and FFprobe binaries',
    });

    this.videoValidatorFunction = new NodejsFunction(this, 'VideoValidatorFunction', {
      functionName: `postolio-${environment}-video-validator`,
      entry: path.join(__dirname, '../lambda/video-validator/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 3008, // Maximum memory for faster downloads
      timeout: Duration.minutes(10),
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
    this.videoProcessorFunction.addEnvironment(
      'VIDEO_VALIDATOR_LAMBDA',
      this.videoValidatorFunction.functionArn
    );

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
    const mediaConvertEventHandler = new NodejsFunction(this, 'MediaConvertEventHandler', {
      functionName: `postolio-${environment}-video-mediaconvert-handler`,
      entry: path.join(__dirname, '../lambda/video-processor/index.ts'),
      handler: 'handleJobStatusUpdate',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: Duration.seconds(30),
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
            expiration: Duration.days(30),
          },
        ],
        removalPolicy: environment === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
        autoDeleteObjects: environment !== 'prod',
      }),
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      comment: `Postolio video CDN ${environment}`,
    });

    // Outputs
    this.exportValue(this.videoBucket.bucketName, {
      name: `VideoBucket-${environment}`,
    });
    this.exportValue(this.processedVideoBucket.bucketName, {
      name: `ProcessedVideoBucket-${environment}`,
    });
    this.exportValue(this.videoDistribution.distributionDomainName, {
      name: `VideoCDN-${environment}`,
    });
  }
}
