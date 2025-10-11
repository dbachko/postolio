import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
// Tracer temporarily disabled to simplify runtime path
import type { EventBridgeEvent } from 'aws-lambda';
import { BrandAnalysisOrchestrator } from './orchestrator';
import { publishCompleted, publishFailed } from './events/publish';

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

export async function handler(
  event: EventBridgeEvent<'brand.analysis.requested', RequestDetail>
): Promise<void> {
  // Fallback console for environments where logger output is muted
  console.log('Brand Analysis service invoked');
  logger.info('Brand Analysis service invoked', {
    detailType: event['detail-type'],
    source: event.source,
  });
  metrics.addMetric('Invocations', MetricUnit.Count, 1);
  // Tracer annotation disabled

  if (event['detail-type'] !== 'brand.analysis.requested' || event.source !== 'postolio.brand') {
    logger.warn('Ignoring unsupported event', {
      detailType: event['detail-type'],
      source: event.source,
    });
    return;
  }

  const { brandId, options, posts } = event.detail || ({} as RequestDetail);
  if (!brandId) {
    logger.error('Missing brandId in event detail');
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
}
