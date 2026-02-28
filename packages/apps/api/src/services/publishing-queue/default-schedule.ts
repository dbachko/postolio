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
type PublishingQueueDelegate = {
  findFirst: (...args: any[]) => Promise<any>;
  create: (...args: any[]) => Promise<any>;
  update: (...args: any[]) => Promise<any>;
};
type PublishingQueueSlotDelegate = {
  count?: (...args: any[]) => Promise<any>;
  findMany?: (...args: any[]) => Promise<any>;
  createMany?: (...args: any[]) => Promise<any>;
};

function clampPostsPerWeek(postsPerWeek: number): number {
  return Math.max(MIN_POSTS_PER_WEEK, Math.min(MAX_POSTS_PER_WEEK, Math.trunc(postsPerWeek)));
}

export function parsePostsPerWeek(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (!Number.isInteger(parsed)) {
    return null;
  }
  if (parsed < MIN_POSTS_PER_WEEK || parsed > MAX_POSTS_PER_WEEK) {
    return null;
  }
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
    if (a.dayOfWeek !== b.dayOfWeek) {
      return a.dayOfWeek - b.dayOfWeek;
    }
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
  const queueModel = (db as any)?.publishingQueue as PublishingQueueDelegate | undefined;
  const slotModel = (db as any)?.publishingQueueSlot as PublishingQueueSlotDelegate | undefined;
  if (!queueModel || !slotModel) {
    return { queueId: '', createdQueue: false, createdSlots: 0 };
  }

  const queueResolution = await resolveDefaultQueue(queueModel, socialAccountId);
  if (!queueResolution.queueId) {
    return { queueId: '', createdQueue: queueResolution.createdQueue, createdSlots: 0 };
  }

  const queueSlotCount = await getQueueSlotCount(slotModel, queueResolution.queueId);
  if (queueSlotCount > 0 || typeof slotModel.createMany !== 'function') {
    return {
      queueId: queueResolution.queueId,
      createdQueue: queueResolution.createdQueue,
      createdSlots: 0,
    };
  }

  const occupiedKeys = await getOccupiedSlotKeys(
    slotModel,
    socialAccountId,
    queueResolution.queueId
  );
  const nextSlots = buildGoalBasedSlots(postsPerWeek).filter(
    (slot) => !occupiedKeys.has(`${slot.dayOfWeek}:${slot.localTime}`)
  );
  if (nextSlots.length === 0) {
    return {
      queueId: queueResolution.queueId,
      createdQueue: queueResolution.createdQueue,
      createdSlots: 0,
    };
  }

  const createResult = await slotModel.createMany({
    data: nextSlots.map((slot) => ({
      queueId: queueResolution.queueId,
      socialAccountId,
      dayOfWeek: slot.dayOfWeek,
      localTime: slot.localTime,
      laneKey: slot.laneKey,
      enabled: true,
    })),
  });

  return {
    queueId: queueResolution.queueId,
    createdQueue: queueResolution.createdQueue,
    createdSlots: typeof createResult?.count === 'number' ? createResult.count : nextSlots.length,
  };
}

async function resolveDefaultQueue(queueModel: PublishingQueueDelegate, socialAccountId: string) {
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
      await queueModel.update({ where: { id: byName.id }, data: { isDefault: true } });
      queueId = byName.id;
    } else {
      const created = await queueModel.create({
        data: { socialAccountId, name: 'Default', isDefault: true },
        select: { id: true },
      });
      queueId = created.id;
      createdQueue = true;
    }
  }
  return { queueId: queueId ?? '', createdQueue };
}

async function getQueueSlotCount(slotModel: PublishingQueueSlotDelegate, queueId: string) {
  if (typeof slotModel.count === 'function') {
    return slotModel.count({ where: { queueId } });
  }
  if (typeof slotModel.findMany === 'function') {
    const existingSlots = await slotModel.findMany({ where: { queueId }, select: { id: true } });
    return Array.isArray(existingSlots) ? existingSlots.length : 0;
  }
  return 0;
}

async function getOccupiedSlotKeys(
  slotModel: PublishingQueueSlotDelegate,
  socialAccountId: string,
  queueId: string
) {
  if (typeof slotModel.findMany !== 'function') {
    return new Set<string>();
  }

  const occupied = await (
    slotModel.findMany({
      where: {
        socialAccountId,
        queueId: { not: queueId },
      },
      select: { dayOfWeek: true, localTime: true },
    }) as Promise<Array<{ dayOfWeek: number; localTime: string }>>
  ).catch(() => []);
  return new Set(occupied.map((slot) => `${slot.dayOfWeek}:${slot.localTime}`));
}
