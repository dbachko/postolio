import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { MediaConvertClient, CreateJobCommand, GetJobCommand, GetJobTemplateCommand } from '@aws-sdk/client-mediaconvert';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { S3Event } from 'aws-lambda';

// Initialize Powertools
const logger = new Logger({ serviceName: 'video-processor' });
const tracer = new Tracer({ serviceName: 'video-processor' });
const metrics = new Metrics({ namespace: 'ContentScheduler', serviceName: 'video-processor' });

// Validate required environment variables
const requiredEnvVars = [
  'VIDEO_BUCKET',
  'PROCESSED_VIDEO_BUCKET',
  'VIDEO_UPLOADS_TABLE',
  'VIDEO_PROCESSING_TABLE',
  'MEDIACONVERT_ENDPOINT',
  'MEDIACONVERT_ROLE_ARN',
  'MEDIACONVERT_QUEUE_ARN',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    const error = `Missing required environment variable: ${envVar}`;
    logger.error(error);
    throw new Error(error);
  }
}

// Initialize AWS SDK clients
const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = tracer.captureAWSv3Client(new S3Client({}));
const sqsClient = tracer.captureAWSv3Client(new SQSClient({}));

// MediaConvert client needs custom endpoint
const mediaConvertClient = new MediaConvertClient({
  endpoint: process.env.MEDIACONVERT_ENDPOINT,
  region: process.env.AWS_REGION,
});

// Platform-specific video output settings
const PLATFORM_OUTPUTS: Record<string, MediaConvertOutputSettings> = {
  instagram_reels: {
    nameModifier: '_instagram_reels',
    outputGroupSettings: {
      type: 'FILE_GROUP_SETTINGS',
      fileGroupSettings: {
        destination: 's3://${PROCESSED_VIDEO_BUCKET}/processed/instagram/',
      },
    },
    outputs: [{
      containerSettings: {
        container: 'MP4',
        mp4Settings: {
          moovPlacement: 'PROGRESSIVE_DOWNLOAD',
        },
      },
      videoDescription: {
        width: 1080,
        height: 1920,
        codecSettings: {
          codec: 'H_264',
          h264Settings: {
            rateControlMode: 'QVBR',
            qvbrSettings: {
              qvbrQualityLevel: 7,
              qvbrQualityLevelFineTune: 0,
            },
            codecLevel: 'AUTO',
            codecProfile: 'HIGH',
            maxBitrate: 5000000,
            framerateControl: 'SPECIFIED',
            framerateNumerator: 30,
            framerateDenominator: 1,
          },
        },
      },
      audioDescriptions: [{
        codecSettings: {
          codec: 'AAC',
          aacSettings: {
            audioDescriptionBroadcasterMix: 'NORMAL',
            rateControlMode: 'CBR',
            codecProfile: 'LC',
            codingMode: 'CODING_MODE_2_0',
            sampleRate: 48000,
            bitrate: 128000,
          },
        },
      }],
    }],
  },
  tiktok: {
    nameModifier: '_tiktok',
    outputGroupSettings: {
      type: 'FILE_GROUP_SETTINGS',
      fileGroupSettings: {
        destination: 's3://${PROCESSED_VIDEO_BUCKET}/processed/tiktok/',
      },
    },
    outputs: [{
      containerSettings: {
        container: 'MP4',
        mp4Settings: {
          moovPlacement: 'PROGRESSIVE_DOWNLOAD',
        },
      },
      videoDescription: {
        width: 1080,
        height: 1920,
        codecSettings: {
          codec: 'H_264',
          h264Settings: {
            rateControlMode: 'QVBR',
            qvbrSettings: {
              qvbrQualityLevel: 8,
              qvbrQualityLevelFineTune: 0,
            },
            codecLevel: 'AUTO',
            codecProfile: 'HIGH',
            maxBitrate: 8000000,
            framerateControl: 'SPECIFIED',
            framerateNumerator: 30,
            framerateDenominator: 1,
          },
        },
      },
      audioDescriptions: [{
        codecSettings: {
          codec: 'AAC',
          aacSettings: {
            audioDescriptionBroadcasterMix: 'NORMAL',
            rateControlMode: 'CBR',
            codecProfile: 'LC',
            codingMode: 'CODING_MODE_2_0',
            sampleRate: 48000,
            bitrate: 192000,
          },
        },
      }],
    }],
  },
  youtube_shorts: {
    nameModifier: '_youtube_shorts',
    outputGroupSettings: {
      type: 'FILE_GROUP_SETTINGS',
      fileGroupSettings: {
        destination: 's3://${PROCESSED_VIDEO_BUCKET}/processed/youtube/',
      },
    },
    outputs: [{
      containerSettings: {
        container: 'MP4',
        mp4Settings: {
          moovPlacement: 'PROGRESSIVE_DOWNLOAD',
        },
      },
      videoDescription: {
        width: 1080,
        height: 1920,
        codecSettings: {
          codec: 'H_264',
          h264Settings: {
            rateControlMode: 'QVBR',
            qvbrSettings: {
              qvbrQualityLevel: 9,
              qvbrQualityLevelFineTune: 0,
            },
            codecLevel: 'AUTO',
            codecProfile: 'HIGH',
            maxBitrate: 10000000,
            framerateControl: 'SPECIFIED',
            framerateNumerator: 30,
            framerateDenominator: 1,
          },
        },
      },
      audioDescriptions: [{
        codecSettings: {
          codec: 'AAC',
          aacSettings: {
            audioDescriptionBroadcasterMix: 'NORMAL',
            rateControlMode: 'CBR',
            codecProfile: 'LC',
            codingMode: 'CODING_MODE_2_0',
            sampleRate: 48000,
            bitrate: 256000,
          },
        },
      }],
    }],
  },
  facebook: {
    nameModifier: '_facebook',
    outputGroupSettings: {
      type: 'FILE_GROUP_SETTINGS',
      fileGroupSettings: {
        destination: 's3://${PROCESSED_VIDEO_BUCKET}/processed/facebook/',
      },
    },
    outputs: [{
      containerSettings: {
        container: 'MP4',
        mp4Settings: {
          moovPlacement: 'PROGRESSIVE_DOWNLOAD',
        },
      },
      videoDescription: {
        width: 1920,
        height: 1080,
        codecSettings: {
          codec: 'H_264',
          h264Settings: {
            rateControlMode: 'QVBR',
            qvbrSettings: {
              qvbrQualityLevel: 8,
              qvbrQualityLevelFineTune: 0,
            },
            codecLevel: 'AUTO',
            codecProfile: 'HIGH',
            maxBitrate: 8000000,
            framerateControl: 'SPECIFIED',
            framerateNumerator: 30,
            framerateDenominator: 1,
          },
        },
      },
      audioDescriptions: [{
        codecSettings: {
          codec: 'AAC',
          aacSettings: {
            audioDescriptionBroadcasterMix: 'NORMAL',
            rateControlMode: 'CBR',
            codecProfile: 'LC',
            codingMode: 'CODING_MODE_2_0',
            sampleRate: 48000,
            bitrate: 192000,
          },
        },
      }],
    }],
  },
  linkedin: {
    nameModifier: '_linkedin',
    outputGroupSettings: {
      type: 'FILE_GROUP_SETTINGS',
      fileGroupSettings: {
        destination: 's3://${PROCESSED_VIDEO_BUCKET}/processed/linkedin/',
      },
    },
    outputs: [{
      containerSettings: {
        container: 'MP4',
        mp4Settings: {
          moovPlacement: 'PROGRESSIVE_DOWNLOAD',
        },
      },
      videoDescription: {
        width: 1920,
        height: 1080,
        codecSettings: {
          codec: 'H_264',
          h264Settings: {
            rateControlMode: 'QVBR',
            qvbrSettings: {
              qvbrQualityLevel: 9,
              qvbrQualityLevelFineTune: 0,
            },
            codecLevel: 'AUTO',
            codecProfile: 'HIGH',
            maxBitrate: 10000000,
            framerateControl: 'SPECIFIED',
            framerateNumerator: 30,
            framerateDenominator: 1,
          },
        },
      },
      audioDescriptions: [{
        codecSettings: {
          codec: 'AAC',
          aacSettings: {
            audioDescriptionBroadcasterMix: 'NORMAL',
            rateControlMode: 'CBR',
            codecProfile: 'LC',
            codingMode: 'CODING_MODE_2_0',
            sampleRate: 48000,
            bitrate: 256000,
          },
        },
      }],
    }],
  },
};

interface MediaConvertOutputSettings {
  nameModifier: string;
  outputGroupSettings: any;
  outputs: any[];
}

interface VideoProcessingRequest {
  videoId: string;
  inputS3Key: string;
  platform: string;
  brandId: string;
  contentId: string;
}

export const handler = async (event: S3Event): Promise<void> => {
  logger.info('Processing video upload event', { recordCount: event.Records.length });

  for (const record of event.Records) {
    try {
      await processVideoUpload(record);
      metrics.addMetric('VideoProcessed', MetricUnit.Count, 1);
    } catch (error) {
      logger.error('Failed to process video', error as Error);
      metrics.addMetric('VideoProcessingError', MetricUnit.Count, 1);
      
      // Send to DLQ for manual review
      await sendToDeadLetterQueue(record, error as Error);
    }
  }

  metrics.publishStoredMetrics();
};

async function processVideoUpload(record: any): Promise<void> {
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
  
  logger.info('Processing uploaded video', { bucket, key });

  // Extract video ID from S3 key (format: videos/{brandId}/{videoId}/{fileName})
  const keyParts = key.split('/');
  const videoId = keyParts[2];
  
  if (!videoId) {
    throw new Error(`Invalid S3 key format: ${key}`);
  }

  // Get video metadata from DynamoDB
  const videoMetadata = await getVideoMetadata(videoId);
  if (!videoMetadata) {
    throw new Error(`Video metadata not found: ${videoId}`);
  }

  // Get file metadata from S3
  const s3Metadata = await getS3ObjectMetadata(bucket, key);
  
  // Validate video before processing
  const validation = await validateVideo(bucket, key, s3Metadata, videoMetadata.platform);
  if (!validation.valid) {
    await updateVideoStatus(videoId, 'validation_failed', validation.errors?.join(', '));
    throw new Error(`Video validation failed: ${validation.errors?.join(', ')}`);
  }

  // Create MediaConvert job
  const jobId = await createMediaConvertJob({
    videoId,
    inputS3Key: `s3://${bucket}/${key}`,
    platform: videoMetadata.platform,
    brandId: videoMetadata.brandId,
    contentId: videoMetadata.contentId,
  });

  // Update video status
  await updateVideoStatus(videoId, 'processing', undefined, { mediaConvertJobId: jobId });
  
  logger.info('MediaConvert job created', { videoId, jobId });
}

async function getVideoMetadata(videoId: string): Promise<any> {
  const result = await docClient.send(new GetCommand({
    TableName: process.env.VIDEO_UPLOADS_TABLE!,
    Key: {
      pk: `VIDEO#${videoId}`,
      sk: 'UPLOAD_METADATA',
    },
  }));

  return result.Item;
}

async function getS3ObjectMetadata(bucket: string, key: string): Promise<any> {
  const result = await s3Client.send(new HeadObjectCommand({
    Bucket: bucket,
    Key: key,
  }));

  return {
    contentType: result.ContentType,
    contentLength: result.ContentLength,
    metadata: result.Metadata,
  };
}

async function validateVideo(
  bucket: string, 
  key: string, 
  s3Metadata: any, 
  platform: string
): Promise<{ valid: boolean; errors?: string[] }> {
  const errors: string[] = [];

  // Basic validation
  if (!s3Metadata.contentType?.startsWith('video/')) {
    errors.push(`Invalid content type: ${s3Metadata.contentType}`);
  }

  // Platform-specific size limits
  const platformLimits: Record<string, number> = {
    instagram: 1024 * 1024 * 1024, // 1GB
    tiktok: 4 * 1024 * 1024 * 1024, // 4GB
    youtube: 256 * 1024 * 1024, // 256MB for Shorts
    facebook: 4 * 1024 * 1024 * 1024, // 4GB
    linkedin: 5 * 1024 * 1024 * 1024, // 5GB
  };

  const maxSize = platformLimits[platform.toLowerCase()];
  if (maxSize && s3Metadata.contentLength > maxSize) {
    errors.push(`File size exceeds ${platform} limit: ${s3Metadata.contentLength} > ${maxSize}`);
  }

  // TODO: Use MediaInfo or FFprobe Lambda Layer to validate:
  // - Video duration
  // - Video codec
  // - Audio codec
  // - Resolution
  // - Frame rate
  // - Aspect ratio

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

async function createMediaConvertJob(request: VideoProcessingRequest): Promise<string> {
  const { videoId, inputS3Key, platform, brandId, contentId } = request;

  // Get platform-specific output settings
  const outputSettings = PLATFORM_OUTPUTS[platform.toLowerCase()] || PLATFORM_OUTPUTS.facebook;
  
  // Replace bucket placeholder with actual bucket name
  const destination = outputSettings.outputGroupSettings.fileGroupSettings.destination
    .replace('${PROCESSED_VIDEO_BUCKET}', process.env.PROCESSED_VIDEO_BUCKET!);

  // Create MediaConvert job
  const jobSettings = {
    Role: process.env.MEDIACONVERT_ROLE_ARN!,
    Settings: {
      Inputs: [{
        FileInput: inputS3Key,
        VideoSelector: {
          ColorSpace: 'FOLLOW',
        },
        AudioSelectors: {
          'Audio Selector 1': {
            DefaultSelection: 'DEFAULT',
          },
        },
      }],
      OutputGroups: [{
        Name: `${platform}_output`,
        OutputGroupSettings: {
          ...outputSettings.outputGroupSettings,
          FileGroupSettings: {
            Destination: `${destination}${brandId}/${videoId}/`,
          },
        },
        Outputs: outputSettings.outputs,
      }],
      TimecodeConfig: {
        Source: 'ZEROBASED',
      },
    },
    UserMetadata: {
      videoId,
      platform,
      brandId,
      contentId,
    },
    StatusUpdateInterval: 'SECONDS_30',
    Queue: process.env.MEDIACONVERT_QUEUE_ARN,
  };

  // Add thumbnail generation output
  jobSettings.Settings.OutputGroups.push({
    Name: 'Thumbnails',
    OutputGroupSettings: {
      Type: 'FILE_GROUP_SETTINGS',
      FileGroupSettings: {
        Destination: `s3://${process.env.PROCESSED_VIDEO_BUCKET}/thumbnails/${brandId}/${videoId}/`,
      },
    },
    Outputs: [{
      ContainerSettings: {
        Container: 'RAW',
      },
      VideoDescription: {
        Width: 1280,
        Height: 720,
        CodecSettings: {
          Codec: 'FRAME_CAPTURE',
          FrameCaptureSettings: {
            FramerateNumerator: 1,
            FramerateDenominator: 5, // Capture frame every 5 seconds
            MaxCaptures: 10,
            Quality: 80,
          },
        },
      },
    }],
  });

  const command = new CreateJobCommand(jobSettings);
  const response = await mediaConvertClient.send(command);

  if (!response.Job?.Id) {
    throw new Error('Failed to create MediaConvert job');
  }

  // Store job information
  await storeJobInfo(videoId, response.Job.Id, jobSettings);

  return response.Job.Id;
}

async function storeJobInfo(videoId: string, jobId: string, jobSettings: any): Promise<void> {
  await docClient.send(new PutCommand({
    TableName: process.env.VIDEO_PROCESSING_TABLE!,
    Item: {
      pk: `JOB#${jobId}`,
      sk: 'METADATA',
      videoId,
      jobId,
      status: 'SUBMITTED',
      jobSettings,
      createdAt: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // 30 days
    },
  }));
}

async function updateVideoStatus(
  videoId: string, 
  status: string, 
  error?: string,
  additionalData?: Record<string, any>
): Promise<void> {
  let updateExpression = 'SET #status = :status, #updatedAt = :updatedAt';
  const expressionAttributeNames: any = {
    '#status': 'processingStatus',
    '#updatedAt': 'updatedAt',
  };
  const expressionAttributeValues: any = {
    ':status': status,
    ':updatedAt': new Date().toISOString(),
  };

  if (error) {
    updateExpression += ', #error = :error';
    expressionAttributeNames['#error'] = 'processingError';
    expressionAttributeValues[':error'] = error;
  }

  if (additionalData) {
    Object.entries(additionalData).forEach(([key, value]) => {
      updateExpression += `, #${key} = :${key}`;
      expressionAttributeNames[`#${key}`] = key;
      expressionAttributeValues[`:${key}`] = value;
    });
  }

  await docClient.send(new UpdateCommand({
    TableName: process.env.VIDEO_UPLOADS_TABLE!,
    Key: {
      pk: `VIDEO#${videoId}`,
      sk: 'UPLOAD_METADATA',
    },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }));
}

async function sendToDeadLetterQueue(record: any, error: Error): Promise<void> {
  if (!process.env.VIDEO_DLQ_URL) {
    logger.warn('No DLQ configured for video processing failures');
    return;
  }

  await sqsClient.send(new SendMessageCommand({
    QueueUrl: process.env.VIDEO_DLQ_URL,
    MessageBody: JSON.stringify({
      record,
      error: {
        message: error.message,
        stack: error.stack,
      },
      timestamp: new Date().toISOString(),
    }),
  }));
}

// Handler for MediaConvert job status updates (via CloudWatch Events)
export const handleJobStatusUpdate = async (event: any): Promise<void> => {
  const { detail } = event;
  const { jobId, status, userMetadata } = detail;

  logger.info('MediaConvert job status update', { jobId, status });

  const { videoId } = userMetadata;

  switch (status) {
    case 'COMPLETE':
      await handleJobComplete(jobId, videoId, detail);
      metrics.addMetric('VideoTranscodingComplete', MetricUnit.Count, 1);
      break;
    case 'ERROR':
      await handleJobError(jobId, videoId, detail);
      metrics.addMetric('VideoTranscodingError', MetricUnit.Count, 1);
      break;
    case 'PROGRESSING':
      await updateVideoStatus(videoId, 'processing', undefined, { 
        progress: detail.jobProgress?.jobPercentComplete 
      });
      break;
  }

  metrics.publishStoredMetrics();
};

async function handleJobComplete(jobId: string, videoId: string, detail: any): Promise<void> {
  // Extract output file locations from job detail
  const outputs = detail.outputGroupDetails?.[0]?.outputDetails || [];
  const thumbnails = detail.outputGroupDetails?.[1]?.outputDetails || [];

  const processedVideoUrl = outputs[0]?.outputFilePaths?.[0];
  const thumbnailUrls = thumbnails.map((t: any) => t.outputFilePaths?.[0]).filter(Boolean);

  // Update video status with processed URLs
  await updateVideoStatus(videoId, 'processed', undefined, {
    processedVideoUrl,
    thumbnailUrls: thumbnailUrls.join(','),
    processedAt: new Date().toISOString(),
  });

  // Notify schedule management that video is ready
  await notifyVideoReady(videoId, processedVideoUrl, thumbnailUrls);

  logger.info('Video processing complete', { videoId, processedVideoUrl });
}

async function handleJobError(jobId: string, videoId: string, detail: any): Promise<void> {
  const errorMessage = detail.errorMessage || 'Unknown MediaConvert error';
  
  await updateVideoStatus(videoId, 'processing_failed', errorMessage);
  
  logger.error('Video processing failed', { videoId, jobId, error: errorMessage });
  
  // Send to DLQ for manual review
  await sendToDeadLetterQueue({ jobId, videoId }, new Error(errorMessage));
}

async function notifyVideoReady(videoId: string, videoUrl: string, thumbnailUrls: string[]): Promise<void> {
  // Send message to schedule management queue
  if (process.env.SCHEDULE_QUEUE_URL) {
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: process.env.SCHEDULE_QUEUE_URL,
      MessageBody: JSON.stringify({
        type: 'VIDEO_READY',
        videoId,
        videoUrl,
        thumbnailUrls,
        timestamp: new Date().toISOString(),
      }),
    }));
  }
}