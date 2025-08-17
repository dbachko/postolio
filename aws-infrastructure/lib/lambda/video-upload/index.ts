import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { randomUUID } from 'crypto';

// Initialize Powertools
const logger = new Logger({ serviceName: 'video-upload' });
const tracer = new Tracer({ serviceName: 'video-upload' });
const metrics = new Metrics({ namespace: 'ContentScheduler', serviceName: 'video-upload' });

// Validate required environment variables at startup
const requiredEnvVars = ['VIDEO_BUCKET', 'VIDEO_UPLOADS_TABLE'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    const error = `Missing required environment variable: ${envVar}`;
    logger.error(error);
    throw new Error(error);
  }
}

// Initialize AWS SDK clients
const s3Client = tracer.captureAWSv3Client(new S3Client({}));
const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const lambdaClient = tracer.captureAWSv3Client(new LambdaClient({}));

// Constants
const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024; // 4GB
const MIN_PART_SIZE = 5 * 1024 * 1024; // 5MB minimum part size for multipart upload
const PRESIGNED_URL_EXPIRY = 3600; // 1 hour

// Supported video formats by platform
const PLATFORM_VIDEO_FORMATS: Record<string, VideoRequirements> = {
  instagram: {
    formats: ['mp4', 'mov'],
    maxDuration: 90, // seconds for Reels
    maxSize: 1024 * 1024 * 1024, // 1GB
    aspectRatio: '9:16',
    resolution: { width: 1080, height: 1920 }
  },
  tiktok: {
    formats: ['mp4', 'mov', 'mpeg', 'avi'],
    maxDuration: 600, // 10 minutes
    maxSize: 4 * 1024 * 1024 * 1024, // 4GB
    aspectRatio: '9:16',
    resolution: { width: 1080, height: 1920 }
  },
  youtube: {
    formats: ['mp4', 'mov', 'avi', 'wmv', 'flv', 'mkv'],
    maxDuration: 60, // 60 seconds for Shorts
    maxSize: 256 * 1024 * 1024, // 256MB for Shorts
    aspectRatio: '9:16',
    resolution: { width: 1080, height: 1920 }
  },
  facebook: {
    formats: ['mp4', 'mov'],
    maxDuration: 240, // 4 minutes for feed
    maxSize: 4 * 1024 * 1024 * 1024, // 4GB
    aspectRatio: 'flexible',
    resolution: { width: 1920, height: 1080 }
  },
  linkedin: {
    formats: ['mp4', 'mov', 'avi'],
    maxDuration: 600, // 10 minutes
    maxSize: 5 * 1024 * 1024 * 1024, // 5GB
    aspectRatio: 'flexible',
    resolution: { width: 1920, height: 1080 }
  }
};

interface VideoRequirements {
  formats: string[];
  maxDuration: number;
  maxSize: number;
  aspectRatio: string;
  resolution: { width: number; height: number };
}

interface VideoUploadRequest {
  brandId: string;
  contentId: string;
  platform: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  metadata?: Record<string, string>;
}

interface MultipartUploadResponse {
  uploadId: string;
  videoId: string;
  urls: Array<{
    partNumber: number;
    url: string;
  }>;
}

// CORS headers helper
function addCorsHeaders(response: APIGatewayProxyResult): APIGatewayProxyResult {
  return {
    ...response,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...response.headers,
    },
  };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logger.addPersistentLogAttributes({
    requestId: event.requestContext.requestId,
    method: event.httpMethod,
    path: event.path,
  });

  logger.info('Processing video upload request', { event });

  try {
    const { httpMethod, path, body } = event;

    // Handle CORS preflight
    if (httpMethod === 'OPTIONS') {
      return addCorsHeaders({
        statusCode: 200,
        body: '',
      });
    }

    let result: APIGatewayProxyResult;

    if (path.includes('/initiate')) {
      result = await initiateMultipartUpload(JSON.parse(body || '{}'));
      metrics.addMetric('VideoUploadInitiated', MetricUnit.Count, 1);
    } else if (path.includes('/complete')) {
      result = await completeMultipartUpload(JSON.parse(body || '{}'));
      metrics.addMetric('VideoUploadCompleted', MetricUnit.Count, 1);
    } else if (path.includes('/abort')) {
      result = await abortMultipartUpload(JSON.parse(body || '{}'));
      metrics.addMetric('VideoUploadAborted', MetricUnit.Count, 1);
    } else if (path.includes('/presigned-url')) {
      result = await getPresignedUrl(JSON.parse(body || '{}'));
      metrics.addMetric('PresignedUrlGenerated', MetricUnit.Count, 1);
    } else {
      result = {
        statusCode: 404,
        body: JSON.stringify({ error: 'Endpoint not found' }),
      };
    }

    metrics.publishStoredMetrics();
    return addCorsHeaders(result);
  } catch (error) {
    logger.error('Error processing video upload request', error as Error);
    metrics.addMetric('VideoUploadError', MetricUnit.Count, 1);
    metrics.publishStoredMetrics();

    return addCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    });
  }
};

// Utility function to sanitize file names
function sanitizeFileName(fileName: string): string {
  // Remove null bytes, control characters, path traversal attempts, and dangerous characters
  return fileName
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove null bytes and control characters
    .replace(/\.\./g, '') // Remove path traversal
    .replace(/[\/\\]/g, '_') // Replace directory separators
    .replace(/[^a-zA-Z0-9._-]/g, '_') // Keep only safe characters
    .substring(0, 255); // Limit length
}

async function initiateMultipartUpload(request: VideoUploadRequest): Promise<APIGatewayProxyResult> {
  try {
    // Validate request
    const validation = validateUploadRequest(request);
    if (!validation.valid) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Validation failed',
          errors: validation.errors,
        }),
      };
    }

    const videoId = `VID_${Date.now()}_${randomUUID()}`;
    const sanitizedFileName = sanitizeFileName(request.fileName);
    const key = `videos/${request.brandId}/${videoId}/${sanitizedFileName}`;

    // Initiate multipart upload with S3
    const multipartUpload = await s3Client.send(new CreateMultipartUploadCommand({
      Bucket: process.env.VIDEO_BUCKET!,
      Key: key,
      ContentType: request.mimeType,
      Metadata: {
        brandId: request.brandId,
        contentId: request.contentId,
        platform: request.platform,
        videoId: videoId,
        ...request.metadata,
      },
      ServerSideEncryption: 'AES256',
      StorageClass: 'INTELLIGENT_TIERING',
    }));

    // Calculate number of parts
    const partSize = Math.max(MIN_PART_SIZE, Math.ceil(request.fileSize / 10000)); // Max 10,000 parts
    const numParts = Math.ceil(request.fileSize / partSize);

    // Generate presigned URLs for each part
    const urls = [];
    for (let partNumber = 1; partNumber <= numParts; partNumber++) {
      const uploadPartCommand = new UploadPartCommand({
        Bucket: process.env.VIDEO_BUCKET!,
        Key: key,
        UploadId: multipartUpload.UploadId,
        PartNumber: partNumber,
      });

      const presignedUrl = await getSignedUrl(s3Client, uploadPartCommand, { 
        expiresIn: PRESIGNED_URL_EXPIRY 
      });

      urls.push({
        partNumber,
        url: presignedUrl,
      });
    }

    // Store upload metadata in DynamoDB
    await docClient.send(new PutCommand({
      TableName: process.env.VIDEO_UPLOADS_TABLE!,
      Item: {
        pk: `VIDEO#${videoId}`,
        sk: 'UPLOAD_METADATA',
        videoId,
        uploadId: multipartUpload.UploadId,
        brandId: request.brandId,
        contentId: request.contentId,
        platform: request.platform,
        fileName: request.fileName,
        fileSize: request.fileSize,
        mimeType: request.mimeType,
        s3Key: key,
        status: 'uploading',
        partSize,
        totalParts: numParts,
        uploadedParts: [],
        createdAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
      },
    }));

    logger.info('Multipart upload initiated', { 
      videoId, 
      uploadId: multipartUpload.UploadId,
      numParts 
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        uploadId: multipartUpload.UploadId!,
        videoId,
        partSize,
        totalParts: numParts,
        urls,
      }),
    };
  } catch (error) {
    logger.error('Failed to initiate multipart upload', error as Error);
    throw error;
  }
}

async function completeMultipartUpload(request: any): Promise<APIGatewayProxyResult> {
  try {
    const { videoId, uploadId, parts } = request;

    // Get upload metadata from DynamoDB
    const uploadData = await docClient.send(new GetCommand({
      TableName: process.env.VIDEO_UPLOADS_TABLE!,
      Key: {
        pk: `VIDEO#${videoId}`,
        sk: 'UPLOAD_METADATA',
      },
    }));

    if (!uploadData.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Upload not found' }),
      };
    }

    // Complete the multipart upload
    const completeCommand = new CompleteMultipartUploadCommand({
      Bucket: process.env.VIDEO_BUCKET!,
      Key: uploadData.Item.s3Key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((part: any) => ({
          ETag: part.etag,
          PartNumber: part.partNumber,
        })),
      },
    });

    const result = await s3Client.send(completeCommand);

    // Update status in DynamoDB
    await docClient.send(new UpdateCommand({
      TableName: process.env.VIDEO_UPLOADS_TABLE!,
      Key: {
        pk: `VIDEO#${videoId}`,
        sk: 'UPLOAD_METADATA',
      },
      UpdateExpression: 'SET #status = :status, #location = :location, #completedAt = :completedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#location': 'location',
        '#completedAt': 'completedAt',
      },
      ExpressionAttributeValues: {
        ':status': 'uploaded',
        ':location': result.Location,
        ':completedAt': new Date().toISOString(),
      },
    }));

    // Trigger video processing
    await triggerVideoProcessing(videoId, uploadData.Item);

    logger.info('Multipart upload completed', { videoId, location: result.Location });

    return {
      statusCode: 200,
      body: JSON.stringify({
        videoId,
        location: result.Location,
        message: 'Upload completed successfully',
      }),
    };
  } catch (error) {
    logger.error('Failed to complete multipart upload', error as Error);
    throw error;
  }
}

async function abortMultipartUpload(request: any): Promise<APIGatewayProxyResult> {
  try {
    const { videoId, uploadId } = request;

    // Get upload metadata
    const uploadData = await docClient.send(new GetCommand({
      TableName: process.env.VIDEO_UPLOADS_TABLE!,
      Key: {
        pk: `VIDEO#${videoId}`,
        sk: 'UPLOAD_METADATA',
      },
    }));

    if (!uploadData.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Upload not found' }),
      };
    }

    // Abort the multipart upload
    await s3Client.send(new AbortMultipartUploadCommand({
      Bucket: process.env.VIDEO_BUCKET!,
      Key: uploadData.Item.s3Key,
      UploadId: uploadId,
    }));

    // Update status in DynamoDB
    await docClient.send(new UpdateCommand({
      TableName: process.env.VIDEO_UPLOADS_TABLE!,
      Key: {
        pk: `VIDEO#${videoId}`,
        sk: 'UPLOAD_METADATA',
      },
      UpdateExpression: 'SET #status = :status, #abortedAt = :abortedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#abortedAt': 'abortedAt',
      },
      ExpressionAttributeValues: {
        ':status': 'aborted',
        ':abortedAt': new Date().toISOString(),
      },
    }));

    logger.info('Multipart upload aborted', { videoId, uploadId });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Upload aborted successfully',
      }),
    };
  } catch (error) {
    logger.error('Failed to abort multipart upload', error as Error);
    throw error;
  }
}

async function getPresignedUrl(request: any): Promise<APIGatewayProxyResult> {
  try {
    const { videoId } = request;

    // Get video metadata
    const videoData = await docClient.send(new GetCommand({
      TableName: process.env.VIDEO_UPLOADS_TABLE!,
      Key: {
        pk: `VIDEO#${videoId}`,
        sk: 'UPLOAD_METADATA',
      },
    }));

    if (!videoData.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Video not found' }),
      };
    }

    // Generate presigned URL for viewing
    const getCommand = new GetObjectCommand({
      Bucket: process.env.VIDEO_BUCKET!,
      Key: videoData.Item.s3Key,
    });

    const presignedUrl = await getSignedUrl(s3Client, getCommand, {
      expiresIn: 3600, // 1 hour
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        url: presignedUrl,
        expiresIn: 3600,
      }),
    };
  } catch (error) {
    logger.error('Failed to generate presigned URL', error as Error);
    throw error;
  }
}

function validateUploadRequest(request: VideoUploadRequest): { valid: boolean; errors?: string[] } {
  const errors: string[] = [];

  // Required fields
  if (!request.brandId) errors.push('brandId is required');
  if (!request.contentId) errors.push('contentId is required');
  if (!request.platform) errors.push('platform is required');
  if (!request.fileName) errors.push('fileName is required');
  if (!request.fileSize) errors.push('fileSize is required');
  if (!request.mimeType) errors.push('mimeType is required');

  // File size validation
  if (request.fileSize > MAX_FILE_SIZE) {
    errors.push(`File size exceeds maximum of ${MAX_FILE_SIZE / (1024 * 1024 * 1024)}GB`);
  }

  // Platform-specific validation
  const platformReqs = PLATFORM_VIDEO_FORMATS[request.platform.toLowerCase()];
  if (!platformReqs) {
    errors.push(`Unsupported platform: ${request.platform}`);
  } else {
    // Check file size against platform limits
    if (request.fileSize > platformReqs.maxSize) {
      errors.push(`File size exceeds ${request.platform} limit of ${platformReqs.maxSize / (1024 * 1024)}MB`);
    }

    // Check file format
    const fileExtension = request.fileName.split('.').pop()?.toLowerCase();
    if (fileExtension && !platformReqs.formats.includes(fileExtension)) {
      errors.push(`File format ${fileExtension} not supported for ${request.platform}. Supported formats: ${platformReqs.formats.join(', ')}`);
    }
  }

  // MIME type validation
  const validMimeTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-ms-wmv', 'video/x-flv', 'video/x-matroska', 'video/mpeg'];
  if (!validMimeTypes.includes(request.mimeType)) {
    errors.push(`Invalid MIME type: ${request.mimeType}`);
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

async function triggerVideoProcessing(videoId: string, uploadData: any): Promise<void> {
  logger.info('Triggering video processing', { 
    videoId, 
    platform: uploadData.platform 
  });

  // Invoke the video-processor Lambda asynchronously
  if (process.env.VIDEO_PROCESSOR_LAMBDA) {
    try {
      const payload = JSON.stringify({
        videoId,
        s3Key: uploadData.s3Key,
        platform: uploadData.platform,
        brandId: uploadData.brandId,
        contentId: uploadData.contentId,
      });
      
      await lambdaClient.send(new InvokeCommand({
        FunctionName: process.env.VIDEO_PROCESSOR_LAMBDA,
        InvocationType: 'Event', // async invocation
        Payload: Buffer.from(payload),
      }));
      
      logger.info('Video processor Lambda invoked successfully', { videoId });
    } catch (err) {
      logger.error('Failed to invoke video processor Lambda', err as Error);
      throw err;
    }
  } else {
    logger.warn('VIDEO_PROCESSOR_LAMBDA environment variable not set, skipping processing trigger');
  }
}