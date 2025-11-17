import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { prismaAssets } from '@postolio/database-assets';
import sharp from 'sharp';
import type { S3Event } from 'aws-lambda';

// Initialize Powertools
const logger = new Logger({ serviceName: 'asset-thumbnail-generator' });
const tracer = new Tracer({ serviceName: 'asset-thumbnail-generator' });
const metrics = new Metrics({
  namespace: 'AssetLibrary',
  serviceName: 'asset-thumbnail-generator',
});

// Initialize AWS SDK clients
const s3Client = tracer.captureAWSv3Client(new S3Client({}));
const eventBridgeClient = tracer.captureAWSv3Client(new EventBridgeClient({}));

// Thumbnail sizes
const THUMBNAIL_SIZES = {
  small: { width: 150, height: 150 },
  medium: { width: 400, height: 400 },
  large: { width: 800, height: 800 },
} as const;

export const handler = async (event: S3Event): Promise<void> => {
  logger.info('Received S3 event', { recordCount: event.Records.length });

  // Process each S3 record
  for (const record of event.Records) {
    const s3Bucket = record.s3.bucket.name;
    const s3Key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    logger.info('Processing S3 object', { s3Bucket, s3Key });

    // Find the asset in database using S3 key
    const asset = await prismaAssets.asset.findFirst({
      where: { s3Key },
    });

    if (!asset) {
      logger.warn('Asset not found in database for S3 key', { s3Key });
      continue;
    }

    const { id: assetId, brandId, fileType } = asset;

    logger.info('Found asset in database', { assetId, brandId, fileType });

    // Only process images
    if (fileType !== 'image') {
      logger.info('Skipping non-image asset', { assetId, fileType });
      continue;
    }

    try {
      // Download original image from S3
      const getCommand = new GetObjectCommand({
        Bucket: s3Bucket,
        Key: s3Key,
      });

      const response = await s3Client.send(getCommand);
      if (!response.Body) {
        throw new Error('No image data received from S3');
      }

      // Convert stream to buffer
      const imageBuffer = await streamToBuffer(response.Body);

      logger.info('Downloaded original image', {
        assetId,
        sizeBytes: imageBuffer.length,
      });

      // Generate thumbnails for each size
      const thumbnailKeys: Record<string, string> = {};

      for (const [sizeName, dimensions] of Object.entries(THUMBNAIL_SIZES)) {
        const thumbnailBuffer = await sharp(imageBuffer)
          .resize(dimensions.width, dimensions.height, {
            fit: 'cover',
            position: 'center',
          })
          .jpeg({ quality: 85, progressive: true })
          .toBuffer();

        // Generate thumbnail S3 key
        const originalExt = s3Key.split('.').pop();
        const keyWithoutExt = s3Key.replace(`.${originalExt}`, '');
        const thumbnailKey = `${keyWithoutExt}_${sizeName}.jpg`;

        // Upload thumbnail to S3
        await s3Client.send(
          new PutObjectCommand({
            Bucket: s3Bucket,
            Key: thumbnailKey,
            Body: thumbnailBuffer,
            ContentType: 'image/jpeg',
            CacheControl: 'public, max-age=31536000', // 1 year
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

      // Update asset in database with thumbnail keys
      await prismaAssets.asset.update({
        where: { id: assetId },
        data: {
          thumbnailKey: thumbnailKeys.medium, // Primary thumbnail (medium size)
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

      // Emit asset.thumbnails_complete event to trigger AI analyzer
      try {
        await eventBridgeClient.send(
          new PutEventsCommand({
            Entries: [
              {
                Source: 'asset.processing',
                DetailType: 'asset.thumbnails_complete',
                Detail: JSON.stringify({
                  assetId,
                  brandId,
                  s3Key,
                  s3Bucket,
                  fileType,
                  thumbnailKeys,
                  timestamp: new Date().toISOString(),
                }),
                EventBusName: process.env.EVENT_BUS_NAME || 'default',
              },
            ],
          })
        );

        logger.info('Emitted asset.thumbnails_complete event', { assetId });
        metrics.addMetric('ThumbnailCompleteEventEmitted', MetricUnit.Count, 1);
      } catch (eventError) {
        logger.error('Failed to emit thumbnails_complete event', eventError as Error, {
          assetId,
        });
        // Don't fail the operation if event emission fails
        metrics.addMetric('ThumbnailCompleteEventFailed', MetricUnit.Count, 1);
      }

      metrics.addMetric('ThumbnailsGeneratedSuccess', MetricUnit.Count, 1);
    } catch (error) {
      logger.error('Failed to generate thumbnails', error as Error, {
        assetId,
        s3Key,
      });

      // Update asset processing status to failed
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

      metrics.addMetric('ThumbnailsGeneratedFailure', MetricUnit.Count, 1);
      // Don't throw - continue processing other records
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
