import type { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@postolio/database';

import { getDatabaseClient } from '../config/database.js';
import { assertPublishingQueueAccess, assertSocialAccountAccess } from '../services/ownership.js';
import { TimezoneService } from '../services/timezone.js';
import {
  findOccupiedTime,
  isTimeOccupied,
  SLOT_CONFLICT_WINDOW_MS,
} from '../services/publishing-queue/occupancy.js';
import { generateSlotInstances } from '../services/publishing-queue/slot-instance-generator.js';
import { publishingQueueScheduler } from '../services/publishing-queue/queue-scheduler.js';
import { validateQueueableContent } from '../services/publishing-queue/queue-content-validation.js';
import {
  buildGoalBasedSlots,
  ensureDefaultQueueWithStarterSchedule,
  parsePostsPerWeek,
} from '../services/publishing-queue/default-schedule.js';
import { schedulerService } from '../services/scheduler.js';
import { getMaxQueueDepthForTier } from '../constants/subscription.js';
import { getStatusBroadcaster } from '../services/broadcast-registry.js';
import {
  type ContentLaneKey,
  type SlotLaneKey,
  normalizeContentLaneKey,
  normalizeName,
  normalizeSlotLaneKey,
  parseIsoDate,
} from './publishing-queue-utils.js';

const prisma = getDatabaseClient();

const publishingQueuesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/social-accounts/:socialAccountId/queues
  fastify.get<{ Params: { socialAccountId: string } }>(
    '/social-accounts/:socialAccountId/queues',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { socialAccountId } = request.params;

      await assertSocialAccountAccess(userId, socialAccountId);

      const tier =
        typeof (request.user as any)?.subscriptionTier === 'string'
          ? String((request.user as any).subscriptionTier)
          : await (prisma as any)?.user
              ?.findUnique?.({
                where: { id: userId },
                select: { subscriptionTier: true },
              })
              .then((u: any) => u?.subscriptionTier || 'free')
              .catch(() => 'free');
      const maxDepthRaw = getMaxQueueDepthForTier(tier);
      const queueDepthMax = Number.isFinite(maxDepthRaw) ? maxDepthRaw : null;
      const queueDepthCurrent = await prisma.publishingQueueItem.count({
        where: {
          queue: { socialAccountId },
          content: { status: { notIn: ['published', 'unavailable'] } },
        },
      });

      const listSelect: Prisma.PublishingQueueSelect = {
        id: true,
        socialAccountId: true,
        name: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { slots: true, items: true },
        },
      };

      const listOrderBy: Prisma.PublishingQueueOrderByWithRelationInput[] = [
        { isDefault: 'desc' },
        { createdAt: 'asc' },
      ];

      let queues = await prisma.publishingQueue.findMany({
        where: { socialAccountId },
        select: listSelect,
        orderBy: listOrderBy,
      });

      if (queues.length === 0) {
        try {
          await ensureDefaultQueueWithStarterSchedule(prisma, socialAccountId);
          queues = await prisma.publishingQueue.findMany({
            where: { socialAccountId },
            select: listSelect,
            orderBy: listOrderBy,
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            queues = await prisma.publishingQueue.findMany({
              where: { socialAccountId },
              select: listSelect,
              orderBy: listOrderBy,
            });
          } else {
            throw error;
          }
        }
      }

      return reply.send({
        success: true,
        data: {
          socialAccountId,
          queueDepthCurrent,
          queueDepthMax,
          queues: queues.map((q) => ({
            id: q.id,
            name: q.name,
            isDefault: q.isDefault,
            slotCount: q._count.slots,
            itemCount: q._count.items,
            createdAt: q.createdAt,
            updatedAt: q.updatedAt,
          })),
        },
      });
    }
  );

  // POST /api/social-accounts/:socialAccountId/queues
  fastify.post<{ Params: { socialAccountId: string }; Body: { name?: unknown } }>(
    '/social-accounts/:socialAccountId/queues',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { socialAccountId } = request.params;
      const name = normalizeName(request.body?.name);
      if (!name) {
        return reply.code(400).send({ success: false, error: 'invalid_queue_name' });
      }

      await assertSocialAccountAccess(userId, socialAccountId);

      try {
        const defaultQueueCount = await prisma.publishingQueue.count({
          where: { socialAccountId, isDefault: true },
        });

        const created = await prisma.publishingQueue.create({
          data: {
            socialAccountId,
            name,
            isDefault: defaultQueueCount === 0,
          },
          select: {
            id: true,
            name: true,
            isDefault: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        return reply.send({ success: true, data: created });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return reply.code(409).send({ success: false, error: 'queue_name_taken' });
        }
        request.log.error({ err: error }, 'Failed to create publishing queue');
        return reply.code(500).send({ success: false, error: 'failed_to_create_queue' });
      }
    }
  );

  // PUT /api/queues/:queueId
  fastify.put<{
    Params: { queueId: string };
    Body: { name?: unknown; isDefault?: unknown };
  }>('/queues/:queueId', { preHandler: fastify.authenticate }, async (request, reply) => {
    const userId = request.user!.id;
    const { queueId } = request.params;
    const queue = await assertPublishingQueueAccess(userId, queueId);

    const name = request.body?.name === undefined ? undefined : normalizeName(request.body?.name);
    const isDefault =
      request.body?.isDefault === undefined ? undefined : Boolean(request.body?.isDefault);

    if (isDefault === false && queue.isDefault) {
      return reply.code(400).send({ success: false, error: 'cannot_unset_default_queue' });
    }

    if (name === null) {
      return reply.code(400).send({ success: false, error: 'invalid_queue_name' });
    }

    try {
      const makingDefault = isDefault === true;

      const { updated, unsetDefaultSiblingCount } = await prisma.$transaction(async (tx) => {
        let unsetDefaultSiblings = 0;

        if (makingDefault) {
          const unsetDefaultResult = await tx.publishingQueue.updateMany({
            where: {
              socialAccountId: queue.socialAccountId,
              id: { not: queue.id },
              isDefault: true,
            },
            data: { isDefault: false },
          });
          unsetDefaultSiblings = unsetDefaultResult.count;
        }

        const updatedQueue = await tx.publishingQueue.update({
          where: { id: queue.id },
          data: {
            ...(name !== undefined ? { name } : {}),
            ...(isDefault !== undefined ? { isDefault } : {}),
          },
          select: {
            id: true,
            name: true,
            isDefault: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        return {
          updated: updatedQueue,
          unsetDefaultSiblingCount: unsetDefaultSiblings,
        };
      });

      const defaultChanged = makingDefault && !queue.isDefault;
      const recompute =
        defaultChanged || unsetDefaultSiblingCount > 0
          ? await publishingQueueScheduler.recomputeBrandWindow(queue.socialAccount.brandId)
          : null;

      return reply.send({ success: true, data: { ...updated, recompute } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.code(409).send({ success: false, error: 'queue_name_taken' });
      }
      request.log.error({ err: error }, 'Failed to update publishing queue');
      return reply.code(500).send({ success: false, error: 'failed_to_update_queue' });
    }
  });

  // DELETE /api/queues/:queueId
  fastify.delete<{ Params: { queueId: string } }>(
    '/queues/:queueId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { queueId } = request.params;
      const queue = await assertPublishingQueueAccess(userId, queueId);

      if (queue.isDefault) {
        return reply.code(400).send({ success: false, error: 'cannot_delete_default_queue' });
      }

      try {
        const moved = await prisma.$transaction(async (tx) => {
          const defaultQueue = await tx.publishingQueue.findFirst({
            where: {
              socialAccountId: queue.socialAccountId,
              isDefault: true,
              id: { not: queue.id },
            },
            select: { id: true },
          });

          if (!defaultQueue) {
            throw new Error('default_queue_not_found');
          }

          const defaultItems = await tx.publishingQueueItem.findMany({
            where: { queueId: defaultQueue.id },
            select: { laneKey: true, position: true },
            orderBy: [{ laneKey: 'asc' }, { position: 'desc' }],
          });

          const maxPositionByLane = new Map<string, number>();
          for (const item of defaultItems) {
            const laneKey = item.laneKey || 'post';
            const prev = maxPositionByLane.get(laneKey) ?? 0;
            if (item.position > prev) {
              maxPositionByLane.set(laneKey, item.position);
            }
          }

          const queueItems = await tx.publishingQueueItem.findMany({
            where: { queueId: queue.id },
            select: {
              id: true,
              laneKey: true,
              position: true,
              createdAt: true,
            },
            orderBy: [{ laneKey: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
          });

          for (const item of queueItems) {
            const laneKey = item.laneKey || 'post';
            const nextPosition = (maxPositionByLane.get(laneKey) ?? 0) + 1;
            maxPositionByLane.set(laneKey, nextPosition);

            await tx.publishingQueueItem.update({
              where: { id: item.id },
              data: {
                queueId: defaultQueue.id,
                position: nextPosition,
              },
            });
          }

          await tx.publishingQueue.delete({ where: { id: queue.id } });

          return {
            movedItemsCount: queueItems.length,
            defaultQueueId: defaultQueue.id,
          };
        });

        const recompute = await publishingQueueScheduler.recomputeBrandWindow(
          queue.socialAccount.brandId
        );

        return reply.send({
          success: true,
          data: {
            deletedQueueId: queue.id,
            movedItemsCount: moved.movedItemsCount,
            movedToQueueId: moved.defaultQueueId,
          },
          recompute,
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'default_queue_not_found') {
          return reply.code(409).send({ success: false, error: 'default_queue_not_found' });
        }
        request.log.error({ err: error }, 'Failed to delete publishing queue');
        return reply.code(500).send({ success: false, error: 'failed_to_delete_queue' });
      }
    }
  );

  // GET /api/queues/:queueId/slots
  fastify.get<{ Params: { queueId: string } }>(
    '/queues/:queueId/slots',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { queueId } = request.params;
      const queue = await assertPublishingQueueAccess(userId, queueId);

      const slots = await prisma.publishingQueueSlot.findMany({
        where: { queueId: queue.id },
        select: {
          id: true,
          dayOfWeek: true,
          localTime: true,
          laneKey: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ dayOfWeek: 'asc' }, { localTime: 'asc' }],
      });

      return reply.send({
        success: true,
        data: {
          queueId: queue.id,
          socialAccountId: queue.socialAccountId,
          slots: slots.map((s) => ({
            id: s.id,
            dayOfWeek: s.dayOfWeek,
            localTime: s.localTime,
            laneKey: s.laneKey,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          })),
        },
      });
    }
  );

  // PUT /api/queues/:queueId/slots (replace schedule)
  fastify.put<{
    Params: { queueId: string };
    Body: {
      slots?: unknown;
    };
  }>('/queues/:queueId/slots', { preHandler: fastify.authenticate }, async (request, reply) => {
    const userId = request.user!.id;
    const { queueId } = request.params;
    const queue = await assertPublishingQueueAccess(userId, queueId);

    const rawSlots = request.body?.slots;
    if (!Array.isArray(rawSlots)) {
      return reply.code(400).send({ success: false, error: 'invalid_slots' });
    }

    const nextSlots: Array<{
      dayOfWeek: number;
      localTime: string;
      laneKey: SlotLaneKey;
    }> = [];

    for (const raw of rawSlots) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return reply.code(400).send({ success: false, error: 'invalid_slot' });
      }
      const rec = raw as Record<string, unknown>;
      const dayOfWeek = typeof rec.dayOfWeek === 'number' ? rec.dayOfWeek : NaN;
      const localTime = typeof rec.localTime === 'string' ? rec.localTime.trim() : '';
      const laneKey = normalizeSlotLaneKey(rec.laneKey);

      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        return reply.code(400).send({ success: false, error: 'invalid_day_of_week' });
      }
      if (!/^\d{2}:\d{2}$/.test(localTime)) {
        return reply.code(400).send({ success: false, error: 'invalid_local_time' });
      }
      if (!laneKey) {
        return reply.code(400).send({ success: false, error: 'invalid_lane_key' });
      }

      nextSlots.push({ dayOfWeek, localTime, laneKey });
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.publishingQueueSlot.deleteMany({ where: { queueId: queue.id } });

        if (nextSlots.length > 0) {
          await tx.publishingQueueSlot.createMany({
            data: nextSlots.map((s) => ({
              queueId: queue.id,
              socialAccountId: queue.socialAccountId,
              dayOfWeek: s.dayOfWeek,
              localTime: s.localTime,
              laneKey: s.laneKey,
              enabled: true,
            })),
          });
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.code(409).send({ success: false, error: 'slot_conflict' });
      }
      request.log.error({ err: error }, 'Failed to update queue slots');
      return reply.code(500).send({ success: false, error: 'failed_to_update_slots' });
    }

    // Recompute window after schedule change.
    await publishingQueueScheduler.recomputeBrandWindow(queue.socialAccount.brandId);

    return reply.send({ success: true });
  });

  // POST /api/queues/:queueId/posting-goal
  fastify.post<{
    Params: { queueId: string };
    Body: {
      postsPerWeek?: unknown;
    };
  }>(
    '/queues/:queueId/posting-goal',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { queueId } = request.params;
      const queue = await assertPublishingQueueAccess(userId, queueId);

      const postsPerWeek = parsePostsPerWeek(request.body?.postsPerWeek);
      if (postsPerWeek === null) {
        return reply.code(400).send({ success: false, error: 'invalid_posts_per_week' });
      }

      const desiredSlots = buildGoalBasedSlots(postsPerWeek);
      const occupiedByOtherQueues = await prisma.publishingQueueSlot.findMany({
        where: {
          socialAccountId: queue.socialAccountId,
          queueId: { not: queue.id },
        },
        select: {
          dayOfWeek: true,
          localTime: true,
        },
      });
      const occupiedKeys = new Set(
        occupiedByOtherQueues.map((slot) => `${slot.dayOfWeek}:${slot.localTime}`)
      );
      const nextSlots = desiredSlots.filter(
        (slot) => !occupiedKeys.has(`${slot.dayOfWeek}:${slot.localTime}`)
      );

      if (nextSlots.length === 0) {
        return reply.code(409).send({ success: false, error: 'no_available_slots' });
      }

      try {
        await prisma.$transaction(async (tx) => {
          await tx.publishingQueueSlot.deleteMany({ where: { queueId: queue.id } });
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
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return reply.code(409).send({ success: false, error: 'slot_conflict' });
        }
        request.log.error({ err: error }, 'Failed to apply posting goal');
        return reply.code(500).send({ success: false, error: 'failed_to_apply_posting_goal' });
      }

      await publishingQueueScheduler.recomputeBrandWindow(queue.socialAccount.brandId);

      return reply.send({
        success: true,
        data: {
          postsPerWeek,
          requestedSlots: desiredSlots.length,
          createdSlots: nextSlots.length,
          conflictingSlots: desiredSlots.length - nextSlots.length,
          slots: nextSlots,
        },
      });
    }
  );

  // POST /api/queues/:queueId/copy-slots-from
  fastify.post<{ Params: { queueId: string }; Body: { fromQueueId?: unknown } }>(
    '/queues/:queueId/copy-slots-from',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { queueId } = request.params;
      const fromQueueId =
        typeof request.body?.fromQueueId === 'string' ? request.body.fromQueueId : '';
      if (!fromQueueId.trim()) {
        return reply.code(400).send({ success: false, error: 'invalid_from_queue' });
      }

      const queue = await assertPublishingQueueAccess(userId, queueId);
      const fromQueue = await assertPublishingQueueAccess(userId, fromQueueId.trim());

      const fromSlots = await prisma.publishingQueueSlot.findMany({
        where: { queueId: fromQueue.id },
        select: { dayOfWeek: true, localTime: true, laneKey: true },
        orderBy: [{ dayOfWeek: 'asc' }, { localTime: 'asc' }],
      });

      try {
        await prisma.$transaction(async (tx) => {
          await tx.publishingQueueSlot.deleteMany({ where: { queueId: queue.id } });
          if (fromSlots.length > 0) {
            await tx.publishingQueueSlot.createMany({
              data: fromSlots.map((s) => ({
                queueId: queue.id,
                socialAccountId: queue.socialAccountId,
                dayOfWeek: s.dayOfWeek,
                localTime: s.localTime,
                laneKey: String(s.laneKey),
                enabled: true,
              })),
            });
          }
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return reply.code(409).send({ success: false, error: 'slot_conflict' });
        }
        request.log.error({ err: error }, 'Failed to copy queue slots');
        return reply.code(500).send({ success: false, error: 'failed_to_copy_slots' });
      }

      await publishingQueueScheduler.recomputeBrandWindow(queue.socialAccount.brandId);

      return reply.send({ success: true });
    }
  );

  // GET /api/queues/:queueId/slot-instances?laneKey=post&limit=20&after=...
  fastify.get<{
    Params: { queueId: string };
    Querystring: { laneKey?: string; limit?: string; after?: string };
  }>(
    '/queues/:queueId/slot-instances',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { queueId } = request.params;
      const queue = await assertPublishingQueueAccess(userId, queueId);

      const laneKey = request.query?.laneKey ? normalizeSlotLaneKey(request.query.laneKey) : null;
      if (request.query?.laneKey && !laneKey) {
        return reply.code(400).send({ success: false, error: 'invalid_lane_key' });
      }

      const limit = (() => {
        const raw = request.query?.limit;
        const n = raw ? parseInt(raw, 10) : 20;
        return Number.isFinite(n) ? Math.max(1, Math.min(100, n)) : 20;
      })();

      const after = parseIsoDate(request.query?.after) ?? new Date();

      const timezone = await TimezoneService.getBrandTimezone(queue.socialAccount.brandId);

      const slotLaneFilter =
        laneKey === null
          ? {}
          : laneKey === 'any'
            ? { laneKey: 'any' }
            : { laneKey: { in: [laneKey, 'any'] } };

      const slots = await prisma.publishingQueueSlot.findMany({
        where: {
          queueId: queue.id,
          ...slotLaneFilter,
        },
        select: {
          id: true,
          queueId: true,
          laneKey: true,
          dayOfWeek: true,
          localTime: true,
        },
      });

      const instances = generateSlotInstances({
        slots: slots.map((s) => ({
          slotId: s.id,
          queueId: s.queueId,
          laneKey: normalizeSlotLaneKey(s.laneKey) || 'post',
          dayOfWeek: s.dayOfWeek,
          localTime: s.localTime,
        })),
        timezone,
        startAtUtc: after,
        limit,
      });

      const rangeStartAt = new Date(after.getTime() - SLOT_CONFLICT_WINDOW_MS);
      const rangeEndAt = instances.length
        ? new Date(
            instances[instances.length - 1]!.scheduledAtUtc.getTime() + SLOT_CONFLICT_WINDOW_MS
          )
        : new Date(after.getTime() + 7 * 24 * 60 * 60 * 1000);

      const scheduled = await prisma.content.findMany({
        where: {
          targetSocialAccountId: queue.socialAccountId,
          scheduledAt: { gte: rangeStartAt, lte: rangeEndAt },
          status: { in: ['scheduled', 'draft', 'skipped'] },
        },
        select: { id: true, scheduledAt: true },
      });

      const occupiedByMs = new Map<number, string>();
      const occupiedMsSorted: number[] = [];
      for (const c of scheduled) {
        if (!c.scheduledAt) {
          continue;
        }
        const ms = c.scheduledAt.getTime();
        if (!occupiedByMs.has(ms)) {
          occupiedByMs.set(ms, c.id);
        }
        occupiedMsSorted.push(ms);
      }
      occupiedMsSorted.sort((a, b) => a - b);

      return reply.send({
        success: true,
        data: {
          queueId: queue.id,
          socialAccountId: queue.socialAccountId,
          timezone,
          instances: instances.map((i) => {
            const ms = i.scheduledAtUtc.getTime();
            const occupiedMs = findOccupiedTime({
              candidateUtcMs: ms,
              occupiedUtcMsSorted: occupiedMsSorted,
              windowMs: SLOT_CONFLICT_WINDOW_MS,
            });
            const occupiedContentId =
              occupiedMs === null ? null : (occupiedByMs.get(occupiedMs) ?? null);
            return {
              slotId: i.slotId,
              queueId: i.queueId,
              laneKey: i.laneKey,
              scheduledAt: i.scheduledAtUtc.toISOString(),
              occupied: Boolean(occupiedContentId),
              occupiedContentId,
            };
          }),
        },
      });
    }
  );

  // POST /api/queues/:queueId/items (add content to queue)
  fastify.post<{ Params: { queueId: string }; Body: { contentId?: unknown } }>(
    '/queues/:queueId/items',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { queueId } = request.params;
      const queue = await assertPublishingQueueAccess(userId, queueId);

      const contentId = typeof request.body?.contentId === 'string' ? request.body.contentId : '';
      if (!contentId.trim()) {
        return reply.code(400).send({ success: false, error: 'invalid_content_id' });
      }

      const content = await prisma.content.findFirst({
        where: { id: contentId.trim(), brandId: queue.socialAccount.brandId },
        select: { id: true, contentType: true, targetSocialAccountId: true, status: true },
      });
      if (!content) {
        return reply.code(404).send({ success: false, error: 'content_not_found' });
      }
      if (content.targetSocialAccountId !== queue.socialAccountId) {
        return reply.code(400).send({
          success: false,
          error: 'content_wrong_destination',
        });
      }

      const readiness = await validateQueueableContent({
        contentId: content.id,
        brandId: queue.socialAccount.brandId,
        socialAccountId: queue.socialAccountId,
      });
      if (!readiness.ok) {
        return reply.code(400).send({
          success: false,
          error: readiness.code,
          message: readiness.message,
          details: readiness.details,
        });
      }

      const tier = await prisma.user
        .findUnique({
          where: { id: request.user!.id },
          select: { subscriptionTier: true },
        })
        .then((u) => u?.subscriptionTier || 'free');
      const maxDepth = getMaxQueueDepthForTier(tier);

      const existingItem = await prisma.publishingQueueItem.findUnique({
        where: { contentId: content.id },
        select: { id: true, queueId: true },
      });

      if (!existingItem && Number.isFinite(maxDepth)) {
        const currentDepth = await prisma.publishingQueueItem.count({
          where: {
            queue: { socialAccountId: queue.socialAccountId },
            content: { status: { notIn: ['published', 'unavailable'] } },
          },
        });
        if (currentDepth + 1 > (maxDepth as number)) {
          return reply.code(402).send({
            success: false,
            error: 'queue_depth_limit',
            maxAllowed: maxDepth,
          });
        }
      }

      const laneKey = normalizeContentLaneKey(content.contentType) || 'post';

      const maxPosition = await prisma.publishingQueueItem.findFirst({
        where: { queueId: queue.id, laneKey },
        select: { position: true },
        orderBy: { position: 'desc' },
      });
      const position = (maxPosition?.position ?? 0) + 1;

      const item = await prisma.publishingQueueItem.upsert({
        where: { contentId: content.id },
        create: {
          queueId: queue.id,
          contentId: content.id,
          laneKey,
          position,
        },
        update: {
          queueId: queue.id,
          laneKey,
          position,
        },
        select: {
          id: true,
          queueId: true,
          contentId: true,
          laneKey: true,
          position: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const recompute = await publishingQueueScheduler.recomputeBrandWindow(
        queue.socialAccount.brandId
      );

      // Best-effort: notify other clients so calendars/queues refresh in real time.
      try {
        const broadcaster = getStatusBroadcaster();
        if (broadcaster) {
          void broadcaster.broadcastStatusChange(
            content.id,
            queue.socialAccount.brandId,
            content.status as any,
            content.status as any,
            { kind: 'queue_item', action: existingItem ? 'moved' : 'enqueued', queueId: queue.id }
          );
        }
      } catch {
        // ignore
      }

      return reply.send({
        success: true,
        data: {
          item,
          recompute,
        },
      });
    }
  );

  // GET /api/queues/:queueId/items?laneKey=post&limit=50&after=...
  fastify.get<{
    Params: { queueId: string };
    Querystring: { laneKey?: string; limit?: string; after?: string };
  }>('/queues/:queueId/items', { preHandler: fastify.authenticate }, async (request, reply) => {
    const userId = request.user!.id;
    const { queueId } = request.params;
    const queue = await assertPublishingQueueAccess(userId, queueId);

    const laneKey = request.query?.laneKey ? normalizeContentLaneKey(request.query.laneKey) : null;
    if (request.query?.laneKey && !laneKey) {
      return reply.code(400).send({ success: false, error: 'invalid_lane_key' });
    }

    const limit = (() => {
      const raw = request.query?.limit;
      const n = raw ? parseInt(raw, 10) : 50;
      return Number.isFinite(n) ? Math.max(1, Math.min(200, n)) : 50;
    })();

    const after = parseIsoDate(request.query?.after) ?? new Date();
    const startAtUtc = new Date(after.getTime() + 5 * 60 * 1000);

    const timezone = await TimezoneService.getBrandTimezone(queue.socialAccount.brandId);

    const shouldHideFromQueueList = (status: unknown) =>
      status === 'published' || status === 'unavailable';

    const [itemsByLane, slots, reservedScheduled] = await Promise.all([
      (async () => {
        const lanes: ContentLaneKey[] = ['post', 'reel', 'story'];
        const pairs = await Promise.all(
          lanes.map(async (lk) => {
            const items = await prisma.publishingQueueItem.findMany({
              where: { queueId: queue.id, laneKey: lk },
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
            return [
              lk,
              items.filter((item) => !shouldHideFromQueueList(item.content?.status)),
            ] as const;
          })
        );
        return new Map(pairs);
      })(),
      prisma.publishingQueueSlot.findMany({
        where: { queueId: queue.id },
        select: { id: true, queueId: true, laneKey: true, dayOfWeek: true, localTime: true },
        orderBy: [{ dayOfWeek: 'asc' }, { localTime: 'asc' }],
      }),
      prisma.content.findMany({
        where: {
          targetSocialAccountId: queue.socialAccountId,
          scheduledAt: { gte: startAtUtc },
          status: { in: ['scheduled', 'draft', 'skipped'] },
          publishingQueueItem: { is: null },
        },
        select: { scheduledAt: true },
      }),
    ]);

    const reservedMsSorted = reservedScheduled
      .map((r) => r.scheduledAt?.getTime() ?? null)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);

    const instances = generateSlotInstances({
      slots: slots.map((s) => ({
        slotId: s.id,
        queueId: s.queueId,
        laneKey: normalizeSlotLaneKey(s.laneKey) || 'post',
        dayOfWeek: s.dayOfWeek,
        localTime: s.localTime,
      })),
      timezone,
      startAtUtc,
      limit: 600,
    }).filter(
      (inst) =>
        !isTimeOccupied({
          candidateUtcMs: inst.scheduledAtUtc.getTime(),
          occupiedUtcMsSorted: reservedMsSorted,
          windowMs: SLOT_CONFLICT_WINDOW_MS,
        })
    );

    const estimatedByContentId = new Map<string, Date>();
    const indexByLane = new Map<ContentLaneKey, number>();
    const contentLanes: ContentLaneKey[] = ['post', 'reel', 'story'];

    type QueueItemRow =
      typeof itemsByLane extends Map<any, infer V> ? (V extends Array<infer I> ? I : never) : never;

    const isSkippable = (status: unknown) =>
      status === 'published' ||
      status === 'unavailable' ||
      status === 'failed' ||
      status === 'skipped';

    const peekNextEligibleItem = (
      lk: ContentLaneKey,
      scheduledAtUtc: Date
    ): { item: QueueItemRow; index: number } | null => {
      const list = itemsByLane.get(lk) ?? [];
      if (list.length === 0) {
        return null;
      }

      let idx = indexByLane.get(lk) ?? 0;
      while (idx < list.length) {
        const item = list[idx]!;
        const content = item.content;
        if (!content || isSkippable(content.status)) {
          idx += 1;
          continue;
        }
        if (item.notBefore && scheduledAtUtc.getTime() < item.notBefore.getTime()) {
          indexByLane.set(lk, idx);
          return null;
        }

        indexByLane.set(lk, idx);
        return { item, index: idx };
      }

      indexByLane.set(lk, idx);
      return null;
    };

    for (const inst of instances) {
      if (inst.laneKey === 'any') {
        let chosenLane: ContentLaneKey | null = null;
        let chosen: { item: QueueItemRow; index: number } | null = null;

        for (const lk of contentLanes) {
          const peek = peekNextEligibleItem(lk, inst.scheduledAtUtc);
          if (!peek) {
            continue;
          }

          if (
            !chosen ||
            peek.item.createdAt.getTime() < chosen.item.createdAt.getTime() ||
            (peek.item.createdAt.getTime() === chosen.item.createdAt.getTime() &&
              peek.item.contentId.localeCompare(chosen.item.contentId) < 0)
          ) {
            chosenLane = lk;
            chosen = peek;
          }
        }

        if (!chosenLane || !chosen) {
          continue;
        }
        const content = chosen.item.content;
        if (!content) {
          continue;
        }

        estimatedByContentId.set(content.id, inst.scheduledAtUtc);
        indexByLane.set(chosenLane, chosen.index + 1);
        continue;
      }

      const lk = inst.laneKey as ContentLaneKey;
      const peek = peekNextEligibleItem(lk, inst.scheduledAtUtc);
      if (!peek) {
        continue;
      }
      const content = peek.item.content;
      if (!content) {
        continue;
      }

      estimatedByContentId.set(content.id, inst.scheduledAtUtc);
      indexByLane.set(lk, peek.index + 1);
    }

    const lanes: ContentLaneKey[] = laneKey ? [laneKey] : ['post', 'reel', 'story'];

    return reply.send({
      success: true,
      data: {
        queueId: queue.id,
        socialAccountId: queue.socialAccountId,
        timezone,
        lanes: lanes.map((lk) => {
          const items = itemsByLane.get(lk) ?? [];
          return {
            laneKey: lk,
            items: items.map((item) => {
              const content = item.content;
              const estimated = content ? (estimatedByContentId.get(content.id) ?? null) : null;
              return {
                id: item.id,
                queueId: item.queueId,
                contentId: item.contentId,
                laneKey: lk,
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
            }),
          };
        }),
      },
    });
  });

  // DELETE /api/queues/:queueId/items/:itemId (remove from queue)
  fastify.delete<{ Params: { queueId: string; itemId: string } }>(
    '/queues/:queueId/items/:itemId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const userId = request.user!.id;
      const { queueId, itemId } = request.params;
      const queue = await assertPublishingQueueAccess(userId, queueId);

      const item = await prisma.publishingQueueItem.findFirst({
        where: { id: itemId, queueId: queue.id },
        include: { content: { select: { id: true, status: true } } },
      });
      if (!item) {
        return reply.code(404).send({ success: false, error: 'queue_item_not_found' });
      }

      // If the item was queue-managed scheduled, unqueueing returns it to draft.
      const cancelled =
        item.content?.status === 'scheduled'
          ? await schedulerService.cancelScheduledPost(item.content.id)
          : { success: true };
      if (!cancelled.success) {
        return reply.code(500).send({ success: false, error: cancelled.error || 'cancel_failed' });
      }

      await prisma.publishingQueueItem.delete({ where: { id: item.id } });

      const recompute = await publishingQueueScheduler.recomputeBrandWindow(
        queue.socialAccount.brandId
      );

      // Best-effort: notify other clients so calendars/queues refresh in real time.
      try {
        const broadcaster = getStatusBroadcaster();
        if (broadcaster && item.content?.id) {
          void broadcaster.broadcastStatusChange(
            item.content.id,
            queue.socialAccount.brandId,
            item.content.status as any,
            item.content.status as any,
            { kind: 'queue_item', action: 'removed', queueId: queue.id }
          );
        }
      } catch {
        // ignore
      }

      return reply.send({ success: true, data: { recompute } });
    }
  );
};

export default publishingQueuesRoutes;
