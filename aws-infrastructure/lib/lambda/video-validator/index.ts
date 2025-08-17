import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { execSync, execFileSync, execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
import { writeFileSync, unlinkSync, createWriteStream } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

// Initialize Powertools
const logger = new Logger({ serviceName: 'video-validator' });
const tracer = new Tracer({ serviceName: 'video-validator' });
const metrics = new Metrics({ namespace: 'ContentScheduler', serviceName: 'video-validator' });

// Validate required environment variables
const requiredEnvVars = ['VIDEO_UPLOADS_TABLE'];
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

// Platform requirements
const PLATFORM_REQUIREMENTS: Record<string, VideoRequirements> = {
  instagram_reels: {
    maxDuration: 90,
    minDuration: 3,
    maxFileSize: 1024 * 1024 * 1024, // 1GB
    supportedCodecs: ['h264', 'hevc'],
    supportedContainers: ['mp4', 'mov'],
    minResolution: { width: 540, height: 960 },
    maxResolution: { width: 1920, height: 1920 },
    aspectRatios: ['9:16', '4:5', '1:1'],
    minFrameRate: 23,
    maxFrameRate: 60,
    audioBitrate: { min: 64000, max: 320000 },
    videoBitrate: { min: 500000, max: 10000000 },
  },
  tiktok: {
    maxDuration: 600, // 10 minutes
    minDuration: 1,
    maxFileSize: 4 * 1024 * 1024 * 1024, // 4GB
    supportedCodecs: ['h264', 'hevc'],
    supportedContainers: ['mp4', 'mov', 'mpeg', 'avi'],
    minResolution: { width: 540, height: 960 },
    maxResolution: { width: 1920, height: 1920 },
    aspectRatios: ['9:16', '16:9', '1:1'],
    minFrameRate: 23,
    maxFrameRate: 60,
    audioBitrate: { min: 96000, max: 320000 },
    videoBitrate: { min: 516000, max: 20000000 },
  },
  youtube_shorts: {
    maxDuration: 60,
    minDuration: 1,
    maxFileSize: 256 * 1024 * 1024, // 256MB for Shorts
    supportedCodecs: ['h264', 'hevc', 'vp9'],
    supportedContainers: ['mp4', 'mov', 'avi', 'wmv', 'flv', 'mkv', 'webm'],
    minResolution: { width: 256, height: 144 },
    maxResolution: { width: 3840, height: 2160 },
    aspectRatios: ['9:16'], // Shorts must be vertical
    minFrameRate: 24,
    maxFrameRate: 60,
    audioBitrate: { min: 128000, max: 512000 },
    videoBitrate: { min: 1000000, max: 50000000 },
  },
  facebook: {
    maxDuration: 240, // 4 minutes for feed
    minDuration: 1,
    maxFileSize: 4 * 1024 * 1024 * 1024, // 4GB
    supportedCodecs: ['h264', 'hevc'],
    supportedContainers: ['mp4', 'mov'],
    minResolution: { width: 120, height: 120 },
    maxResolution: { width: 1920, height: 1080 },
    aspectRatios: ['16:9', '1:1', '4:5', '9:16', '2:3'],
    minFrameRate: 23,
    maxFrameRate: 60,
    audioBitrate: { min: 128000, max: 256000 },
    videoBitrate: { min: 1000000, max: 20000000 },
  },
  linkedin: {
    maxDuration: 600, // 10 minutes
    minDuration: 3,
    maxFileSize: 5 * 1024 * 1024 * 1024, // 5GB
    supportedCodecs: ['h264'],
    supportedContainers: ['mp4', 'mov', 'avi'],
    minResolution: { width: 256, height: 144 },
    maxResolution: { width: 4096, height: 2304 },
    aspectRatios: ['16:9', '1:1', '4:5', '1.91:1'],
    minFrameRate: 10,
    maxFrameRate: 60,
    audioBitrate: { min: 64000, max: 512000 },
    videoBitrate: { min: 75000, max: 30000000 },
  },
};

interface VideoRequirements {
  maxDuration: number;
  minDuration: number;
  maxFileSize: number;
  supportedCodecs: string[];
  supportedContainers: string[];
  minResolution: { width: number; height: number };
  maxResolution: { width: number; height: number };
  aspectRatios: string[];
  minFrameRate: number;
  maxFrameRate: number;
  audioBitrate: { min: number; max: number };
  videoBitrate: { min: number; max: number };
}

interface VideoMetadata {
  duration: number;
  fileSize: number;
  container: string;
  videoCodec: string;
  audioCodec: string;
  width: number;
  height: number;
  aspectRatio: string;
  frameRate: number;
  videoBitrate: number;
  audioBitrate: number;
  hasAudio: boolean;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  metadata: VideoMetadata;
  recommendations?: string[];
}

export const handler = async (event: any): Promise<ValidationResult> => {
  const { videoId, s3Bucket, s3Key, platform } = event;

  logger.addPersistentLogAttributes({
    videoId,
    platform,
    s3Key,
  });

  logger.info('Starting video validation');

  try {
    // Download video to temp file
    const tempFile = await downloadVideo(s3Bucket, s3Key);

    try {
      // Extract metadata using ffprobe
      const metadata = await extractVideoMetadata(tempFile);
      
      // Validate against platform requirements
      const validation = validateAgainstPlatform(metadata, platform);
      
      // Update DynamoDB with validation results
      await updateValidationStatus(videoId, validation);
      
      // Record metrics
      metrics.addMetric('VideoValidated', MetricUnit.Count, 1);
      if (validation.valid) {
        metrics.addMetric('VideoValidationPassed', MetricUnit.Count, 1);
      } else {
        metrics.addMetric('VideoValidationFailed', MetricUnit.Count, 1);
      }
      
      return validation;
    } finally {
      // Clean up temp file
      try {
        unlinkSync(tempFile);
      } catch (e) {
        logger.warn('Failed to delete temp file', { tempFile, error: e });
      }
    }
  } catch (error) {
    logger.error('Video validation failed', error as Error);
    metrics.addMetric('VideoValidationError', MetricUnit.Count, 1);
    throw error;
  } finally {
    metrics.publishStoredMetrics();
  }
};

async function downloadVideo(bucket: string, key: string): Promise<string> {
  const tempFile = join(tmpdir(), `video_${Date.now()}_${Math.random().toString(36).substring(7)}.tmp`);
  
  logger.info('Downloading video to temp file', { bucket, key, tempFile });
  
  const response = await s3Client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  }));
  
  if (!response.Body) {
    throw new Error('No body in S3 response');
  }
  
  // Stream directly to file to avoid memory issues with large videos
  const writeStream = createWriteStream(tempFile);
  const bodyStream = response.Body as Readable;
  
  try {
    await pipeline(bodyStream, writeStream);
    logger.info('Video downloaded successfully', { 
      size: response.ContentLength,
      tempFile 
    });
  } catch (error) {
    logger.error('Failed to download video', error as Error);
    // Clean up partial file on error
    try {
      unlinkSync(tempFile);
    } catch (e) {
      // Ignore cleanup errors
    }
    throw error;
  }
  
  return tempFile;
}

async function extractVideoMetadata(filePath: string): Promise<VideoMetadata> {
  logger.info('Extracting video metadata', { filePath });
  
  // Use async execFile to avoid blocking the event loop
  const ffprobeArgs = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath
  ];
  
  let output: string;
  try {
    // Set a timeout for ffprobe (10 seconds)
    const { stdout, stderr } = await execFileAsync(
      'ffprobe',
      ffprobeArgs,
      { 
        encoding: 'utf8', 
        maxBuffer: 2 * 1024 * 1024, // 2MB should be sufficient for metadata
        timeout: 10000 // 10 second timeout
      }
    );
    
    if (stderr) {
      logger.warn('ffprobe stderr output', { stderr });
    }
    
    output = stdout;
  } catch (error) {
    logger.error('ffprobe failed', error as Error);
    throw new Error(`Failed to extract video metadata: ${(error as Error).message}`);
  }
  
  const probeData = JSON.parse(output);
  const format = probeData.format;
  const videoStream = probeData.streams.find((s: any) => s.codec_type === 'video');
  const audioStream = probeData.streams.find((s: any) => s.codec_type === 'audio');
  
  if (!videoStream) {
    throw new Error('No video stream found in file');
  }
  
  // Calculate aspect ratio
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const aspectGcd = gcd(videoStream.width, videoStream.height);
  const aspectRatio = `${videoStream.width / aspectGcd}:${videoStream.height / aspectGcd}`;
  
  // Parse frame rate
  let frameRate = 30; // default
  if (videoStream.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    if (den > 0) {
      frameRate = num / den;
    }
  } else if (videoStream.avg_frame_rate) {
    const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
    if (den > 0) {
      frameRate = num / den;
    }
  }
  
  const metadata: VideoMetadata = {
    duration: parseFloat(format.duration || '0'),
    fileSize: parseInt(format.size || '0', 10),
    container: format.format_name?.split(',')[0] || 'unknown',
    videoCodec: videoStream.codec_name || 'unknown',
    audioCodec: audioStream?.codec_name || 'none',
    width: videoStream.width || 0,
    height: videoStream.height || 0,
    aspectRatio,
    frameRate,
    videoBitrate: parseInt(videoStream.bit_rate || format.bit_rate || '0', 10),
    audioBitrate: parseInt(audioStream?.bit_rate || '0', 10),
    hasAudio: !!audioStream,
  };
  
  logger.info('Video metadata extracted', metadata);
  
  return metadata;
}

function validateAgainstPlatform(metadata: VideoMetadata, platform: string): ValidationResult {
  const requirements = PLATFORM_REQUIREMENTS[platform] || PLATFORM_REQUIREMENTS.facebook;
  const errors: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];
  
  // Duration validation
  if (metadata.duration < requirements.minDuration) {
    errors.push(`Video duration (${metadata.duration.toFixed(1)}s) is below minimum (${requirements.minDuration}s)`);
  }
  if (metadata.duration > requirements.maxDuration) {
    errors.push(`Video duration (${metadata.duration.toFixed(1)}s) exceeds maximum (${requirements.maxDuration}s)`);
  }
  
  // File size validation
  if (metadata.fileSize > requirements.maxFileSize) {
    errors.push(`File size (${(metadata.fileSize / 1024 / 1024).toFixed(2)}MB) exceeds maximum (${(requirements.maxFileSize / 1024 / 1024).toFixed(2)}MB)`);
  }
  
  // Container validation
  if (!requirements.supportedContainers.includes(metadata.container)) {
    errors.push(`Container format '${metadata.container}' not supported. Supported: ${requirements.supportedContainers.join(', ')}`);
  }
  
  // Codec validation
  if (!requirements.supportedCodecs.includes(metadata.videoCodec)) {
    warnings.push(`Video codec '${metadata.videoCodec}' may not be optimal. Recommended: ${requirements.supportedCodecs.join(', ')}`);
    recommendations.push(`Consider transcoding to H.264 for best compatibility`);
  }
  
  // Resolution validation
  if (metadata.width < requirements.minResolution.width || metadata.height < requirements.minResolution.height) {
    errors.push(`Resolution ${metadata.width}x${metadata.height} is below minimum ${requirements.minResolution.width}x${requirements.minResolution.height}`);
  }
  if (metadata.width > requirements.maxResolution.width || metadata.height > requirements.maxResolution.height) {
    warnings.push(`Resolution ${metadata.width}x${metadata.height} exceeds recommended maximum ${requirements.maxResolution.width}x${requirements.maxResolution.height}`);
  }
  
  // Aspect ratio validation
  if (!requirements.aspectRatios.includes(metadata.aspectRatio)) {
    // Check if it's close to any supported ratio
    const supportedRatios = requirements.aspectRatios.map(r => {
      const [w, h] = r.split(':').map(Number);
      return w / h;
    });
    const currentRatio = metadata.width / metadata.height;
    const closeRatio = supportedRatios.some(r => Math.abs(r - currentRatio) < 0.1);
    
    if (!closeRatio) {
      if (platform === 'youtube_shorts') {
        errors.push(`YouTube Shorts must be vertical (9:16). Current: ${metadata.aspectRatio}`);
      } else {
        warnings.push(`Aspect ratio ${metadata.aspectRatio} not ideal. Recommended: ${requirements.aspectRatios.join(', ')}`);
      }
    }
  }
  
  // Frame rate validation
  if (metadata.frameRate < requirements.minFrameRate) {
    warnings.push(`Frame rate ${metadata.frameRate.toFixed(1)}fps is below recommended minimum ${requirements.minFrameRate}fps`);
  }
  if (metadata.frameRate > requirements.maxFrameRate) {
    warnings.push(`Frame rate ${metadata.frameRate.toFixed(1)}fps exceeds maximum ${requirements.maxFrameRate}fps`);
  }
  
  // Bitrate validation
  if (metadata.videoBitrate < requirements.videoBitrate.min) {
    warnings.push(`Video bitrate may be too low for good quality`);
    recommendations.push(`Consider increasing video bitrate to at least ${(requirements.videoBitrate.min / 1000000).toFixed(1)}Mbps`);
  }
  if (metadata.videoBitrate > requirements.videoBitrate.max) {
    warnings.push(`Video bitrate may be unnecessarily high`);
    recommendations.push(`Consider reducing video bitrate to around ${(requirements.videoBitrate.max / 1000000).toFixed(1)}Mbps`);
  }
  
  // Audio validation
  if (!metadata.hasAudio && platform !== 'instagram_reels') {
    warnings.push(`Video has no audio track`);
  }
  
  if (metadata.hasAudio) {
    if (metadata.audioBitrate < requirements.audioBitrate.min) {
      warnings.push(`Audio bitrate may be too low`);
    }
    if (metadata.audioBitrate > requirements.audioBitrate.max) {
      warnings.push(`Audio bitrate may be unnecessarily high`);
    }
  }
  
  // Platform-specific recommendations
  if (platform === 'instagram_reels' && metadata.duration > 60) {
    recommendations.push(`Consider keeping Reels under 60 seconds for better engagement`);
  }
  
  if (platform === 'tiktok' && metadata.duration > 180) {
    recommendations.push(`TikTok videos under 3 minutes tend to perform better`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metadata,
    recommendations: recommendations.length > 0 ? recommendations : undefined,
  };
}

async function updateValidationStatus(videoId: string, validation: ValidationResult): Promise<void> {
  const status = validation.valid ? 'validation_passed' : 'validation_failed';
  
  await docClient.send(new UpdateCommand({
    TableName: process.env.VIDEO_UPLOADS_TABLE!,
    Key: {
      pk: `VIDEO#${videoId}`,
      sk: 'UPLOAD_METADATA',
    },
    UpdateExpression: 'SET #status = :status, #validation = :validation, #updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#status': 'validationStatus',
      '#validation': 'validationResult',
      '#updatedAt': 'updatedAt',
    },
    ExpressionAttributeValues: {
      ':status': status,
      ':validation': validation,
      ':updatedAt': new Date().toISOString(),
    },
  }));
  
  logger.info('Validation status updated', { videoId, status });
}