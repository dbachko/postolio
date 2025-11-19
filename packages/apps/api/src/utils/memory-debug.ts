import { logger as baseLogger } from '@postolio/logger';
import path from 'node:path';

const memoryLogger = baseLogger.child({ module: 'memory-debug' });

function toMB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

export function logMemoryUsage(context: string, extra?: Record<string, unknown>): void {
  const usage = process.memoryUsage();

  memoryLogger.info('memory usage', {
    context,
    rssMB: toMB(usage.rss),
    heapTotalMB: toMB(usage.heapTotal),
    heapUsedMB: toMB(usage.heapUsed),
    externalMB: toMB(usage.external),
    arrayBuffersMB: toMB((usage as any).arrayBuffers || 0),
    ...(extra || {}),
  });
}

/**
 * Optional heap snapshot helper.
 * Use sparingly; writing snapshots is expensive and may increase memory pressure.
 */
export async function maybeWriteHeapSnapshot(label: string): Promise<void> {
  try {
    // Write snapshots to /tmp by default; this is writable in containers and dev.
    const dir = '/tmp';
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
    const fileName = `${safeLabel || 'heap'}-${Date.now()}.heapsnapshot`;
    const fullPath = path.join(dir, fileName);

    const v8Mod = await import('v8');
    const v8 = v8Mod as unknown as { writeHeapSnapshot: (filename?: string) => string };
    const snapshotPath = v8.writeHeapSnapshot(fullPath);

    memoryLogger.warn('Heap snapshot written for debugging', {
      context: label,
      snapshotPath,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    memoryLogger.error('Failed to write heap snapshot', {
      context: label,
      error: { name: err.name, message: err.message, stack: err.stack },
    });
  }
}
