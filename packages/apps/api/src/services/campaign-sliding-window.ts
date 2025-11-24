import { type ContentStatus } from '@postolio/database';
import { getDatabaseClient } from '../config/database.js';
import { TimezoneService } from './timezone.js';
import { generateInstagramContent } from './content-generator.js';
import { schedulerService } from './scheduler.js';
import { computeUpcomingSlots } from './slot-utils.js';
import { importImageFromExternalUrl, attachAssetToContent } from './assets-media.js';

const prisma = getDatabaseClient();

/**
 * Sliding window generation for campaign content.
 *
 * Maintains N upcoming scheduled posts for a campaign by generating
 * and scheduling new posts into the next empty campaign slots.
 *
 * Rules:
 * - Only schedules in the future within the campaign duration
 * - Respects postingTime and frequency from campaign config
 * - Skips slots that already have content (manual or AI) within ±2h window
 * - Creates content as draft with scheduledAt set and processing state; AWS scheduler will finalize
 */
export class CampaignSlidingWindowService {
  static readonly SLOT_WINDOW_MS = 90 * 60 * 1000; // 90 minutes
  static readonly MULTI_SLOT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes for explicit postingTimes
  static readonly SCHEDULING_BUFFER_MS = 5 * 60 * 1000; // 5 minutes from now

  /**
   * Ensure the campaign maintains at least windowSize upcoming scheduled posts.
   */
  /**
   * Maintain upcoming scheduled posts for a campaign, respecting account caps.
   *
   * maxGenerate (internal) allows callers (e.g., background job) to cap how many posts
   * to generate in this invocation for fair distribution across campaigns.
   */
  async maintainWindow(
    campaignId: string,
    maxGenerate?: number
  ): Promise<{
    success: boolean;
    generated: number;
    message?: string;
  }> {
    // Load campaign with config and brand
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { brand: { include: { user: true } } },
    });

    if (!campaign || !campaign.brand) {
      return { success: false, generated: 0, message: 'Campaign not found' };
    }

    // Extract config safely
    const raw = campaign.config as unknown;
    const config =
      raw && typeof raw === 'object'
        ? (raw as {
            duration?: { start?: string; end?: string };
            postingTime?: string;
            postingTimes?: string[];
            frequency?: 'daily' | 'every2days' | '3weekly' | string;
            themes?: string[];
            style?: string;
          })
        : {};

    const durationStart = config.duration?.start ? new Date(config.duration.start) : null;
    const durationEnd = config.duration?.end ? new Date(config.duration.end) : null;
    const postingTime = config.postingTime || '12:00';
    const postingTimes = Array.isArray(config.postingTimes)
      ? (config.postingTimes as string[])
      : [];
    const frequency = (config.frequency as 'daily' | 'every2days' | '3weekly') || 'daily';

    if (!durationStart || !durationEnd) {
      return { success: false, generated: 0, message: 'Campaign has no valid duration' };
    }

    // Timezone context
    const timezone = await TimezoneService.getBrandTimezone(campaign.brandId);
    const now = new Date();

    // Query content for slot conflict detection
    // 1. Campaign-specific content for time window checks
    const existingFuture = await prisma.content.findMany({
      where: {
        campaignId: campaignId,
        scheduledAt: { gte: new Date(now.getTime() - CampaignSlidingWindowService.SLOT_WINDOW_MS) },
        status: {
          in: ['draft', 'scheduled', 'published'] as ContentStatus[],
        },
      },
      select: { id: true, scheduledAt: true },
      orderBy: { scheduledAt: 'asc' },
    });

    const futureScheduled = existingFuture.filter((c) => c.scheduledAt && c.scheduledAt > now);

    // Enforce subscription cap at account level (user-wide)
    const tier = campaign.brand.user?.subscriptionTier || 'free';
    const { getMaxScheduledAheadForTier } = await import('../constants/subscription.js');
    const accountMaxAhead = getMaxScheduledAheadForTier(tier);
    let accountRemaining = Number.POSITIVE_INFINITY;
    if (Number.isFinite(accountMaxAhead)) {
      const accountFuture = await prisma.content.count({
        where: {
          brand: { userId: campaign.brand.userId },
          scheduledAt: { gte: now },
          status: { in: ['scheduled', 'draft'] },
        },
      });
      accountRemaining = Math.max(0, (accountMaxAhead as number) - accountFuture);
    }

    // If no remaining capacity, exit early
    if (accountRemaining <= 0) {
      return { success: true, generated: 0, message: 'No remaining scheduling capacity' };
    }
    // Note: accountRemaining > 0 ensures we have capacity to generate

    // Build occupied times and occupied local calendar dates (brand timezone)
    const occupiedTimes = futureScheduled
      .map((c) => c.scheduledAt!.getTime())
      .sort((a, b) => a - b);

    // Normalize posting times to determine if single-slot or multi-slot
    const normalizedTimes = (postingTimes.length > 0 ? postingTimes : [postingTime])
      .filter(Boolean)
      .map((t) => {
        const [h, m] = t.split(':');
        return `${String(parseInt(h ?? '0', 10)).padStart(2, '0')}:${String(parseInt(m ?? '0', 10)).padStart(2, '0')}`;
      })
      .filter((v, i, a) => a.indexOf(v) === i);
    const isSingleSlot = normalizedTimes.length <= 1;

    const occupiedLocalDates = new Set<string>();
    // Per-campaign occupancy helpers
    const brandOccupiedDates = new Set<string>(); // Deprecated: brand-wide blocking removed
    const occupiedLocalSlotKeys = new Set<string>();
    const occupiedLocalWeeks = new Map<string, number>();
    const weekKeyOf = (d: Date) => {
      const local = TimezoneService.toLocal(d, timezone);
      const day = local.getDay(); // 0=Sun..6=Sat
      const monDelta = day === 0 ? -6 : 1 - day; // shift to Monday
      const monday = new Date(local);
      monday.setDate(local.getDate() + monDelta);
      const key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(
        monday.getDate()
      ).padStart(2, '0')}`;
      return key; // Local week key identified by Monday's date
    };

    // Track campaign-specific occupancy
    for (const c of futureScheduled) {
      if (!c.scheduledAt) continue;
      const local = TimezoneService.toLocal(c.scheduledAt, timezone);
      const dayKey = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(
        local.getDate()
      ).padStart(2, '0')}`;
      occupiedLocalDates.add(dayKey);
      const timeKey = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
      occupiedLocalSlotKeys.add(`${dayKey}T${timeKey}`);
      const wk = weekKeyOf(c.scheduledAt);
      occupiedLocalWeeks.set(wk, (occupiedLocalWeeks.get(wk) || 0) + 1);
    }

    // brand-wide occupancy removed per new specification

    // Find next available campaign slots
    const candidateSlots = await computeUpcomingSlots(
      durationStart,
      durationEnd,
      postingTime,
      postingTimes,
      frequency,
      timezone,
      Math.max(10, accountRemaining * 3) // scan generously, bounded
    );

    // Filter to slots in the future and not too soon
    const soonBuffer = new Date(now.getTime() + CampaignSlidingWindowService.SCHEDULING_BUFFER_MS);
    const filteredSlots = candidateSlots.filter((d) => d > soonBuffer);

    // Select earliest slots that are not occupied within ±2h
    const selectedSlots: Date[] = [];
    const perWeekLimit = frequency === '3weekly' ? 3 : Number.POSITIVE_INFINITY;
    const conflictWindow = isSingleSlot
      ? CampaignSlidingWindowService.SLOT_WINDOW_MS
      : CampaignSlidingWindowService.MULTI_SLOT_WINDOW_MS;
    for (const slot of filteredSlots) {
      const ts = slot.getTime();
      // Enforce per-day or per-slot uniqueness in brand local time
      const slotLocal = TimezoneService.toLocal(slot, timezone);
      const dayKey = `${slotLocal.getFullYear()}-${String(slotLocal.getMonth() + 1).padStart(
        2,
        '0'
      )}-${String(slotLocal.getDate()).padStart(2, '0')}`;
      if (isSingleSlot) {
        // For single-slot campaigns, ensure we don't place more than one per day for this campaign
        if (occupiedLocalDates.has(dayKey)) continue;
      } else {
        // For multi-slot campaigns, check specific time slot occupancy
        const timeKey = `${String(slotLocal.getHours()).padStart(2, '0')}:${String(
          slotLocal.getMinutes()
        ).padStart(2, '0')}`;
        const fullKey = `${dayKey}T${timeKey}`;
        if (occupiedLocalSlotKeys.has(fullKey)) continue;
      }
      // Enforce per-week quota for 3weekly campaigns
      const slotWeekKey = weekKeyOf(slot);
      const currentWeekCount = occupiedLocalWeeks.get(slotWeekKey) || 0;
      if (currentWeekCount >= perWeekLimit) continue;

      const conflict = occupiedTimes.some((t) => Math.abs(t - ts) < conflictWindow);
      if (!conflict) {
        selectedSlots.push(slot);
        if (isSingleSlot) {
          brandOccupiedDates.add(dayKey); // prevent picking another slot the same day (brand-wide)
          occupiedLocalDates.add(dayKey); // also track for campaign
        } else {
          const timeKey = `${String(slotLocal.getHours()).padStart(2, '0')}:${String(
            slotLocal.getMinutes()
          ).padStart(2, '0')}`;
          occupiedLocalSlotKeys.add(`${dayKey}T${timeKey}`);
        }
        occupiedLocalWeeks.set(slotWeekKey, currentWeekCount + 1);
      }
      if (selectedSlots.length >= accountRemaining) break;
    }

    if (selectedSlots.length === 0) {
      return { success: true, generated: 0, message: 'No free slots available' };
    }

    // Apply optional cap for fairness (round-robin)
    const effectiveSlots =
      Number.isFinite(maxGenerate) && (maxGenerate as number) > 0
        ? selectedSlots.slice(0, maxGenerate as number)
        : selectedSlots;

    console.log(
      `[SlidingWindow] Generating content for ${effectiveSlots.length} slots (requested max: ${maxGenerate}, available: ${selectedSlots.length})`,
      { campaignId, brandId: campaign.brandId }
    );

    // Generate and schedule content for selected slots
    let generated = 0;
    for (let i = 0; i < effectiveSlots.length; i++) {
      const slot = effectiveSlots[i];
      const theme =
        Array.isArray(config.themes) && config.themes.length > 0
          ? config.themes[i % config.themes.length]
          : undefined;
      const style = config.style;

      // 1) Generate single post
      const batch = await generateInstagramContent(campaign.brand.name, {
        brandId: campaign.brandId,
        count: 1,
        theme,
        style,
        campaignId: campaign.id,
      });
      if (!batch || batch.length === 0) continue;
      const post = batch[0]!;

      // 2) Create content as draft with scheduledAt and processing state
      // Guard with a serializable transaction and per-day uniqueness check to avoid duplicates
      let created: { id: string; generationParams: unknown } | null = null;
      await prisma.$transaction(
        async (tx) => {
          // Compute uniqueness window
          let utcStart: Date;
          let utcEnd: Date;
          if (!isSingleSlot) {
            // Multi-slot: reserve only this slot window in UTC
            utcStart = new Date(slot.getTime() - CampaignSlidingWindowService.MULTI_SLOT_WINDOW_MS);
            utcEnd = new Date(slot.getTime() + CampaignSlidingWindowService.MULTI_SLOT_WINDOW_MS);
          } else {
            // reserve whole local day
            const d = TimezoneService.toLocal(slot, timezone);
            const dayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
              d.getDate()
            ).padStart(2, '0')}`;
            // createDateInBrandTimezone already returns a UTC instant for the brand's wall time
            const utcStartDate = TimezoneService.createDateInBrandTimezone(
              dayStr,
              '00:00',
              timezone
            );
            const utcEndDate = TimezoneService.createDateInBrandTimezone(dayStr, '23:59', timezone);
            utcStart = utcStartDate;
            utcEnd = utcEndDate;
          }

          const existingCount = await tx.content.count({
            where: {
              campaignId: campaign.id,
              scheduledAt: { gte: utcStart, lte: utcEnd },
            },
          });
          if (existingCount > 0) {
            return; // another worker reserved this time window
          }
          created = await tx.content.create({
            data: {
              caption: post.caption,
              hashtags: post.hashtags,
              brandId: campaign.brandId,
              campaignId: campaign.id,
              status: 'draft',
              scheduledAt: slot, // store UTC; TimezoneService handles conversion in scheduler
              generationParams: {
                theme: theme || null,
                style: style || null,
                campaignGenerated: true,
                slidingWindow: true,
                scheduledAt: slot.toISOString(),
                processing: {
                  active: true,
                  operation: 'scheduling',
                  startedAt: new Date().toISOString(),
                  operationId: `campaign-window-${campaign.id}-${Date.now()}-${i}`,
                },
              },
            },
            select: { id: true, generationParams: true },
          });
        },
        { isolationLevel: 'Serializable' }
      );

      if (!created) {
        // Skipped due to concurrent reservation of this day
        continue;
      }

      // 2.5) Synchronous asset import via assets service to ensure media is attached
      if (post.imageUrl && post.imageMetadata) {
        const createdId = (created as { id: string }).id;
        const { imageUrl, imageMetadata } = post;

        try {
          const asset = await importImageFromExternalUrl(imageUrl, {
            contentId: createdId,
            brandId: campaign.brandId,
            campaignId: campaign.id,
            source: imageMetadata.source,
            originalPrompt: imageMetadata.originalPrompt,
          });
          await attachAssetToContent({ contentId: createdId, asset });
          console.log(`[SlidingWindow] Asset imported and attached for content ${createdId}`, {
            campaignId,
            assetId: asset.id,
          });
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          console.error(
            `[SlidingWindow] Failed to import asset for content ${createdId}; leaving post without media`,
            {
              campaignId,
              error: { name: err.name, message: err.message },
            }
          );
        }
      }

      // 3) Schedule via AWS (fire-and-forget; sync will update status)
      try {
        const createdId = (created as { id: string }).id;
        const createdGen = (created as { generationParams: unknown }).generationParams;
        const result = await schedulerService.scheduleContent(createdId, slot);
        if (!result.success) {
          // Clear processing and record error but keep the content/draft
          await prisma.content.update({
            where: { id: createdId },
            data: {
              generationParams: {
                ...((createdGen as Record<string, unknown>) || {}),
                processing: null,
                schedulingError: result.error || 'Scheduling failed',
              },
            },
          });
        }
      } catch (e) {
        await prisma.content.update({
          where: { id: (created as { id: string }).id },
          data: {
            generationParams: {
              ...(((created as { generationParams: unknown }).generationParams as Record<
                string,
                unknown
              >) || {}),
              processing: null,
              schedulingError: e instanceof Error ? e.message : 'Scheduling error',
            },
          },
        });
      }

      generated++;
    }

    return { success: true, generated };
  }

  /**
   * Compute upcoming posting slots for a campaign based on frequency and postingTime.
   * Returns Date objects representing the brand-local time converted to UTC for storage.
   */
  private async computeUpcomingSlots(
    start: Date,
    end: Date,
    postingTime: string,
    frequency: 'daily' | 'every2days' | '3weekly' | string,
    timezone: string,
    maxSlots: number
  ): Promise<Date[]> {
    const slots: Date[] = [];
    const [hours, minutes] = postingTime.split(':').map((n) => parseInt(n, 10));

    const todayLocal = TimezoneService.toLocal(new Date(), timezone);
    const startLocal = TimezoneService.toLocal(start, timezone);
    const endLocal = TimezoneService.toLocal(end, timezone);

    // Start from the later of campaign start or today
    let cursor = new Date(Math.max(startLocal.getTime(), todayLocal.getTime()));

    // Normalize to date only
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());

    // Determine day step
    const intervalDays =
      frequency === 'daily' ? 1 : frequency === 'every2days' ? 2 : frequency === '3weekly' ? 3 : 7;

    while (cursor <= endLocal && slots.length < maxSlots) {
      // Create brand-local scheduled time (already converted to UTC)
      const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      const scheduledUtc = TimezoneService.createDateInBrandTimezone(
        dateStr,
        `${String(hours ?? 12).padStart(2, '0')}:${String(minutes ?? 0).padStart(2, '0')}`,
        timezone
      );

      if (scheduledUtc > todayLocal) {
        slots.push(scheduledUtc);
      }

      // Advance cursor
      cursor.setDate(cursor.getDate() + intervalDays);
    }

    return slots;
  }
}

export const campaignSlidingWindowService = new CampaignSlidingWindowService();
