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
import type { S3Event, S3EventRecord } from 'aws-lambda';
import { initSentry, captureException } from '@postolio/observability';

const logger = new Logger({ serviceName: 'video-processor' });
const tracer = new Tracer({ serviceName: 'video-processor' });
const metrics = new Metrics({
  namespace: 'AssetLibrary',
  serviceName: 'video-processor',
});

initSentry({
  serviceName: 'video-processor',
});

const s3Client = tracer.captureAWSv3Client(new S3Client({}));
const eventBridgeClient = tracer.captureAWSv3Client(new EventBridgeClient({}));

const THUMBNAIL_TIMESTAMPS = [1, 3, 5];
const MAX_VIDEO_DURATION = 600;

interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  aspectRatio: string;
  aspectRatioDecimal: number;
  orientationType: 'portrait' | 'landscape' | 'square';
  codec: string;
  bitrate: number;
  fps: number;
}

interface VideoAssetSnapshot {
  id: string;
  brandId: string;
  fileType: string;
}

interface VideoWorkContext {
  workDir: string;
  videoPath: string;
}

interface GenerateAndUploadThumbnailsInput {
  videoPath: string;
  workDir: string;
  s3Bucket: string;
  s3Key: string;
  duration: number;
  assetId: string;
}

export const handler = async (event: S3Event): Promise<void> => {
  logger.info('Received S3 event', { recordCount: event.Records.length });

  for (const record of event.Records) {
    await processRecord(record);
  }

  metrics.publishStoredMetrics();
};

async function processRecord(record: S3EventRecord): Promise<void> {
  const s3Bucket = record.s3.bucket.name;
  const s3Key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

  logger.info('Processing S3 object', { s3Bucket, s3Key });

  if (!s3Key.startsWith('videos/')) {
    logger.info('Skipping non-video S3 key', { s3Key });
    return;
  }

  const asset = await loadVideoAsset(s3Key);
  if (!asset) {
    return;
  }

  try {
    await processVideoAsset(asset, s3Bucket, s3Key);
    metrics.addMetric('VideoProcessingSuccess', MetricUnit.Count, 1);
  } catch (error) {
    await handleVideoProcessingError(asset.id, s3Key, error);
    metrics.addMetric('VideoProcessingFailure', MetricUnit.Count, 1);
  }
}

async function loadVideoAsset(s3Key: string): Promise<VideoAssetSnapshot | null> {
  const asset = await prismaAssets.asset.findFirst({
    where: { s3Key },
  });

  if (!asset) {
    logger.warn('Asset not found in database for S3 key, will be created', { s3Key });
    return null;
  }

  logger.info('Found asset in database', {
    assetId: asset.id,
    brandId: asset.brandId,
    fileType: asset.fileType,
  });

  if (asset.fileType !== 'video') {
    logger.info('Skipping non-video asset', { assetId: asset.id, fileType: asset.fileType });
    return null;
  }

  return {
    id: asset.id,
    brandId: asset.brandId,
    fileType: asset.fileType,
  };
}

async function processVideoAsset(
  asset: VideoAssetSnapshot,
  s3Bucket: string,
  s3Key: string
): Promise<void> {
  const context = createVideoWorkContext();

  try {
    await fs.mkdir(context.workDir, { recursive: true });

    const videoBuffer = await downloadVideoBuffer(s3Bucket, s3Key);
    await fs.writeFile(context.videoPath, videoBuffer);

    logger.info('Downloaded video', {
      assetId: asset.id,
      sizeBytes: videoBuffer.length,
      path: context.videoPath,
    });

    const metadata = await extractVideoMetadata(context.videoPath);
    ensureVideoDurationAllowed(metadata.duration);

    const thumbnailKeys = await generateAndUploadThumbnails({
      videoPath: context.videoPath,
      workDir: context.workDir,
      s3Bucket,
      s3Key,
      duration: metadata.duration,
      assetId: asset.id,
    });

    await updateVideoAsset(asset.id, metadata, thumbnailKeys);
    await emitVideoProcessingComplete(asset, s3Bucket, s3Key, metadata, thumbnailKeys);
  } finally {
    await cleanupWorkDirectory(context.workDir);
  }
}

function createVideoWorkContext(): VideoWorkContext {
  const workDir = join(tmpdir(), randomUUID());
  return {
    workDir,
    videoPath: join(workDir, 'video.mp4'),
  };
}

async function downloadVideoBuffer(s3Bucket: string, s3Key: string): Promise<Buffer> {
  logger.info('Downloading video from S3', { s3Bucket, s3Key });

  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: s3Bucket,
      Key: s3Key,
    })
  );

  if (!response.Body) {
    throw new Error('No video data received from S3');
  }

  return streamToBuffer(response.Body);
}

function ensureVideoDurationAllowed(duration: number): void {
  if (duration <= MAX_VIDEO_DURATION) {
    return;
  }

  throw new Error(`Video duration ${duration}s exceeds maximum ${MAX_VIDEO_DURATION}s`);
}

async function generateAndUploadThumbnails({
  videoPath,
  workDir,
  s3Bucket,
  s3Key,
  duration,
  assetId,
}: GenerateAndUploadThumbnailsInput): Promise<string[]> {
  const thumbnailKeys: string[] = [];
  const timestamps = THUMBNAIL_TIMESTAMPS.filter((timestamp) => timestamp < duration);

  for (const timestamp of timestamps) {
    const thumbnailPath = join(workDir, `thumbnail_${timestamp}s.jpg`);

    await generateThumbnail(videoPath, thumbnailPath, timestamp);

    const thumbnailBuffer = await fs.readFile(thumbnailPath);
    const thumbnailKey = buildThumbnailKey(s3Key, timestamp);

    await s3Client.send(
      new PutObjectCommand({
        Bucket: s3Bucket,
        Key: thumbnailKey,
        Body: thumbnailBuffer,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000',
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

  return thumbnailKeys;
}

function buildThumbnailKey(s3Key: string, timestamp: number): string {
  const originalExt = s3Key.split('.').pop();
  const keyWithoutExt = originalExt ? s3Key.replace(`.${originalExt}`, '') : s3Key;
  return `${keyWithoutExt}_thumb_${timestamp}s.jpg`;
}

async function updateVideoAsset(
  assetId: string,
  metadata: VideoMetadata,
  thumbnailKeys: string[]
): Promise<void> {
  await prismaAssets.asset.update({
    where: { id: assetId },
    data: {
      width: metadata.width,
      height: metadata.height,
      duration: Math.round(metadata.duration),
      aspectRatio: metadata.aspectRatio,
      aspectRatioDecimal: metadata.aspectRatioDecimal,
      orientationType: metadata.orientationType,
      thumbnailKey: thumbnailKeys[0],
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
}

async function emitVideoProcessingComplete(
  asset: VideoAssetSnapshot,
  s3Bucket: string,
  s3Key: string,
  metadata: VideoMetadata,
  thumbnailKeys: string[]
): Promise<void> {
  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'asset.processing',
            DetailType: 'asset.video_processing_complete',
            Detail: JSON.stringify({
              assetId: asset.id,
              brandId: asset.brandId,
              s3Key,
              s3Bucket,
              fileType: asset.fileType,
              metadata,
              thumbnailKeys,
              timestamp: new Date().toISOString(),
            }),
            EventBusName: process.env.EVENT_BUS_NAME || 'default',
          },
        ],
      })
    );

    logger.info('Emitted asset.video_processing_complete event', { assetId: asset.id });
    metrics.addMetric('VideoProcessingCompleteEventEmitted', MetricUnit.Count, 1);
  } catch (eventError) {
    logger.error('Failed to emit video_processing_complete event', eventError as Error, {
      assetId: asset.id,
    });
    metrics.addMetric('VideoProcessingCompleteEventFailed', MetricUnit.Count, 1);
  }
}

async function handleVideoProcessingError(
  assetId: string,
  s3Key: string,
  error: unknown
): Promise<void> {
  logger.error('Failed to process video', error as Error, {
    assetId,
    s3Key,
  });

  captureException(error, {
    function: 'video-processor',
    assetId,
    s3Key,
  });

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
}

async function cleanupWorkDirectory(workDir: string): Promise<void> {
  try {
    await fs.rm(workDir, { recursive: true, force: true });
  } catch {
    logger.warn('Failed to clean up temp directory', { workDir });
  }
}

async function streamToBuffer(
  stream: NodeJS.ReadableStream | ReadableStream<Uint8Array>
): Promise<Buffer> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function extractVideoMetadata(videoPath: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        return reject(err);
      }

      const videoStream = metadata.streams.find((stream) => stream.codec_type === 'video');
      if (!videoStream) {
        return reject(new Error('No video stream found'));
      }

      const duration = metadata.format.duration || 0;
      const width = videoStream.width || 0;
      const height = videoStream.height || 0;
      const codec = videoStream.codec_name || 'unknown';
      const bitrate = metadata.format.bit_rate || 0;
      const fps = eval(videoStream.r_frame_rate || '0');

      const aspectRatioDecimal = width / height;
      const { aspectRatio, orientationType } = matchAspectRatio(aspectRatioDecimal);

      resolve({
        duration,
        width,
        height,
        aspectRatio,
        aspectRatioDecimal,
        orientationType,
        codec,
        bitrate,
        fps,
      });
    });
  });
}

function matchAspectRatio(aspectRatioDecimal: number): {
  aspectRatio: string;
  orientationType: 'portrait' | 'landscape' | 'square';
} {
  const tolerance = 0.03;
  const standardRatios = [
    { label: '1:1', decimal: 1.0 },
    { label: '4:5', decimal: 0.8 },
    { label: '9:16', decimal: 0.5625 },
    { label: '3:4', decimal: 0.75 },
    { label: '4:3', decimal: 1.3333 },
    { label: '16:9', decimal: 1.7778 },
    { label: '1.91:1', decimal: 1.91 },
    { label: '2:1', decimal: 2.0 },
    { label: '2.39:1', decimal: 2.39 },
  ];

  let aspectRatio = 'CUSTOM';
  for (const standard of standardRatios) {
    if (Math.abs(aspectRatioDecimal - standard.decimal) <= tolerance) {
      aspectRatio = standard.label;
      break;
    }
  }

  let orientationType: 'square' | 'portrait' | 'landscape' = 'landscape';
  if (Math.abs(aspectRatioDecimal - 1.0) < 0.01) {
    orientationType = 'square';
  } else if (aspectRatioDecimal < 1) {
    orientationType = 'portrait';
  }

  return { aspectRatio, orientationType };
}

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
