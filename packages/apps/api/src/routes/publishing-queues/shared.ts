import { Prisma } from '@postolio/database';

import { getDatabaseClient } from '../../config/database.js';
import { getStatusBroadcaster } from '../../services/broadcast-registry.js';

export const prisma: ReturnType<typeof getDatabaseClient> = getDatabaseClient();

export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function broadcastQueueItemStatusChange(options: {
  contentId: string;
  brandId: string;
  status: unknown;
  action: 'enqueued' | 'moved' | 'removed';
  queueId: string;
}): Promise<void> {
  try {
    const broadcaster = getStatusBroadcaster();
    if (!broadcaster) {
      return;
    }

    await broadcaster.broadcastStatusChange(
      options.contentId,
      options.brandId,
      options.status as any,
      options.status as any,
      { kind: 'queue_item', action: options.action, queueId: options.queueId }
    );
  } catch {
    // Best-effort broadcast only.
  }
}

export function parseIntegerLimit(
  raw: string | undefined,
  defaultValue: number,
  max: number
): number {
  if (!raw) {
    return defaultValue;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  return Math.max(1, Math.min(max, parsed));
}
