import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { prismaAssets } from '@postolio/database-assets';
import ffmpeg from 'fluent-ffmpeg';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import type { S3Event } from 'aws-lambda';

// Initialize Powertools
const logger = new Logger({ serviceName: 'video-processor' });
const tracer = new Tracer({ serviceName: 'video-processor' });
const metrics = new Metrics({
  namespace: 'AssetLibrary',
  serviceName: 'video-processor',
});

// Initialize AWS SDK clients
const s3Client = tracer.captureAWSv3Client(new S3Client({}));
const eventBridgeClient = tracer.captureAWSv3Client(new EventBridgeClient({}));

// Thumbnail timestamps (in seconds)
const THUMBNAIL_TIMESTAMPS = [1, 3, 5]; // Generate thumbnails at 1s, 3s, 5s

// Maximum video duration to process (10 minutes)
const MAX_VIDEO_DURATION = 600;

interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  aspectRatio: string;
  codec: string;
  bitrate: number;
  fps: number;
}

export const handler = async (event: S3Event): Promise<void> => {
  logger.info('Received S3 event', { recordCount: event.Records.length });

  // Process each S3 record
  for (const record of event.Records) {
    const s3Bucket = record.s3.bucket.name;
    const s3Key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    logger.info('Processing S3 object', { s3Bucket, s3Key });

    // Skip non-video files (only process videos/* prefix)
    if (!s3Key.startsWith('videos/')) {
      logger.info('Skipping non-video S3 key', { s3Key });
      continue;
    }

    // Find the asset in database using S3 key
    const asset = await prismaAssets.asset.findFirst({
      where: { s3Key },
    });

    if (!asset) {
      logger.warn('Asset not found in database for S3 key, will be created', { s3Key });
      // Asset will be created when video upload completes
      continue;
    }

    const { id: assetId, brandId, fileType } = asset;

    logger.info('Found asset in database', { assetId, brandId, fileType });

    // Only process videos
    if (fileType !== 'video') {
      logger.info('Skipping non-video asset', { assetId, fileType });
      continue;
    }

    const workDir = join(tmpdir(), randomUUID());
    const videoPath = join(workDir, 'video.mp4');
    const thumbnailPaths: string[] = [];

    try {
      // Create working directory
      await fs.mkdir(workDir, { recursive: true });

      // Download video from S3
      logger.info('Downloading video from S3', { s3Bucket, s3Key });
      const getCommand = new GetObjectCommand({
        Bucket: s3Bucket,
        Key: s3Key,
      });

      const response = await s3Client.send(getCommand);
      if (!response.Body) {
        throw new Error('No video data received from S3');
      }

      // Save video to temp file
      const videoBuffer = await streamToBuffer(response.Body);
      await fs.writeFile(videoPath, videoBuffer);

      logger.info('Downloaded video', {
        assetId,
        sizeBytes: videoBuffer.length,
        path: videoPath,
      });

      // Extract video metadata using FFmpeg
      const metadata = await extractVideoMetadata(videoPath);

      logger.info('Extracted video metadata', {
        assetId,
        duration: metadata.duration,
        resolution: `${metadata.width}x${metadata.height}`,
        aspectRatio: metadata.aspectRatio,
      });

      // Validate video duration
      if (metadata.duration > MAX_VIDEO_DURATION) {
        throw new Error(
          `Video duration ${metadata.duration}s exceeds maximum ${MAX_VIDEO_DURATION}s`
        );
      }

      // Generate thumbnails at specific timestamps
      const thumbnailKeys: string[] = [];
      const timestamps = THUMBNAIL_TIMESTAMPS.filter((t) => t < metadata.duration);

      for (const timestamp of timestamps) {
        const thumbnailPath = join(workDir, `thumbnail_${timestamp}s.jpg`);
        thumbnailPaths.push(thumbnailPath);

        await generateThumbnail(videoPath, thumbnailPath, timestamp);

        // Upload thumbnail to S3
        const thumbnailBuffer = await fs.readFile(thumbnailPath);
        const originalExt = s3Key.split('.').pop();
        const keyWithoutExt = s3Key.replace(`.${originalExt}`, '');
        const thumbnailKey = `${keyWithoutExt}_thumb_${timestamp}s.jpg`;

        await s3Client.send(
          new PutObjectCommand({
            Bucket: s3Bucket,
            Key: thumbnailKey,
            Body: thumbnailBuffer,
            ContentType: 'image/jpeg',
            CacheControl: 'public, max-age=31536000', // 1 year
          })
        );

        thumbnailKeys.push(thumbnailKey);

        logger.info('Generated thumbnail', {
          assetId,
          timestamp,
          sizeBytes: thumbnailBuffer.length,
          key: thumbnailKey,
        });

        metrics.addMetric('VideoThumbnailGenerated', MetricUnit.Count, 1);
      }

      // Update asset in database with video metadata and thumbnail
      await prismaAssets.asset.update({
        where: { id: assetId },
        data: {
          width: metadata.width,
          height: metadata.height,
          duration: Math.round(metadata.duration),
          thumbnailKey: thumbnailKeys[0], // Primary thumbnail (first frame)
          thumbnailSmallKey: thumbnailKeys[0],
          thumbnailLargeKey: thumbnailKeys[thumbnailKeys.length - 1],
          processingStatus: 'video_processing_complete',
          updatedAt: new Date(),
        },
      });

      logger.info('Updated asset with video metadata', {
        assetId,
        duration: metadata.duration,
        thumbnailCount: thumbnailKeys.length,
      });

      // Emit asset.video_processing_complete event
      try {
        await eventBridgeClient.send(
          new PutEventsCommand({
            Entries: [
              {
                Source: 'asset.processing',
                DetailType: 'asset.video_processing_complete',
                Detail: JSON.stringify({
                  assetId,
                  brandId,
                  s3Key,
                  s3Bucket,
                  fileType,
                  metadata,
                  thumbnailKeys,
                  timestamp: new Date().toISOString(),
                }),
                EventBusName: process.env.EVENT_BUS_NAME || 'default',
              },
            ],
          })
        );

        logger.info('Emitted asset.video_processing_complete event', { assetId });
        metrics.addMetric('VideoProcessingCompleteEventEmitted', MetricUnit.Count, 1);
      } catch (eventError) {
        logger.error('Failed to emit video_processing_complete event', eventError as Error, {
          assetId,
        });
        metrics.addMetric('VideoProcessingCompleteEventFailed', MetricUnit.Count, 1);
      }

      metrics.addMetric('VideoProcessingSuccess', MetricUnit.Count, 1);
    } catch (error) {
      logger.error('Failed to process video', error as Error, {
        assetId,
        s3Key,
      });

      // Update asset processing status to failed
      try {
        await prismaAssets.asset.update({
          where: { id: assetId },
          data: {
            processingStatus: 'video_processing_failed',
            processingError: (error as Error).message,
            updatedAt: new Date(),
          },
        });
      } catch (dbError) {
        logger.error('Failed to update asset status', dbError as Error);
      }

      metrics.addMetric('VideoProcessingFailure', MetricUnit.Count, 1);
    } finally {
      // Clean up temp files
      try {
        await fs.rm(workDir, { recursive: true, force: true });
      } catch {
        logger.warn('Failed to clean up temp directory', { workDir });
      }
    }
  }

  // Publish metrics once after processing all records
  metrics.publishStoredMetrics();
};

// Helper to convert stream to buffer
async function streamToBuffer(
  stream: NodeJS.ReadableStream | ReadableStream<Uint8Array>
): Promise<Buffer> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

// Extract video metadata using FFmpeg
function extractVideoMetadata(videoPath: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        return reject(err);
      }

      const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
      if (!videoStream) {
        return reject(new Error('No video stream found'));
      }

      const duration = metadata.format.duration || 0;
      const width = videoStream.width || 0;
      const height = videoStream.height || 0;
      const codec = videoStream.codec_name || 'unknown';
      const bitrate = metadata.format.bit_rate || 0;
      const fps = eval(videoStream.r_frame_rate || '0'); // e.g., "30/1" => 30

      // Calculate aspect ratio
      const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
      const divisor = gcd(width, height);
      const aspectRatio = `${width / divisor}:${height / divisor}`;

      resolve({
        duration,
        width,
        height,
        aspectRatio,
        codec,
        bitrate,
        fps,
      });
    });
  });
}

// Generate thumbnail at specific timestamp
function generateThumbnail(
  videoPath: string,
  outputPath: string,
  timestamp: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: [timestamp],
        filename: join(outputPath, '..', `thumbnail_${timestamp}s.jpg`),
        size: '1280x720',
      })
      .on('end', () => resolve())
      .on('error', reject);
  });
}
