import type { FastifyInstance, FastifyReply } from 'fastify';

import { contentSeriesRollingService } from '../../services/content-series-rolling.js';
import { assertBrandOwnership } from '../../services/ownership.js';
import { prisma } from './shared.js';

type CalendarParams = {
  id: string;
  month: string;
};

const calendarIncludeBase = {
  contentSeries: {
    select: { id: true, key: true, name: true, color: true, kind: true, status: true },
  },
  recipeRun: {
    select: {
      id: true,
      recipeTemplate: { select: { id: true, slug: true, name: true } },
    },
  },
  publishingQueueItem: { select: { id: true } },
  mediaAssets: {
    select: { assetId: true, displayOrder: true },
    orderBy: { displayOrder: 'asc' as const },
  },
  _count: { select: { mediaAssets: true } },
};

const calendarIncludeWithPublications = {
  ...calendarIncludeBase,
  publications: { select: { platform: true, permalink: true, publishedAt: true } },
};

function sendInvalidMonthFormat(reply: FastifyReply) {
  return reply.code(400).send({ error: 'Invalid month format. Use YYYY-MM' });
}

function parseCalendarMonth(month: string): { year: number; monthNum: number } | null {
  const [yearStr, monthStr] = month.split('-');
  if (!yearStr || !monthStr) {
    return null;
  }

  const year = Number.parseInt(yearStr, 10);
  const monthNum = Number.parseInt(monthStr, 10);
  if (!Number.isFinite(year) || !Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) {
    return null;
  }

  return { year, monthNum };
}

async function resolveCalendarMonthWindow(brandId: string, year: number, monthNum: number) {
  const { TimezoneService } = await import('../../services/timezone.js');
  const brandTimezone = await TimezoneService.getBrandTimezone(brandId);

  const monthStartStr = `${year}-${String(monthNum).padStart(2, '0')}-01`;
  const monthStart = TimezoneService.createDateInBrandTimezone(
    monthStartStr,
    '00:00',
    brandTimezone
  );

  const lastDay = new Date(year, monthNum, 0).getDate();
  const monthEndStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const monthEnd = TimezoneService.createDateInBrandTimezone(monthEndStr, '23:59', brandTimezone);

  return { monthStart, monthEnd };
}

function buildCalendarWhere(brandId: string, monthStart: Date, monthEnd: Date) {
  const whereWithoutPublications = {
    brandId,
    OR: [
      { scheduledAt: { gte: monthStart, lte: monthEnd } },
      { postedAt: { gte: monthStart, lte: monthEnd } },
    ],
  };

  const whereWithPublications = {
    ...whereWithoutPublications,
    OR: [
      ...whereWithoutPublications.OR,
      {
        publications: {
          some: { publishedAt: { gte: monthStart, lte: monthEnd } },
        },
      },
    ],
  };

  return { whereWithPublications, whereWithoutPublications };
}

async function fetchCalendarContent(params: {
  brandId: string;
  monthStart: Date;
  monthEnd: Date;
  fastifyRequest: { log: { warn: (obj: any, message: string) => void } };
}) {
  const { whereWithPublications, whereWithoutPublications } = buildCalendarWhere(
    params.brandId,
    params.monthStart,
    params.monthEnd
  );

  try {
    const content = await prisma.content.findMany({
      where: whereWithPublications,
      include: calendarIncludeWithPublications,
      orderBy: { scheduledAt: 'asc' },
    });
    return { content, hasPublications: true };
  } catch (error: any) {
    const code = error?.code || error?.meta?.code;
    if (!(code === 'P2021' || /content_publications/.test(String(error?.message || '')))) {
      throw error;
    }

    params.fastifyRequest.log.warn(
      { err: error },
      'Publications table missing; calendar will omit permalinks until migrations are applied'
    );

    const content = await prisma.content.findMany({
      where: whereWithoutPublications,
      include: calendarIncludeBase,
      orderBy: { scheduledAt: 'asc' },
    });

    return { content, hasPublications: false };
  }
}

function mapCalendarItem(item: any, hasPublications: boolean) {
  const publications = hasPublications ? item.publications || [] : [];
  const instagramPublication = hasPublications
    ? publications.find((publication: any) => publication.platform === 'instagram')
    : null;

  const permalink = hasPublications
    ? instagramPublication?.permalink || publications[0]?.permalink || null
    : null;
  const postedAt = hasPublications
    ? (item.postedAt ?? instagramPublication?.publishedAt ?? publications[0]?.publishedAt ?? null)
    : (item.postedAt ?? null);

  const mediaAssets = Array.isArray(item.mediaAssets)
    ? (item.mediaAssets as Array<{ assetId: string; displayOrder: number }>)
    : [];

  return {
    id: item.id,
    caption: item.caption,
    hashtags: item.hashtags,
    status: item.status,
    scheduledAt: item.scheduledAt,
    postedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    brandId: item.brandId,
    contentGroupId: item.contentGroupId ?? null,
    contentSeriesId: item.contentSeriesId ?? null,
    contentSeriesName: item.contentSeries?.name ?? null,
    contentSeriesColor: item.contentSeries?.color ?? null,
    contentSeriesKind: item.contentSeries?.kind ?? null,
    contentSeriesStatus: item.contentSeries?.status ?? null,
    recipeRunId: item.recipeRunId ?? item.recipeRun?.id ?? null,
    generatedByRecipe: item.recipeRun?.recipeTemplate ?? null,
    targetSocialAccountId: item.targetSocialAccountId ?? null,
    contentType: item.contentType,
    shareToFeed: item.shareToFeed ?? null,
    schedulingError: item.schedulingError ?? null,
    publishingQueueItemId: item.publishingQueueItem?.id ?? null,
    primaryAssetId: mediaAssets[0]?.assetId ?? null,
    mediaAssets,
    mediaAssetCount: item?._count?.mediaAssets ?? null,
    permalink,
    firstComment: item.firstComment ?? null,
    firstCommentStatus: item.firstCommentStatus ?? null,
    firstCommentPostedAt: item.firstCommentPostedAt ?? null,
    firstCommentError: item.firstCommentError ?? null,
  };
}

export function registerBrandCalendarRoute(fastify: FastifyInstance): void {
  fastify.get<{ Params: CalendarParams }>(
    '/:id/calendar/:month',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id: brandId, month } = request.params;

        await assertBrandOwnership(userId, brandId);

        const parsedMonth = parseCalendarMonth(month);
        if (!parsedMonth) {
          return sendInvalidMonthFormat(reply);
        }

        const { monthStart, monthEnd } = await resolveCalendarMonthWindow(
          brandId,
          parsedMonth.year,
          parsedMonth.monthNum
        );

        const { content, hasPublications } = await fetchCalendarContent({
          brandId,
          monthStart,
          monthEnd,
          fastifyRequest: request,
        });

        const placeholders = await contentSeriesRollingService
          .getBrandPlaceholders({ brandId, monthStart, monthEnd })
          .catch((error) => {
            request.log.warn({ err: error, brandId }, 'Failed to build rolling placeholders');
            return [];
          });

        return {
          success: true,
          data: {
            content: content.map((item) => mapCalendarItem(item, hasPublications)),
            placeholders,
          },
        };
      } catch (error) {
        request.log.error({ err: error }, 'Calendar content error');
        return reply.code(500).send({ error: 'Failed to retrieve calendar content' });
      }
    }
  );
}
