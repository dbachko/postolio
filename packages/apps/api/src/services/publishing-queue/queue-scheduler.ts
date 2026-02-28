import { SLOT_CONFLICT_WINDOW_MS } from './occupancy.js';
import { recomputeBrandWindow, type RecomputeBrandWindowResult } from './recompute-brand-window.js';

export class PublishingQueueSchedulerService {
  static readonly SLOT_CONFLICT_WINDOW_MS = SLOT_CONFLICT_WINDOW_MS;
  static readonly SCHEDULING_BUFFER_MS = 5 * 60 * 1000; // 5 minutes from "now"
  static readonly MAX_WINDOW_SIZE = 100; // avoid churn; tunable
  static readonly SLOT_SCAN_LIMIT_PER_ACCOUNT = 400; // upcoming slot instances per account

  async recomputeBrandWindow(brandId: string): Promise<RecomputeBrandWindowResult> {
    return recomputeBrandWindow(brandId, {
      schedulingBufferMs: PublishingQueueSchedulerService.SCHEDULING_BUFFER_MS,
      maxWindowSize: PublishingQueueSchedulerService.MAX_WINDOW_SIZE,
      slotScanLimitPerAccount: PublishingQueueSchedulerService.SLOT_SCAN_LIMIT_PER_ACCOUNT,
      slotConflictWindowMs: PublishingQueueSchedulerService.SLOT_CONFLICT_WINDOW_MS,
    });
  }
}

export const publishingQueueScheduler = new PublishingQueueSchedulerService();
