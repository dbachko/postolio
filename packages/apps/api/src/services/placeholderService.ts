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
          })
        : {};

    if (!config?.frequency || !config?.duration) {
      console.log(
        `[Placeholders] Skipping campaign ${campaign.name} - missing frequency or duration`
      );
      continue;
    }

    const { frequency, duration, postingTime = '12:00' } = config;
    if (!duration?.start || !duration?.end) {
      console.log(`[Placeholders] Skipping campaign ${campaign.name} - invalid duration`);
      continue;
    }

    const campaignStart = new Date(duration.start);
    const campaignEnd = new Date(duration.end);

    // Resolve brand timezone (per-campaign)
    const timezone = await TimezoneService.getBrandTimezone(campaign.brandId);

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

    // Validate posting time format
    const timeParts = postingTime.split(':');
    if (timeParts.length !== 2) {
      console.error(
        `[Placeholders] Invalid posting time format for campaign ${campaign.name}: ${postingTime}`
      );
      continue;
    }

    const hours = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10);

    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      console.error(
        `[Placeholders] Invalid hours/minutes for campaign ${campaign.name}: ${hours}:${minutes}`
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
      // Build a UTC instant for the brand-local date at the posting time
      const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
      const scheduledAtUTC = TimezoneService.createDateInBrandTimezone(
        dateStr,
        `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
        timezone
      );

      // Check if content already exists for this slot (within 2 hour window)
      const hasContent = existingContent.some((content) => {
        if (!content.scheduledAt) return false;
        const contentTime = new Date(content.scheduledAt).getTime();
        const slotTime = scheduledAtUTC.getTime();
        return Math.abs(contentTime - slotTime) < 2 * 60 * 60 * 1000; // 2 hour window
      });

      // Only add placeholder if no content exists for this slot and it's in the future
      if (!hasContent && scheduledAtUTC > now) {
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
