import type { FastifyInstance } from 'fastify';

import { assertPublishingQueueAccess } from '../../services/ownership.js';
import {
  isTimeOccupied,
  SLOT_CONFLICT_WINDOW_MS,
} from '../../services/publishing-queue/occupancy.js';
import { generateSlotInstances } from '../../services/publishing-queue/slot-instance-generator.js';
import { TimezoneService } from '../../services/timezone.js';
import {
  normalizeContentLaneKey,
  normalizeSlotLaneKey,
  parseIsoDate,
  type ContentLaneKey,
} from '../publishing-queue-utils.js';
import { parseIntegerLimit, prisma } from './shared.js';

type ListItemsQuery = { laneKey?: string; limit?: string; after?: string };

type QueueContent = {
  id: string;
  caption: string | null;
  status: string | null;
  scheduledAt: Date | null;
  contentType: string | null;
  mediaAssets: Array<{ assetId: string; displayOrder: number }>;
};

type QueueLaneItem = {
  id: string;
  queueId: string;
  contentId: string;
  laneKey: string;
  position: number;
  notBefore: Date | null;
  createdAt: Date;
  updatedAt: Date;
  content: QueueContent | null;
};

const CONTENT_LANES: ContentLaneKey[] = ['post', 'reel', 'story'];

function resolveListItemsRequest(query: ListItemsQuery): {
  laneKey: ContentLaneKey | null;
  limit: number;
  startAtUtc: Date;
  error?: string;
} {
  const laneKey = query.laneKey ? normalizeContentLaneKey(query.laneKey) : null;
  if (query.laneKey && !laneKey) {
    return { laneKey: null, limit: 50, startAtUtc: new Date(), error: 'invalid_lane_key' };
  }

  const after = parseIsoDate(query.after) ?? new Date();
  return {
    laneKey,
    limit: parseIntegerLimit(query.limit, 50, 200),
    startAtUtc: new Date(after.getTime() + 5 * 60 * 1000),
  };
}

function shouldHideFromQueueList(status: unknown): boolean {
  return status === 'published' || status === 'unavailable';
}

function isSkippableStatus(status: unknown): boolean {
  return (
    status === 'published' ||
    status === 'unavailable' ||
    status === 'failed' ||
    status === 'skipped'
  );
}

async function loadItemsByLane(
  queueId: string,
  limit: number
): Promise<Map<ContentLaneKey, QueueLaneItem[]>> {
  const entries = await Promise.all(
    CONTENT_LANES.map(async (laneKey) => {
      const rows = await prisma.publishingQueueItem.findMany({
        where: { queueId, laneKey },
        include: {
          content: {
            select: {
              id: true,
              caption: true,
              status: true,
              scheduledAt: true,
              contentType: true,
              mediaAssets: {
                select: { assetId: true, displayOrder: true },
                orderBy: { displayOrder: 'asc' },
              },
            },
          },
        },
        orderBy: { position: 'asc' },
        take: limit,
      });

      const filtered = rows.filter((row) => !shouldHideFromQueueList(row.content?.status));
      return [laneKey, filtered as QueueLaneItem[]] as const;
    })
  );

  return new Map(entries);
}

function toReservedMsSorted(rows: Array<{ scheduledAt: Date | null }>): number[] {
  return rows
    .map((row) => row.scheduledAt?.getTime() ?? null)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
}

function buildQueueInstances(options: {
  slots: Array<{
    id: string;
    queueId: string;
    laneKey: string;
    dayOfWeek: number;
    localTime: string;
  }>;
  timezone: string;
  startAtUtc: Date;
  reservedMsSorted: number[];
}) {
  return generateSlotInstances({
    slots: options.slots.map((slot) => ({
      slotId: slot.id,
      queueId: slot.queueId,
      laneKey: normalizeSlotLaneKey(slot.laneKey) || 'post',
      dayOfWeek: slot.dayOfWeek,
      localTime: slot.localTime,
    })),
    timezone: options.timezone,
    startAtUtc: options.startAtUtc,
    limit: 600,
  }).filter(
    (instance) =>
      !isTimeOccupied({
        candidateUtcMs: instance.scheduledAtUtc.getTime(),
        occupiedUtcMsSorted: options.reservedMsSorted,
        windowMs: SLOT_CONFLICT_WINDOW_MS,
      })
  );
}

type PeekResult = { item: QueueLaneItem; index: number } | null;

function createPeekNextEligibleItem(options: {
  itemsByLane: Map<ContentLaneKey, QueueLaneItem[]>;
  indexByLane: Map<ContentLaneKey, number>;
}) {
  return (laneKey: ContentLaneKey, scheduledAtUtc: Date): PeekResult => {
    const list = options.itemsByLane.get(laneKey) ?? [];
    if (list.length === 0) {
      return null;
    }

    let index = options.indexByLane.get(laneKey) ?? 0;
    while (index < list.length) {
      const item = list[index]!;
      const content = item.content;
      if (!content || isSkippableStatus(content.status)) {
        index += 1;
        continue;
      }

      if (item.notBefore && scheduledAtUtc.getTime() < item.notBefore.getTime()) {
        options.indexByLane.set(laneKey, index);
        return null;
      }

      options.indexByLane.set(laneKey, index);
      return { item, index };
    }

    options.indexByLane.set(laneKey, index);
    return null;
  };
}

function chooseAnyLaneItem(
  peek: (laneKey: ContentLaneKey, scheduledAtUtc: Date) => PeekResult,
  scheduledAtUtc: Date
): { laneKey: ContentLaneKey; chosen: Exclude<PeekResult, null> } | null {
  let selected: { laneKey: ContentLaneKey; chosen: Exclude<PeekResult, null> } | null = null;

  for (const laneKey of CONTENT_LANES) {
    const candidate = peek(laneKey, scheduledAtUtc);
    if (!candidate) {
      continue;
    }

    if (!selected) {
      selected = { laneKey, chosen: candidate };
      continue;
    }

    const candidateCreated = candidate.item.createdAt.getTime();
    const selectedCreated = selected.chosen.item.createdAt.getTime();
    if (candidateCreated < selectedCreated) {
      selected = { laneKey, chosen: candidate };
      continue;
    }

    if (
      candidateCreated === selectedCreated &&
      candidate.item.contentId.localeCompare(selected.chosen.item.contentId) < 0
    ) {
      selected = { laneKey, chosen: candidate };
    }
  }

  return selected;
}

function buildEstimatedByContentId(options: {
  instances: ReturnType<typeof buildQueueInstances>;
  itemsByLane: Map<ContentLaneKey, QueueLaneItem[]>;
}): Map<string, Date> {
  const estimatedByContentId = new Map<string, Date>();
  const indexByLane = new Map<ContentLaneKey, number>();
  const peek = createPeekNextEligibleItem({
    itemsByLane: options.itemsByLane,
    indexByLane,
  });

  for (const instance of options.instances) {
    if (instance.laneKey === 'any') {
      const chosen = chooseAnyLaneItem(peek, instance.scheduledAtUtc);
      if (!chosen?.chosen.item.content) {
        continue;
      }

      estimatedByContentId.set(chosen.chosen.item.content.id, instance.scheduledAtUtc);
      indexByLane.set(chosen.laneKey, chosen.chosen.index + 1);
      continue;
    }

    const laneKey = instance.laneKey as ContentLaneKey;
    const next = peek(laneKey, instance.scheduledAtUtc);
    if (!next?.item.content) {
      continue;
    }

    estimatedByContentId.set(next.item.content.id, instance.scheduledAtUtc);
    indexByLane.set(laneKey, next.index + 1);
  }

  return estimatedByContentId;
}

function mapQueueItemForResponse(
  item: QueueLaneItem,
  laneKey: ContentLaneKey,
  estimated: Date | null
) {
  const content = item.content;
  return {
    id: item.id,
    queueId: item.queueId,
    contentId: item.contentId,
    laneKey,
    position: item.position,
    notBefore: item.notBefore ? item.notBefore.toISOString() : null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    content: content
      ? {
          id: content.id,
          caption: content.caption || '',
          status: content.status,
          contentType: content.contentType,
          scheduledAt: content.scheduledAt ? content.scheduledAt.toISOString() : null,
          primaryAssetId: content.mediaAssets?.[0]?.assetId ?? null,
          mediaAssetCount: content.mediaAssets?.length ?? 0,
          mediaAssets: Array.isArray(content.mediaAssets) ? content.mediaAssets : [],
        }
      : null,
    estimatedScheduledAt: estimated ? estimated.toISOString() : null,
  };
}

export function registerListQueueItemsRoute(fastify: FastifyInstance): void {
  fastify.get<{
    Params: { queueId: string };
    Querystring: ListItemsQuery;
  }>('/queues/:queueId/items', { preHandler: fastify.authenticate }, async (request, reply) => {
    const userId = request.user!.id;
    const { queueId } = request.params;
    const queue = await assertPublishingQueueAccess(userId, queueId);

    const query = resolveListItemsRequest(request.query ?? {});
    if (query.error) {
      return reply.code(400).send({ success: false, error: query.error });
    }

    const timezone = await TimezoneService.getBrandTimezone(queue.socialAccount.brandId);

    const [itemsByLane, slots, reservedScheduled] = await Promise.all([
      loadItemsByLane(queue.id, query.limit),
      prisma.publishingQueueSlot.findMany({
        where: { queueId: queue.id },
        select: { id: true, queueId: true, laneKey: true, dayOfWeek: true, localTime: true },
        orderBy: [{ dayOfWeek: 'asc' }, { localTime: 'asc' }],
      }),
      prisma.content.findMany({
        where: {
          targetSocialAccountId: queue.socialAccountId,
          scheduledAt: { gte: query.startAtUtc },
          status: { in: ['scheduled', 'draft', 'skipped'] },
          publishingQueueItem: { is: null },
        },
        select: { scheduledAt: true },
      }),
    ]);

    const instances = buildQueueInstances({
      slots,
      timezone,
      startAtUtc: query.startAtUtc,
      reservedMsSorted: toReservedMsSorted(reservedScheduled),
    });

    const estimatedByContentId = buildEstimatedByContentId({ instances, itemsByLane });
    const lanes = query.laneKey ? [query.laneKey] : CONTENT_LANES;

    return reply.send({
      success: true,
      data: {
        queueId: queue.id,
        socialAccountId: queue.socialAccountId,
        timezone,
        lanes: lanes.map((laneKey) => {
          const items = itemsByLane.get(laneKey) ?? [];
          return {
            laneKey,
            items: items.map((item) =>
              mapQueueItemForResponse(
                item,
                laneKey,
                item.content ? (estimatedByContentId.get(item.content.id) ?? null) : null
              )
            ),
          };
        }),
      },
    });
  });
}
