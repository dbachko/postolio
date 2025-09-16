import {
  CloudWatchClient,
  PutMetricDataCommand,
  type MetricDatum,
} from '@aws-sdk/client-cloudwatch';
import { FastifyInstance } from 'fastify';

export class ImageMonitoringService {
  private cloudWatchClient: CloudWatchClient;
  private app: FastifyInstance;
  private namespace: string = 'Postolio/Images';
  private metricsBuffer: MetricDatum[] = [];
  private flushInterval: NodeJS.Timeout | null = null;

  constructor(app: FastifyInstance) {
    this.app = app;

    const credentials = process.env.AWS_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        }
      : undefined;

    this.cloudWatchClient = new CloudWatchClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(credentials && { credentials }),
    });

    // Start periodic flush of metrics
    this.startMetricsFlush();
  }

  /**
   * Start periodic flush of buffered metrics
   */
  private startMetricsFlush() {
    // Flush metrics every 60 seconds
    this.flushInterval = setInterval(() => {
      this.flushMetrics();
    }, 60000);
  }

  /**
   * Track image upload to S3
   */
  async trackImageUpload(
    sizeBytes: number,
    processingTimeMs: number,
    source: 'dalle3' | 'midjourney'
  ) {
    this.metricsBuffer.push(
      {
        MetricName: 'ImageUploads',
        Value: 1,
        Unit: 'Count',
        Timestamp: new Date(),
        Dimensions: [
          { Name: 'Source', Value: source },
          { Name: 'Environment', Value: process.env.NODE_ENV || 'dev' },
        ],
      },
      {
        MetricName: 'ImageSizeBytes',
        Value: sizeBytes,
        Unit: 'Bytes',
        Timestamp: new Date(),
        Dimensions: [{ Name: 'Source', Value: source }],
      },
      {
        MetricName: 'ProcessingTimeMs',
        Value: processingTimeMs,
        Unit: 'Milliseconds',
        Timestamp: new Date(),
        Dimensions: [{ Name: 'Operation', Value: 'Upload' }],
      }
    );

    // Flush if buffer is getting large
    if (this.metricsBuffer.length >= 20) {
      await this.flushMetrics();
    }
  }

  /**
   * Track image deletion
   */
  async trackImageDeletion(reason: 'user' | 'retention' | 'gdpr') {
    this.metricsBuffer.push({
      MetricName: 'ImageDeletions',
      Value: 1,
      Unit: 'Count',
      Timestamp: new Date(),
      Dimensions: [
        { Name: 'Reason', Value: reason },
        { Name: 'Environment', Value: process.env.NODE_ENV || 'dev' },
      ],
    });
  }

  /**
   * Track CDN cache hit/miss
   */
  async trackCDNPerformance(hitRate: number, responseTimeMs: number) {
    this.metricsBuffer.push(
      {
        MetricName: 'CDNCacheHitRate',
        Value: hitRate,
        Unit: 'Percent',
        Timestamp: new Date(),
      },
      {
        MetricName: 'CDNResponseTime',
        Value: responseTimeMs,
        Unit: 'Milliseconds',
        Timestamp: new Date(),
      }
    );
  }

  /**
   * Track storage costs
   */
  async trackStorageCosts(totalSizeGB: number, estimatedMonthlyCost: number) {
    this.metricsBuffer.push(
      {
        MetricName: 'TotalStorageGB',
        Value: totalSizeGB,
        Unit: 'Gigabytes',
        Timestamp: new Date(),
      },
      {
        MetricName: 'EstimatedMonthlyCost',
        Value: estimatedMonthlyCost,
        Unit: 'None', // USD
        Timestamp: new Date(),
        Dimensions: [{ Name: 'CostType', Value: 'Storage' }],
      }
    );
  }

  /**
   * Track API errors
   */
  async trackError(operation: string, errorType: string) {
    this.metricsBuffer.push({
      MetricName: 'ImageOperationErrors',
      Value: 1,
      Unit: 'Count',
      Timestamp: new Date(),
      Dimensions: [
        { Name: 'Operation', Value: operation },
        { Name: 'ErrorType', Value: errorType },
      ],
    });
  }

  /**
   * Flush buffered metrics to CloudWatch
   */
  private async flushMetrics() {
    if (this.metricsBuffer.length === 0) return;

    // Don't send metrics in development unless explicitly enabled
    if (process.env.NODE_ENV !== 'prod' && process.env.ENABLE_CLOUDWATCH !== 'true') {
      this.app.log.debug(`Would send ${this.metricsBuffer.length} metrics to CloudWatch`);
      this.metricsBuffer = [];
      return;
    }

    try {
      // CloudWatch accepts max 20 metrics per request
      const chunks = [];
      for (let i = 0; i < this.metricsBuffer.length; i += 20) {
        chunks.push(this.metricsBuffer.slice(i, i + 20));
      }

      for (const chunk of chunks) {
        const command = new PutMetricDataCommand({
          Namespace: this.namespace,
          MetricData: chunk,
        });
        await this.cloudWatchClient.send(command);
      }

      this.app.log.info(`Sent ${this.metricsBuffer.length} metrics to CloudWatch`);
      this.metricsBuffer = [];
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      this.app.log.error({ error: message }, 'Failed to send metrics to CloudWatch');
      // Keep metrics in buffer for retry
      if (this.metricsBuffer.length > 100) {
        // Prevent memory issues by clearing old metrics
        this.metricsBuffer = this.metricsBuffer.slice(-50);
      }
    }
  }

  /**
   * Get image storage statistics from database
   */
  async getStorageStats() {
    const { PrismaClient } = await import('@postolio/database');
    const prisma = new PrismaClient();

    try {
      const totalImages = await prisma.content.count({
        where: {
          s3ImageKey: {
            not: null,
          },
        },
      });

      const imagesBySource = await prisma.$queryRaw<Array<{ source: string; count: bigint }>>`
        SELECT 
          CASE 
            WHEN image_url LIKE '%dalle%' THEN 'dalle3'
            WHEN image_url LIKE '%midjourney%' THEN 'midjourney'
            ELSE 'unknown'
          END as source,
          COUNT(*) as count
        FROM content
        WHERE s3_image_key IS NOT NULL
        GROUP BY source
      `;

      const imagesByRegion = await prisma.content.groupBy({
        by: ['imageRegion'],
        where: {
          s3ImageKey: {
            not: null,
          },
        },
        _count: true,
      });

      const expiringWithin30Days = await prisma.content.count({
        where: {
          retentionExpiresAt: {
            lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            gte: new Date(),
          },
          s3ImageKey: {
            not: null,
          },
        },
      });

      // Estimate storage size (assuming average 1MB per image)
      const estimatedStorageGB = totalImages / 1000;
      const estimatedMonthlyCost = estimatedStorageGB * 0.023; // S3 Standard pricing

      await prisma.$disconnect();

      return {
        totalImages,
        imagesBySource: imagesBySource.map((item) => ({
          source: item.source,
          count: Number(item.count),
        })),
        imagesByRegion,
        expiringWithin30Days,
        estimatedStorageGB,
        estimatedMonthlyCost,
      };
    } catch (error: unknown) {
      await prisma.$disconnect();
      throw error;
    }
  }

  /**
   * Create CloudWatch dashboard (run once)
   */
  async createDashboard() {
    // This would create a CloudWatch dashboard programmatically
    // For now, it's a placeholder that logs the dashboard JSON
    const dashboardBody = {
      widgets: [
        {
          type: 'metric',
          properties: {
            metrics: [
              ['Postolio/Images', 'ImageUploads', { stat: 'Sum' }],
              ['.', 'ImageDeletions', { stat: 'Sum' }],
            ],
            period: 300,
            stat: 'Sum',
            region: process.env.AWS_REGION || 'us-east-1',
            title: 'Image Operations',
          },
        },
        {
          type: 'metric',
          properties: {
            metrics: [['Postolio/Images', 'ProcessingTimeMs', { stat: 'Average' }]],
            period: 300,
            stat: 'Average',
            region: process.env.AWS_REGION || 'us-east-1',
            title: 'Processing Performance',
          },
        },
        {
          type: 'metric',
          properties: {
            metrics: [
              ['Postolio/Images', 'TotalStorageGB'],
              ['.', 'EstimatedMonthlyCost'],
            ],
            period: 3600,
            stat: 'Average',
            region: process.env.AWS_REGION || 'us-east-1',
            title: 'Storage & Costs',
          },
        },
      ],
    };

    this.app.log.info(
      { dashboardBody: JSON.stringify(dashboardBody, null, 2) },
      'CloudWatch Dashboard JSON:'
    );
    return dashboardBody;
  }

  /**
   * Cleanup on shutdown
   */
  async shutdown() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this.flushMetrics();
  }
}

// Singleton instance
let imageMonitoring: ImageMonitoringService | null = null;

export function getImageMonitoring(app: FastifyInstance): ImageMonitoringService {
  if (!imageMonitoring) {
    imageMonitoring = new ImageMonitoringService(app);
  }
  return imageMonitoring;
}
