import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
// Tracer temporarily disabled to simplify runtime path
import type { EventBridgeEvent } from 'aws-lambda';
import { BrandAnalysisOrchestrator } from './orchestrator';
import { publishCompleted, publishFailed } from './events/publish';
import { LearningRepository } from './dynamo/learning-repo';
import { EventBridge } from '@aws-sdk/client-eventbridge';

const logger = new Logger({ serviceName: 'brand-analysis' });
const metrics = new Metrics({ namespace: 'BrandAnalysis', serviceName: 'brand-analysis' });
// const tracer = new Tracer({ serviceName: 'brand-analysis' });

export interface BrandAnalysisRequestedEvent {
  'detail-type': 'brand.analysis.requested';
  source: 'postolio.brand';
  detail: {
    brandId: string;
    requestedBy?: string;
    options?: Record<string, unknown>;
  };
}

type RequestDetail = {
  brandId: string;
  requestedBy?: string;
  options?: Record<string, unknown>;
  posts?: Array<{
    id: string;
    caption?: string;
    hashtags?: string[];
    timestamp?: string;
    like_count?: number;
    comments_count?: number;
    media_type?: string;
  }>;
};

export async function handler(event: EventBridgeEvent<string, any>): Promise<void> {
  // Fallback console for environments where logger output is muted
  console.log('Brand Analysis service invoked');
  logger.info('Brand Analysis service invoked', {
    detailType: event['detail-type'],
    source: event.source,
  });
  metrics.addMetric('Invocations', MetricUnit.Count, 1);
  // Tracer annotation disabled

  // Route by detail-type
  const detailType = event['detail-type'];
  const source = event.source;
  if (detailType === 'brand.analysis.requested' && source === 'postolio.brand') {
    const { brandId, options, posts } = (event.detail || {}) as RequestDetail;
    if (!brandId) {
      logger.error('Missing brandId in analysis.requested detail');
      return;
    }
    const orchestrator = new BrandAnalysisOrchestrator();
    try {
      const { jobId, profile } = await orchestrator.runBrandAnalysis(
        brandId,
        options as Record<string, unknown> | undefined,
        posts
      );
      if (!profile) {
        logger.info('Brand analysis already running; reused existing job', { brandId, jobId });
        return;
      }
      await publishCompleted({
        brandId,
        profileId: `${brandId}#${profile.version}`,
        profileVersion: profile.version,
        createdAt: profile.createdAt,
      });
      logger.info('Brand analysis completed', { brandId, jobId, version: profile.version });
      metrics.addMetric('ProfilesGenerated', MetricUnit.Count, 1);
    } catch (err) {
      logger.error('Brand analysis failed', { brandId, err });
      metrics.addMetric('AnalysisFailures', MetricUnit.Count, 1);
      await publishFailed({ brandId, jobId: 'unknown', errorMessage: (err as Error).message });
    }
    return;
  }

  if (detailType === 'brand.learning.applied' && source === 'postolio.brand') {
    const learning = event.detail as {
      brandId?: string;
      insights?: Array<{
        pattern: string;
        confidence: number;
        category: string;
        recommendation?: string;
      }>;
      profileUpdates?: Array<{
        field: string;
        newValue: unknown;
        confidence?: number;
        reasoning?: string;
      }>;
      appliedToFuturePosts?: number;
      editAnalysis?: unknown;
      triggeredBy?: { userId?: string; contentId?: string };
    };
    const brandId = learning?.brandId;
    if (!brandId) {
      logger.warn('Learning event missing brandId');
      return;
    }
    try {
      // Store learning signal
      const repo = new LearningRepository();
      const { id } = await repo.putSignal(brandId, {
        insights: learning.insights,
        profileUpdates: learning.profileUpdates,
        appliedToFuturePosts: learning.appliedToFuturePosts,
        editAnalysis: learning.editAnalysis,
        triggeredBy: learning.triggeredBy,
      });
      metrics.addMetric('LearningSignalsStored', MetricUnit.Count, 1);
      logger.info('Stored learning signal', { brandId, id });

      // Optionally trigger a fresh analysis to incorporate latest content
      const eb = new EventBridge({});
      await eb.putEvents({
        Entries: [
          {
            Source: 'postolio.brand',
            DetailType: 'brand.analysis.requested',
            EventBusName: process.env.EVENT_BUS_NAME || 'default',
            Detail: JSON.stringify({
              brandId,
              options: { force: false, reason: 'learning_applied' },
            }),
          },
        ],
      });
      logger.info('Triggered brand.analysis.requested due to learning signal', { brandId });
      metrics.addMetric('LearningTriggeredAnalysis', MetricUnit.Count, 1);
    } catch (err) {
      logger.error('Failed processing learning event', { brandId, err });
    }
    return;
  }

  logger.warn('Ignoring unsupported event', {
    detailType,
    source,
  });
}
