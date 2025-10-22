import type { Campaign, Content } from '@postolio/database';
import { TimezoneService } from './timezone.js';

export interface CalendarPlaceholder {
  id: string;
  type: 'placeholder';
  campaignId: string;
  campaignName: string;
  campaignColor: string | null;
  scheduledAt: string;
  status: 'placeholder';
  message: string;
}

export async function computePlaceholders(
  campaigns: Campaign[],
  existingContent: Content[],
  monthStart: Date,
  monthEnd: Date
): Promise<CalendarPlaceholder[]> {
  const placeholders: CalendarPlaceholder[] = [];
  const now = new Date(); // Cache current time for consistent comparisons
  const CONFLICT_WINDOW_MS = 90 * 60 * 1000; // ±90 minutes conflict window

  console.log(
    `[Placeholders] Computing for month ${monthStart.toISOString()} to ${monthEnd.toISOString()}`
  );
  console.log(`[Placeholders] Processing ${campaigns.length} campaigns`);

  for (const campaign of campaigns) {
    const raw = campaign.config as unknown;
    const config =
      raw && typeof raw === 'object'
        ? (raw as {
            frequency?: string;
            duration?: { start?: string; end?: string };
            postingTime?: string;
            postingTimes?: string[];
          })
        : {};

    if (!config?.frequency || !config?.duration) {
      console.log(
        `[Placeholders] Skipping campaign ${campaign.name} - missing frequency or duration`
      );
      continue;
    }

    const { frequency, duration } = config;
    // Always use primary postingTime for placeholders (single per day)
    const postingTime = (config.postingTime || '12:00').trim();
    const [ph, pm] = postingTime.split(':');
    const primaryTime = `${String(parseInt(ph ?? '0', 10)).padStart(2, '0')}:${String(
      parseInt(pm ?? '0', 10)
    ).padStart(2, '0')}`;
    if (!duration?.start || !duration?.end) {
      console.log(`[Placeholders] Skipping campaign ${campaign.name} - invalid duration`);
      continue;
    }

    const campaignStart = new Date(duration.start);
    const campaignEnd = new Date(duration.end);

    // Resolve brand timezone (per-campaign)
    const timezone = await TimezoneService.getBrandTimezone(campaign.brandId);

    // Build set of occupied local dates for THIS campaign only
    const occupiedLocalDates = new Set<string>();
    const toLocalKey = (d: Date) => {
      const local = TimezoneService.toLocal(d, timezone);
      const key = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(
        local.getDate()
      ).padStart(2, '0')}`;
      return key;
    };
    for (const c of existingContent) {
      // Track dates for this specific campaign
      if (c.campaignId === campaign.id) {
        if (c.postedAt) {
          occupiedLocalDates.add(toLocalKey(new Date(c.postedAt)));
        }
        if (c.scheduledAt) {
          occupiedLocalDates.add(toLocalKey(new Date(c.scheduledAt)));
        }
      }
    }

    // Calculate posting schedule within month bounds
    const scheduleStart = new Date(Math.max(monthStart.getTime(), campaignStart.getTime()));
    const scheduleEnd = new Date(Math.min(monthEnd.getTime(), campaignEnd.getTime()));

    // Skip if campaign doesn't overlap with this month
    if (scheduleStart > scheduleEnd) {
      console.log(`[Placeholders] Skipping campaign ${campaign.name} - doesn't overlap with month`);
      continue;
    }

    // Generate a single placeholder per day based on frequency and primary posting time
    const intervalDays =
      frequency === 'daily'
        ? 1
        : frequency === 'every2days'
          ? 2
          : frequency === '3weekly'
            ? 7 / 3 // Post roughly every 2-3 days for 3 per week
            : 7;

    // Validate posting time(s) format
    const invalidTime = (() => {
      const parts = primaryTime.split(':');
      if (parts.length !== 2) return true;
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      return isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59;
    })();
    if (invalidTime) {
      console.error(
        `[Placeholders] Invalid posting time format for campaign ${campaign.name}: ${primaryTime}`
      );
      continue;
    }

    // Work with a cursor in the brand's local timezone to avoid DST drift
    const scheduleStartLocal = TimezoneService.toLocal(scheduleStart, timezone);
    const scheduleEndLocal = TimezoneService.toLocal(scheduleEnd, timezone);
    const currentDate = new Date(
      scheduleStartLocal.getFullYear(),
      scheduleStartLocal.getMonth(),
      scheduleStartLocal.getDate()
    );
    let generatedCount = 0;

    while (currentDate <= scheduleEndLocal) {
      const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(
        currentDate.getDate()
      ).padStart(2, '0')}`;

      // Build a UTC instant for the brand-local date at the primary posting time
      const scheduledAtUTC = TimezoneService.createDateInBrandTimezone(
        dateStr,
        primaryTime,
        timezone
      );

      // Skip past slots
      if (!(scheduledAtUTC > now)) {
        currentDate.setDate(currentDate.getDate() + Math.ceil(intervalDays));
        continue;
      }

      // Per-campaign day-level suppression: if any content exists for this day, skip
      const dayKey = toLocalKey(scheduledAtUTC);
      const dayHasCampaignContent = occupiedLocalDates.has(dayKey);

      // Window-based suppression (±90m) for same-campaign nearby posts
      const withinWindow = existingContent.some((content) => {
        if (content.campaignId !== campaign.id) return false;
        const slotTime = scheduledAtUTC.getTime();
        const schedMs = content.scheduledAt ? new Date(content.scheduledAt).getTime() : null;
        const postedMs = content.postedAt ? new Date(content.postedAt).getTime() : null;
        const within = (ms: number | null) =>
          ms === null ? false : Math.abs(ms - slotTime) < CONFLICT_WINDOW_MS;
        return within(schedMs) || within(postedMs);
      });

      if (!dayHasCampaignContent && !withinWindow) {
        placeholders.push({
          id: `placeholder-${campaign.id}-${scheduledAtUTC.toISOString()}`,
          type: 'placeholder',
          campaignId: campaign.id,
          campaignName: campaign.name,
          campaignColor: campaign.color,
          scheduledAt: scheduledAtUTC.toISOString(),
          status: 'placeholder',
          message: 'Content will be generated closer to scheduled date',
        });
        generatedCount++;
      }

      // Move to next posting date - add the full interval in days
      // Don't adjust hours separately to keep posting time consistent
      currentDate.setDate(currentDate.getDate() + Math.ceil(intervalDays));

      // Safety check to prevent infinite loops
      if (generatedCount > 100) {
        console.warn(
          `[Placeholders] Generated over 100 placeholders for campaign ${campaign.name}, stopping`
        );
        break;
      }
    }

    console.log(
      `[Placeholders] Campaign ${campaign.name}: using primary postingTime ${primaryTime}, ` +
        `${occupiedLocalDates.size} campaign days occupied, ` +
        `${generatedCount} placeholders generated`
    );
  }

  console.log(`[Placeholders] Total placeholders generated: ${placeholders.length}`);

  // Sort by scheduled time
  return placeholders.sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  );
}
