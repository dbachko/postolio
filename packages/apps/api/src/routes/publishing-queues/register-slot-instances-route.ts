import type { FastifyInstance } from 'fastify';

import { assertPublishingQueueAccess } from '../../services/ownership.js';
import {
  findOccupiedTime,
  SLOT_CONFLICT_WINDOW_MS,
} from '../../services/publishing-queue/occupancy.js';
import { generateSlotInstances } from '../../services/publishing-queue/slot-instance-generator.js';
import { TimezoneService } from '../../services/timezone.js';
import { normalizeSlotLaneKey, parseIsoDate, type SlotLaneKey } from '../publishing-queue-utils.js';
import { parseIntegerLimit, prisma } from './shared.js';

type SlotInstancesQuery = { laneKey?: string; limit?: string; after?: string };

function resolveSlotInstancesRequest(query: SlotInstancesQuery): {
  laneKey: SlotLaneKey | null;
  limit: number;
  after: Date;
  error?: string;
} {
  const laneKey = query.laneKey ? normalizeSlotLaneKey(query.laneKey) : null;
  if (query.laneKey && !laneKey) {
    return { laneKey: null, limit: 20, after: new Date(), error: 'invalid_lane_key' };
  }

  return {
    laneKey,
    limit: parseIntegerLimit(query.limit, 20, 100),
    after: parseIsoDate(query.after) ?? new Date(),
  };
}

function buildSlotLaneFilter(laneKey: SlotLaneKey | null) {
  if (laneKey === null) {
    return {};
  }
  if (laneKey === 'any') {
    return { laneKey: 'any' };
  }
  return { laneKey: { in: [laneKey, 'any'] } };
}

function buildOccupiedScheduleIndex(scheduled: Array<{ id: string; scheduledAt: Date | null }>) {
  const occupiedByMs = new Map<number, string>();
  const occupiedMsSorted: number[] = [];

  for (const content of scheduled) {
    if (!content.scheduledAt) {
      continue;
    }

    const ms = content.scheduledAt.getTime();
    if (!occupiedByMs.has(ms)) {
      occupiedByMs.set(ms, content.id);
    }
    occupiedMsSorted.push(ms);
  }

  occupiedMsSorted.sort((left, right) => left - right);
  return { occupiedByMs, occupiedMsSorted };
}

function mapSlotInstancesResponse(options: {
  instances: ReturnType<typeof generateSlotInstances>;
  occupiedByMs: Map<number, string>;
  occupiedMsSorted: number[];
}) {
  return options.instances.map((instance) => {
    const utcMs = instance.scheduledAtUtc.getTime();
    const occupiedMs = findOccupiedTime({
      candidateUtcMs: utcMs,
      occupiedUtcMsSorted: options.occupiedMsSorted,
      windowMs: SLOT_CONFLICT_WINDOW_MS,
    });
    const occupiedContentId =
      occupiedMs === null ? null : (options.occupiedByMs.get(occupiedMs) ?? null);

    return {
      slotId: instance.slotId,
      queueId: instance.queueId,
      laneKey: instance.laneKey,
      scheduledAt: instance.scheduledAtUtc.toISOString(),
      occupied: Boolean(occupiedContentId),
      occupiedContentId,
    };
  });
}

export function registerSlotInstancesRoute(fastify: FastifyInstance): void {
  fastify.get<{
    Params: { queueId: string };
    Querystring: SlotInstancesQuery;
  }>(
    '/queues/:queueId/slot-instances',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { queueId } = request.params;
      const queue = await assertPublishingQueueAccess(userId, queueId);

      const query = resolveSlotInstancesRequest(request.query ?? {});
      if (query.error) {
        return reply.code(400).send({ success: false, error: query.error });
      }

      const timezone = await TimezoneService.getBrandTimezone(queue.socialAccount.brandId);
      const slots = await prisma.publishingQueueSlot.findMany({
        where: { queueId: queue.id, ...buildSlotLaneFilter(query.laneKey) },
        select: { id: true, queueId: true, laneKey: true, dayOfWeek: true, localTime: true },
      });

      const instances = generateSlotInstances({
        slots: slots.map((slot) => ({
          slotId: slot.id,
          queueId: slot.queueId,
          laneKey: normalizeSlotLaneKey(slot.laneKey) || 'post',
          dayOfWeek: slot.dayOfWeek,
          localTime: slot.localTime,
        })),
        timezone,
        startAtUtc: query.after,
        limit: query.limit,
      });

      const rangeStartAt = new Date(query.after.getTime() - SLOT_CONFLICT_WINDOW_MS);
      const rangeEndAt = instances.length
        ? new Date(
            instances[instances.length - 1]!.scheduledAtUtc.getTime() + SLOT_CONFLICT_WINDOW_MS
          )
        : new Date(query.after.getTime() + 7 * 24 * 60 * 60 * 1000);

      const scheduled = await prisma.content.findMany({
        where: {
          targetSocialAccountId: queue.socialAccountId,
          scheduledAt: { gte: rangeStartAt, lte: rangeEndAt },
          status: { in: ['scheduled', 'draft', 'skipped'] },
        },
        select: { id: true, scheduledAt: true },
      });

      const occupancy = buildOccupiedScheduleIndex(scheduled);

      return reply.send({
        success: true,
        data: {
          queueId: queue.id,
          socialAccountId: queue.socialAccountId,
          timezone,
          instances: mapSlotInstancesResponse({
            instances,
            occupiedByMs: occupancy.occupiedByMs,
            occupiedMsSorted: occupancy.occupiedMsSorted,
          }),
        },
      });
    }
  );
}
