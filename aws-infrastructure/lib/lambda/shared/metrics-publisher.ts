/**
 * Custom Metrics Publisher for Content Scheduler
 * Provides utilities to emit business metrics to CloudWatch
 */

import { MetricUnit, Metrics } from '@aws-lambda-powertools/metrics';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'metrics-publisher' });
const metrics = new Metrics({ namespace: 'ContentScheduler' });

export interface PublishingMetrics {
  platform: string;
  contentType: string;
  success: boolean;
  latency: number;
  retryCount?: number;
  errorCode?: string;
  // Removed userId and brandId to prevent high cardinality
}

export interface SchedulingMetrics {
  contentCount: number;
  scheduledAt: Date;
  platform: string;
  // Removed userId and brandId to prevent high cardinality
}

export interface RetryMetrics {
  platform: string;
  attempt: number;
  maxAttempts: number;
  backoffDelay: number;
  errorType: string;
}

export interface PerformanceMetrics {
  operation: string;
  duration: number;
  success: boolean;
  errorType?: string;
}

export interface CostMetrics {
  operation: string;
  lambdaDuration: number;
  dynamoDbReadUnits: number;
  dynamoDbWriteUnits: number;
  secretsManagerCalls: number;
}

/**
 * Metrics publisher class for business KPIs
 */
export class MetricsPublisher {
  /**
   * Emit publishing metrics
   */
  static emitPublishingMetrics(data: PublishingMetrics): void {
    try {
      // Overall metrics
      metrics.addMetric('PublishingAttempts', MetricUnit.Count, 1);
      
      if (!data.success) {
        metrics.addMetric('PublishingFailures', MetricUnit.Count, 1);
        if (data.errorCode) {
          metrics.addDimensions({ ErrorCode: data.errorCode });
        }
      } else {
        metrics.addMetric('PostsPublished', MetricUnit.Count, 1);
      }

      // Platform-specific metrics
      metrics.addDimensions({ Platform: data.platform });
      metrics.addMetric('PublishingAttempts', MetricUnit.Count, 1);
      
      if (!data.success) {
        metrics.addMetric('PublishingFailures', MetricUnit.Count, 1);
      }

      // Latency metrics
      metrics.addMetric('PublishingLatency', MetricUnit.Milliseconds, data.latency);
      metrics.addDimensions({ Platform: data.platform });

      // Content type metrics
      metrics.addDimensions({ ContentType: data.contentType });
      metrics.addMetric('PostsPublished', MetricUnit.Count, 1);

      // Retry metrics
      if (data.retryCount && data.retryCount > 0) {
        metrics.addMetric('PublishingRetries', MetricUnit.Count, data.retryCount);
        metrics.addDimensions({ Platform: data.platform });
      }

      // User and brand dimensions removed to prevent high cardinality
      // High cardinality dimensions can cause CloudWatch cost explosion

      logger.info('Publishing metrics emitted', { data });
    } catch (error) {
      logger.error('Failed to emit publishing metrics', { error });
    } finally {
      metrics.clearDimensions();
    }
  }

  /**
   * Emit scheduling metrics
   */
  static emitSchedulingMetrics(data: SchedulingMetrics): void {
    try {
      metrics.addMetric('PostsScheduled', MetricUnit.Count, data.contentCount);
      metrics.addDimensions({ Platform: data.platform });

      // Calculate scheduling latency (time until scheduled)
      const now = new Date();
      const latency = data.scheduledAt.getTime() - now.getTime();
      metrics.addMetric('SchedulingLatency', MetricUnit.Milliseconds, Math.max(0, latency));

      // User and brand dimensions removed to prevent high cardinality
      // High cardinality dimensions can cause CloudWatch cost explosion

      logger.info('Scheduling metrics emitted', { data });
    } catch (error) {
      logger.error('Failed to emit scheduling metrics', { error });
    } finally {
      metrics.clearDimensions();
    }
  }

  /**
   * Emit retry metrics
   */
  static emitRetryMetrics(data: RetryMetrics): void {
    try {
      metrics.addMetric('RetryAttempts', MetricUnit.Count, 1);
      metrics.addDimensions({ 
        Platform: data.platform,
        ErrorType: data.errorType,
      });

      // Track retry queue depth
      if (data.attempt === 1) {
        metrics.addMetric('RetryQueueEntries', MetricUnit.Count, 1);
      }

      // Track backoff delay
      metrics.addMetric('RetryBackoffDelay', MetricUnit.Milliseconds, data.backoffDelay);

      // Track exhausted retries
      if (data.attempt >= data.maxAttempts) {
        metrics.addMetric('RetryExhausted', MetricUnit.Count, 1);
        metrics.addDimensions({ Platform: data.platform });
      }

      logger.info('Retry metrics emitted', { data });
    } catch (error) {
      logger.error('Failed to emit retry metrics', { error });
    } finally {
      metrics.clearDimensions();
    }
  }

  /**
   * Emit performance metrics
   */
  static emitPerformanceMetrics(data: PerformanceMetrics): void {
    try {
      metrics.addDimensions({ Operation: data.operation });
      
      // Operation duration
      metrics.addMetric('OperationDuration', MetricUnit.Milliseconds, data.duration);
      
      // Success/failure tracking
      if (data.success) {
        metrics.addMetric('OperationSuccess', MetricUnit.Count, 1);
      } else {
        metrics.addMetric('OperationFailure', MetricUnit.Count, 1);
        if (data.errorType) {
          metrics.addDimensions({ ErrorType: data.errorType });
        }
      }

      // API response time (if it's an API operation)
      if (data.operation.startsWith('API')) {
        metrics.addMetric('APIResponseTime', MetricUnit.Milliseconds, data.duration);
      }

      logger.info('Performance metrics emitted', { data });
    } catch (error) {
      logger.error('Failed to emit performance metrics', { error });
    } finally {
      metrics.clearDimensions();
    }
  }

  /**
   * Emit cost metrics
   */
  static emitCostMetrics(data: CostMetrics): void {
    try {
      // Lambda cost estimation (based on duration)
      const lambdaCost = (data.lambdaDuration / 1000) * 0.0000166667; // Cost per GB-second
      metrics.addMetric('EstimatedLambdaCost', MetricUnit.None, lambdaCost);
      metrics.addDimensions({ Operation: data.operation });

      // DynamoDB cost estimation
      const dynamoReadCost = data.dynamoDbReadUnits * 0.00013; // Cost per RCU
      const dynamoWriteCost = data.dynamoDbWriteUnits * 0.00065; // Cost per WCU
      metrics.addMetric('EstimatedDynamoCost', MetricUnit.None, dynamoReadCost + dynamoWriteCost);

      // Secrets Manager cost estimation
      const secretsCost = data.secretsManagerCalls * 0.00004; // Cost per API call
      metrics.addMetric('EstimatedSecretsCost', MetricUnit.None, secretsCost);

      // Total cost
      const totalCost = lambdaCost + dynamoReadCost + dynamoWriteCost + secretsCost;
      metrics.addMetric('EstimatedTotalCost', MetricUnit.None, totalCost);

      logger.info('Cost metrics emitted', { data, totalCost });
    } catch (error) {
      logger.error('Failed to emit cost metrics', { error });
    } finally {
      metrics.clearDimensions();
    }
  }

  /**
   * Emit retry queue depth metric
   */
  static async emitRetryQueueDepth(depth: number): Promise<void> {
    try {
      metrics.addMetric('RetryQueueDepth', MetricUnit.Count, depth);
      logger.info('Retry queue depth emitted', { depth });
    } catch (error) {
      logger.error('Failed to emit retry queue depth', { error });
    }
  }

  /**
   * Emit SLA metrics
   */
  static emitSLAMetrics(successRate: number, availability: number): void {
    try {
      metrics.addMetric('SLASuccessRate', MetricUnit.Percent, successRate);
      metrics.addMetric('SLAAvailability', MetricUnit.Percent, availability);
      
      // Check SLA compliance
      if (successRate < 99.99) {
        metrics.addMetric('SLABreachSuccessRate', MetricUnit.Count, 1);
      }
      if (availability < 99.99) {
        metrics.addMetric('SLABreachAvailability', MetricUnit.Count, 1);
      }

      logger.info('SLA metrics emitted', { successRate, availability });
    } catch (error) {
      logger.error('Failed to emit SLA metrics', { error });
    }
  }

  /**
   * Emit video processing metrics
   */
  static emitVideoProcessingMetrics(
    platform: string, 
    duration: number, 
    videoSize: number,
    success: boolean
  ): void {
    try {
      metrics.addDimensions({ Platform: platform });
      metrics.addMetric('VideoProcessingTime', MetricUnit.Milliseconds, duration);
      metrics.addMetric('VideoSize', MetricUnit.Bytes, videoSize);
      
      if (success) {
        metrics.addMetric('VideoProcessingSuccess', MetricUnit.Count, 1);
      } else {
        metrics.addMetric('VideoProcessingFailure', MetricUnit.Count, 1);
      }

      // Calculate processing speed (MB/s)
      const processingSpeed = (videoSize / (1024 * 1024)) / (duration / 1000);
      metrics.addMetric('VideoProcessingSpeed', MetricUnit.None, processingSpeed);

      logger.info('Video processing metrics emitted', { 
        platform, 
        duration, 
        videoSize, 
        success,
        processingSpeed 
      });
    } catch (error) {
      logger.error('Failed to emit video processing metrics', { error });
    } finally {
      metrics.clearDimensions();
    }
  }

  /**
   * Flush metrics to CloudWatch
   */
  static async flush(): Promise<void> {
    try {
      await metrics.flush();
      logger.info('Metrics flushed to CloudWatch');
    } catch (error) {
      logger.error('Failed to flush metrics', { error });
    }
  }
}