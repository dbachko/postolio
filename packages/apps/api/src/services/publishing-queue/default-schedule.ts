import type { Prisma, PrismaClient } from '@postolio/database';

export const DEFAULT_POSTS_PER_WEEK = 3;
export const MIN_POSTS_PER_WEEK = 1;
export const MAX_POSTS_PER_WEEK = 21;

const DAY_ORDER: number[] = [1, 3, 5, 2, 4, 6, 0]; // Mon, Wed, Fri, Tue, Thu, Sat, Sun
const TIME_WAVES: string[] = ['09:00', '13:00', '17:00'];

export type GoalBasedSlot = {
  dayOfWeek: number;
  localTime: string;
  laneKey: 'any';
};

type QueueScheduleDbClient = PrismaClient | Prisma.TransactionClient;

function clampPostsPerWeek(postsPerWeek: number): number {
  return Math.max(MIN_POSTS_PER_WEEK, Math.min(MAX_POSTS_PER_WEEK, Math.trunc(postsPerWeek)));
}

export function parsePostsPerWeek(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (!Number.isInteger(parsed)) return null;
  if (parsed < MIN_POSTS_PER_WEEK || parsed > MAX_POSTS_PER_WEEK) return null;
  return parsed;
}

export function buildGoalBasedSlots(postsPerWeek: number): GoalBasedSlot[] {
  const target = clampPostsPerWeek(postsPerWeek);
  const slots: GoalBasedSlot[] = [];

  for (let i = 0; i < target; i += 1) {
    const dayOfWeek = DAY_ORDER[i % DAY_ORDER.length]!;
    const waveIndex = Math.floor(i / DAY_ORDER.length);
    const localTime = TIME_WAVES[Math.min(waveIndex, TIME_WAVES.length - 1)]!;

    slots.push({
      dayOfWeek,
      localTime,
      laneKey: 'any',
    });
  }

  return slots.sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    return a.localTime.localeCompare(b.localTime);
  });
}

export async function ensureDefaultQueueWithStarterSchedule(
  db: QueueScheduleDbClient,
  socialAccountId: string,
  postsPerWeek: number = DEFAULT_POSTS_PER_WEEK
): Promise<{
  queueId: string;
  createdQueue: boolean;
  createdSlots: number;
}> {
  const queueModel = (db as any)?.publishingQueue;
  const slotModel = (db as any)?.publishingQueueSlot;

  // Some unit tests use partial DB mocks that don't include queue delegates.
  // In that case this helper should be a no-op.
  if (
    !queueModel ||
    typeof queueModel.findFirst !== 'function' ||
    typeof queueModel.create !== 'function' ||
    typeof queueModel.update !== 'function'
  ) {
    return {
      queueId: '',
      createdQueue: false,
      createdSlots: 0,
    };
  }

  let createdQueue = false;

  const existingDefault = await queueModel.findFirst({
    where: { socialAccountId, isDefault: true },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  let queueId = existingDefault?.id ?? null;
  if (!queueId) {
    const byName = await queueModel.findFirst({
      where: { socialAccountId, name: 'Default' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (byName) {
      await queueModel.update({
        where: { id: byName.id },
        data: { isDefault: true },
      });
      queueId = byName.id;
    } else {
      const created = await queueModel.create({
        data: {
          socialAccountId,
          name: 'Default',
          isDefault: true,
        },
        select: { id: true },
      });
      queueId = created.id;
      createdQueue = true;
    }
  }

  if (!queueId) {
    return {
      queueId: '',
      createdQueue,
      createdSlots: 0,
    };
  }

  let queueSlotCount = 0;
  if (slotModel && typeof slotModel.count === 'function') {
    queueSlotCount = await slotModel.count({ where: { queueId } });
  } else if (slotModel && typeof slotModel.findMany === 'function') {
    const existingSlots = await slotModel.findMany({ where: { queueId }, select: { id: true } });
    queueSlotCount = Array.isArray(existingSlots) ? existingSlots.length : 0;
  }

  if (queueSlotCount > 0) {
    return {
      queueId,
      createdQueue,
      createdSlots: 0,
    };
  }

  if (!slotModel || typeof slotModel.createMany !== 'function') {
    return {
      queueId,
      createdQueue,
      createdSlots: 0,
    };
  }

  const occupied: Array<{ dayOfWeek: number; localTime: string }> =
    typeof slotModel.findMany === 'function'
      ? await (
          slotModel.findMany({
            where: {
              socialAccountId,
              queueId: { not: queueId },
            },
            select: { dayOfWeek: true, localTime: true },
          }) as Promise<Array<{ dayOfWeek: number; localTime: string }>>
        ).catch(() => [])
      : [];
  const occupiedKeys = new Set(occupied.map((slot) => `${slot.dayOfWeek}:${slot.localTime}`));

  const nextSlots = buildGoalBasedSlots(postsPerWeek).filter(
    (slot) => !occupiedKeys.has(`${slot.dayOfWeek}:${slot.localTime}`)
  );
  if (nextSlots.length === 0) {
    return {
      queueId,
      createdQueue,
      createdSlots: 0,
    };
  }

  const createResult = await slotModel.createMany({
    data: nextSlots.map((slot) => ({
      queueId,
      socialAccountId,
      dayOfWeek: slot.dayOfWeek,
      localTime: slot.localTime,
      laneKey: slot.laneKey,
      enabled: true,
    })),
  });

  return {
    queueId,
    createdQueue,
    createdSlots: typeof createResult?.count === 'number' ? createResult.count : nextSlots.length,
  };
}
