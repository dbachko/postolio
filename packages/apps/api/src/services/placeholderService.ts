import type { Campaign, Content } from '@postolio/database';
import { TimezoneService } from './timezone.js';

export interface CalendarPlaceholder {
  id: string;
  type: 'placeholder';
  campaignId: string;
  campaignName: string;
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

    const { frequency, duration, postingTime = '12:00' } = config;
    const postingTimes = Array.isArray(config.postingTimes)
      ? (config.postingTimes as string[])
      : [];
    const normalizedTimes = (postingTimes.length > 0 ? postingTimes : [postingTime])
      .filter(Boolean)
      .map((t) => {
        const [h, m] = t.split(':');
        const hh = String(parseInt(h ?? '0', 10)).padStart(2, '0');
        const mm = String(parseInt(m ?? '0', 10)).padStart(2, '0');
        return `${hh}:${mm}`;
      })
      // de-duplicate times
      .filter((v, i, a) => a.indexOf(v) === i);
    if (!duration?.start || !duration?.end) {
      console.log(`[Placeholders] Skipping campaign ${campaign.name} - invalid duration`);
      continue;
    }

    const campaignStart = new Date(duration.start);
    const campaignEnd = new Date(duration.end);

    // Resolve brand timezone (per-campaign)
    const timezone = await TimezoneService.getBrandTimezone(campaign.brandId);

    // Build a set of occupied local dates for this campaign, based on both scheduledAt and postedAt
    // This ensures we never place a placeholder on a day that already has content for the campaign
    const occupiedLocalDates = new Set<string>();
    const toLocalKey = (d: Date) => {
      const local = TimezoneService.toLocal(d, timezone);
      const key = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(
        local.getDate()
      ).padStart(2, '0')}`;
      return key;
    };
    for (const c of existingContent) {
      if (c.campaignId !== campaign.id) continue;
      if (c.postedAt) {
        occupiedLocalDates.add(toLocalKey(new Date(c.postedAt)));
      }
      if (c.scheduledAt) {
        occupiedLocalDates.add(toLocalKey(new Date(c.scheduledAt)));
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

    // Generate placeholder dates based on frequency
    const intervalDays =
      frequency === 'daily'
        ? 1
        : frequency === 'every2days'
          ? 2
          : frequency === '3weekly'
            ? 7 / 3 // Post every ~2.33 days for 3 times per week
            : 7;

    // Validate posting time(s) format
    const invalidTime = normalizedTimes.find((t) => {
      const parts = t.split(':');
      if (parts.length !== 2) return true;
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      return isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59;
    });
    if (invalidTime) {
      console.error(
        `[Placeholders] Invalid posting time format for campaign ${campaign.name}: ${invalidTime}`
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

      for (const t of normalizedTimes) {
        // Build a UTC instant for the brand-local date at the posting time
        const scheduledAtUTC = TimezoneService.createDateInBrandTimezone(dateStr, t, timezone);

        // Skip past slots
        if (!(scheduledAtUTC > now)) continue;

        // Check if content already exists for this slot (within 2 hour window), considering scheduledAt and postedAt
        const hasContent = existingContent.some((content) => {
          if (content.campaignId !== campaign.id) return false;
          const slotTime = scheduledAtUTC.getTime();
          const schedMs = content.scheduledAt ? new Date(content.scheduledAt).getTime() : null;
          const postedMs = content.postedAt ? new Date(content.postedAt).getTime() : null;
          const within = (ms: number | null) =>
            ms === null ? false : Math.abs(ms - slotTime) < 2 * 60 * 60 * 1000;
          return within(schedMs) || within(postedMs);
        });

        // For single-time-per-day campaigns (no postingTimes array), block the entire day if any content exists that day
        let dayBlocked = false;
        if (postingTimes.length === 0) {
          // If any content exists on the same local day for this campaign, block
          dayBlocked = existingContent.some((content) => {
            if (content.campaignId !== campaign.id) return false;
            const ref = content.postedAt || content.scheduledAt;
            if (!ref) return false;
            const refKey = toLocalKey(new Date(ref));
            const slotKey = toLocalKey(scheduledAtUTC);
            return refKey === slotKey;
          });
        }

        if (!hasContent && !dayBlocked) {
          placeholders.push({
            id: `placeholder-${campaign.id}-${scheduledAtUTC.toISOString()}`,
            type: 'placeholder',
            campaignId: campaign.id,
            campaignName: campaign.name,
            scheduledAt: scheduledAtUTC.toISOString(),
            status: 'placeholder',
            message: 'Content will be generated closer to scheduled date',
          });
          generatedCount++;
        }
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
      `[Placeholders] Generated ${generatedCount} placeholders for campaign ${campaign.name}`
    );
  }

  console.log(`[Placeholders] Total placeholders generated: ${placeholders.length}`);

  // Sort by scheduled time
  return placeholders.sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  );
}
