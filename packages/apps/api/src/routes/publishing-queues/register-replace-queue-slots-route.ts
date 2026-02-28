import type { FastifyInstance } from 'fastify';

import { assertPublishingQueueAccess } from '../../services/ownership.js';
import { publishingQueueScheduler } from '../../services/publishing-queue/queue-scheduler.js';
import { type SlotLaneKey, normalizeSlotLaneKey } from '../publishing-queue-utils.js';
import { isUniqueConstraintError, prisma } from './shared.js';

type RawSlotRecord = Record<string, unknown>;

type NormalizedSlot = {
  dayOfWeek: number;
  localTime: string;
  laneKey: SlotLaneKey;
};

function normalizeSlots(rawSlots: unknown): { error?: string; slots: NormalizedSlot[] } {
  if (!Array.isArray(rawSlots)) {
    return { error: 'invalid_slots', slots: [] };
  }

  const nextSlots: NormalizedSlot[] = [];
  for (const raw of rawSlots) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { error: 'invalid_slot', slots: [] };
    }

    const record = raw as RawSlotRecord;
    const dayOfWeek = typeof record.dayOfWeek === 'number' ? record.dayOfWeek : Number.NaN;
    const localTime = typeof record.localTime === 'string' ? record.localTime.trim() : '';
    const laneKey = normalizeSlotLaneKey(record.laneKey);

    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return { error: 'invalid_day_of_week', slots: [] };
    }
    if (!/^\d{2}:\d{2}$/.test(localTime)) {
      return { error: 'invalid_local_time', slots: [] };
    }
    if (!laneKey) {
      return { error: 'invalid_lane_key', slots: [] };
    }

    nextSlots.push({ dayOfWeek, localTime, laneKey });
  }

  return { slots: nextSlots };
}

async function replaceQueueSlots(
  queue: Awaited<ReturnType<typeof assertPublishingQueueAccess>>,
  nextSlots: NormalizedSlot[]
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.publishingQueueSlot.deleteMany({ where: { queueId: queue.id } });

    if (nextSlots.length > 0) {
      await tx.publishingQueueSlot.createMany({
        data: nextSlots.map((slot) => ({
          queueId: queue.id,
          socialAccountId: queue.socialAccountId,
          dayOfWeek: slot.dayOfWeek,
          localTime: slot.localTime,
          laneKey: slot.laneKey,
          enabled: true,
        })),
      });
    }
  });
}

export function registerReplaceQueueSlotsRoute(fastify: FastifyInstance): void {
  fastify.put<{
    Params: { queueId: string };
    Body: { slots?: unknown };
  }>('/queues/:queueId/slots', { preHandler: fastify.authenticate }, async (request, reply) => {
    const userId = request.user!.id;
    const { queueId } = request.params;
    const queue = await assertPublishingQueueAccess(userId, queueId);

    const parsed = normalizeSlots(request.body?.slots);
    if (parsed.error) {
      return reply.code(400).send({ success: false, error: parsed.error });
    }

    try {
      await replaceQueueSlots(queue, parsed.slots);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply.code(409).send({ success: false, error: 'slot_conflict' });
      }
      request.log.error({ err: error }, 'Failed to update queue slots');
      return reply.code(500).send({ success: false, error: 'failed_to_update_slots' });
    }

    await publishingQueueScheduler.recomputeBrandWindow(queue.socialAccount.brandId);
    return reply.send({ success: true });
  });
}
