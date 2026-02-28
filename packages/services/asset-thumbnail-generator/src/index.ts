import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { prismaAssets } from '@postolio/database-assets';
import sharp from 'sharp';
import type { S3Event, S3EventRecord } from 'aws-lambda';
import { initSentry, captureException } from '@postolio/observability';

const logger = new Logger({ serviceName: 'asset-thumbnail-generator' });
const tracer = new Tracer({ serviceName: 'asset-thumbnail-generator' });
const metrics = new Metrics({
  namespace: 'AssetLibrary',
  serviceName: 'asset-thumbnail-generator',
});

initSentry({
  serviceName: 'asset-thumbnail-generator',
});

const s3Client = tracer.captureAWSv3Client(new S3Client({}));
const eventBridgeClient = tracer.captureAWSv3Client(new EventBridgeClient({}));

const THUMBNAIL_SIZES = {
  small: { width: 150, height: 150 },
  medium: { width: 400, height: 400 },
  large: { width: 800, height: 800 },
} as const;

type ThumbnailSizeName = keyof typeof THUMBNAIL_SIZES;

type OrientationType = 'portrait' | 'landscape' | 'square' | null;

interface AssetSnapshot {
  id: string;
  brandId: string;
  fileType: string;
}

interface ImageMetadataResult {
  width: number;
  height: number;
  aspectRatio: string | null;
  aspectRatioDecimal: number | null;
  orientationType: OrientationType;
}

interface ProcessRecordInput {
  asset: AssetSnapshot;
  s3Bucket: string;
  s3Key: string;
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

  const asset = await loadAssetByKey(s3Key);
  if (asset?.fileType !== 'image') {
    return;
  }

  try {
    await processImageAsset({ asset, s3Bucket, s3Key });
    metrics.addMetric('ThumbnailsGeneratedSuccess', MetricUnit.Count, 1);
  } catch (error) {
    await handleThumbnailFailure(asset.id, s3Key, error);
    metrics.addMetric('ThumbnailsGeneratedFailure', MetricUnit.Count, 1);
  }
}

async function loadAssetByKey(s3Key: string): Promise<AssetSnapshot | null> {
  const asset = await prismaAssets.asset.findFirst({
    where: { s3Key },
  });

  if (!asset) {
    logger.warn('Asset not found in database for S3 key', { s3Key });
    return null;
  }

  logger.info('Found asset in database', {
    assetId: asset.id,
    brandId: asset.brandId,
    fileType: asset.fileType,
  });

  if (asset.fileType !== 'image') {
    logger.info('Skipping non-image asset', { assetId: asset.id, fileType: asset.fileType });
    return null;
  }

  return {
    id: asset.id,
    brandId: asset.brandId,
    fileType: asset.fileType,
  };
}

async function processImageAsset(input: ProcessRecordInput): Promise<void> {
  const imageBuffer = await downloadOriginalImage(input.s3Bucket, input.s3Key, input.asset.id);
  const metadata = await extractImageMetadata(imageBuffer, input.asset.id);
  const thumbnailKeys = await generateThumbnails(
    imageBuffer,
    input.s3Bucket,
    input.s3Key,
    input.asset.id
  );

  await updateAssetWithThumbnails(input.asset.id, metadata, thumbnailKeys);

  await emitThumbnailsCompleteEvent({
    assetId: input.asset.id,
    brandId: input.asset.brandId,
    fileType: input.asset.fileType,
    s3Key: input.s3Key,
    s3Bucket: input.s3Bucket,
    thumbnailKeys,
  });
}

async function downloadOriginalImage(
  s3Bucket: string,
  s3Key: string,
  assetId: string
): Promise<Buffer> {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: s3Bucket,
      Key: s3Key,
    })
  );

  if (!response.Body) {
    throw new Error('No image data received from S3');
  }

  const imageBuffer = await streamToBuffer(response.Body);

  logger.info('Downloaded original image', {
    assetId,
    sizeBytes: imageBuffer.length,
  });

  return imageBuffer;
}

async function extractImageMetadata(
  imageBuffer: Buffer,
  assetId: string
): Promise<ImageMetadataResult> {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const ratioData = calculateAspectRatio(width, height);

  logger.info('Extracted image metadata', {
    assetId,
    width,
    height,
    aspectRatio: ratioData.aspectRatio,
    orientationType: ratioData.orientationType,
  });

  return {
    width,
    height,
    aspectRatio: ratioData.aspectRatio,
    aspectRatioDecimal: ratioData.aspectRatioDecimal,
    orientationType: ratioData.orientationType,
  };
}

function calculateAspectRatio(
  width: number,
  height: number
): {
  aspectRatio: string | null;
  aspectRatioDecimal: number | null;
  orientationType: OrientationType;
} {
  const aspectRatioDecimal = height > 0 ? width / height : null;
  if (aspectRatioDecimal === null || width <= 0 || height <= 0) {
    return { aspectRatio: null, aspectRatioDecimal, orientationType: null };
  }

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

  let orientationType: OrientationType = 'landscape';
  if (Math.abs(aspectRatioDecimal - 1.0) < 0.01) {
    orientationType = 'square';
  } else if (aspectRatioDecimal < 1) {
    orientationType = 'portrait';
  }

  return { aspectRatio, aspectRatioDecimal, orientationType };
}

async function generateThumbnails(
  imageBuffer: Buffer,
  s3Bucket: string,
  s3Key: string,
  assetId: string
): Promise<Record<string, string>> {
  const thumbnailKeys: Record<string, string> = {};

  for (const [sizeName, dimensions] of Object.entries(THUMBNAIL_SIZES) as Array<
    [ThumbnailSizeName, (typeof THUMBNAIL_SIZES)[ThumbnailSizeName]]
  >) {
    const thumbnailBuffer = await sharp(imageBuffer)
      .resize(dimensions.width, dimensions.height, {
        fit: 'cover',
        position: 'center',
      })
      .jpeg({ quality: 85, progressive: true })
      .toBuffer();

    const thumbnailKey = buildThumbnailKey(s3Key, sizeName);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: s3Bucket,
        Key: thumbnailKey,
        Body: thumbnailBuffer,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000',
      })
    );

    thumbnailKeys[sizeName] = thumbnailKey;

    logger.info('Generated thumbnail', {
      assetId,
      size: sizeName,
      sizeBytes: thumbnailBuffer.length,
      key: thumbnailKey,
    });

    metrics.addMetric(`ThumbnailGenerated_${sizeName}`, MetricUnit.Count, 1);
  }

  return thumbnailKeys;
}

function buildThumbnailKey(s3Key: string, sizeName: ThumbnailSizeName): string {
  const originalExt = s3Key.split('.').pop();
  const keyWithoutExt = originalExt ? s3Key.replace(`.${originalExt}`, '') : s3Key;
  return `${keyWithoutExt}_${sizeName}.jpg`;
}

async function updateAssetWithThumbnails(
  assetId: string,
  metadata: ImageMetadataResult,
  thumbnailKeys: Record<string, string>
): Promise<void> {
  await prismaAssets.asset.update({
    where: { id: assetId },
    data: {
      width: metadata.width,
      height: metadata.height,
      aspectRatio: metadata.aspectRatio,
      aspectRatioDecimal: metadata.aspectRatioDecimal,
      orientationType: metadata.orientationType,
      thumbnailKey: thumbnailKeys.medium,
      thumbnailSmallKey: thumbnailKeys.small,
      thumbnailLargeKey: thumbnailKeys.large,
      processingStatus: 'thumbnails_complete',
      updatedAt: new Date(),
    },
  });

  logger.info('Updated asset with thumbnail keys', {
    assetId,
    thumbnailCount: Object.keys(thumbnailKeys).length,
  });
}

async function emitThumbnailsCompleteEvent(input: {
  assetId: string;
  brandId: string;
  fileType: string;
  s3Key: string;
  s3Bucket: string;
  thumbnailKeys: Record<string, string>;
}): Promise<void> {
  try {
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'asset.processing',
            DetailType: 'asset.thumbnails_complete',
            Detail: JSON.stringify({
              ...input,
              timestamp: new Date().toISOString(),
            }),
            EventBusName: process.env.EVENT_BUS_NAME || 'default',
          },
        ],
      })
    );

    logger.info('Emitted asset.thumbnails_complete event', { assetId: input.assetId });
    metrics.addMetric('ThumbnailCompleteEventEmitted', MetricUnit.Count, 1);
  } catch (eventError) {
    logger.error('Failed to emit thumbnails_complete event', eventError as Error, {
      assetId: input.assetId,
    });
    metrics.addMetric('ThumbnailCompleteEventFailed', MetricUnit.Count, 1);
  }
}

async function handleThumbnailFailure(
  assetId: string,
  s3Key: string,
  error: unknown
): Promise<void> {
  logger.error('Failed to generate thumbnails', error as Error, {
    assetId,
    s3Key,
  });

  captureException(error, {
    assetId,
    s3Key,
    function: 'asset-thumbnail-generator',
  });

  try {
    await prismaAssets.asset.update({
      where: { id: assetId },
      data: {
        processingStatus: 'thumbnail_failed',
        processingError: (error as Error).message,
        updatedAt: new Date(),
      },
    });
  } catch (dbError) {
    logger.error('Failed to update asset status', dbError as Error);
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
