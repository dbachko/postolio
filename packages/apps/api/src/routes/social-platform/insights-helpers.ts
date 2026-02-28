import type { PlatformName } from '@postolio/connectors';

import { prisma } from '../../config/database.js';
import { ConnectorFactory } from '../../services/connectors/index.js';
import { fetchTokensForSocialAccountFromService } from '../../utils/token-service-client.js';
import { SocialRouteReplyError } from './shared.js';

function normalizeLatestMetrics(latest: any) {
  return {
    impressions: latest.impressions || 0,
    reach: latest.reach || 0,
    engagement: latest.engagement || 0,
    likes: latest.likes || 0,
    comments: latest.comments || 0,
    saves: latest.saves || 0,
    shares: latest.shares || 0,
    videoViews: latest.videoViews || 0,
    engagementRate: latest.engagementRate != null ? Number(latest.engagementRate) : undefined,
  };
}

export async function resolveInsightsPublication(params: { contentId: string; platform: string }) {
  const content = await prisma.content.findUnique({
    where: { id: params.contentId },
    include: { brand: true },
  });
  if (!content) {
    throw new SocialRouteReplyError(404, {
      error: 'content_not_found',
      message: `Content ${params.contentId} not found`,
    });
  }

  const publications = (await prisma.contentPublication.findMany({
    where: {
      contentId: params.contentId,
      platform: params.platform as any,
    },
    include: {
      metricsLatest: true,
      socialAccount: {
        include: { brand: true },
      },
    },
  })) as any[];

  const publication = publications[0];
  if (!publication) {
    throw new SocialRouteReplyError(404, {
      error: 'content not published',
      message: `Content ${params.contentId} is not published on ${params.platform}`,
    });
  }

  return { publication };
}

export function buildInsightsFromLatestMetrics(params: {
  latest: any;
  platform: string;
  contentId: string;
  externalPostId: string;
}) {
  if (!params.latest) {
    return null;
  }

  return {
    success: true,
    platform: params.platform,
    contentId: params.contentId,
    externalPostId: params.externalPostId,
    insights: normalizeLatestMetrics(params.latest),
    asOf: params.latest.lastUpdated ?? null,
  };
}

export async function fetchLiveInsights(params: {
  publication: any;
  platform: string;
  contentId: string;
}) {
  const connector = ConnectorFactory.get(params.platform as PlatformName);
  const tokens = await fetchTokensForSocialAccountFromService(
    params.publication.socialAccount.brand.userId,
    params.publication.socialAccount.brandId,
    params.platform,
    params.publication.socialAccountId
  );
  if (!tokens?.accessToken) {
    throw new SocialRouteReplyError(401, {
      error: 'invalid_credentials',
      message: `No valid credentials found for ${params.platform}`,
    });
  }

  const rawInsights = await connector.getMediaInsights(
    {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    },
    {
      platform: params.platform as PlatformName,
      externalAccountId: params.publication.socialAccount.externalAccountId,
      externalPageId: params.publication.socialAccount.externalPageId,
      username: params.publication.socialAccount.username,
    },
    params.publication.externalPostId
  );

  const insights = (rawInsights as any)?.metrics ?? rawInsights;
  return {
    success: true,
    platform: params.platform,
    contentId: params.contentId,
    externalPostId: params.publication.externalPostId,
    insights,
    asOf: (rawInsights as any)?.asOf,
  };
}
