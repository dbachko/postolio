import type { Campaign, Content } from '@postolio/database';

export interface CalendarPlaceholder {
  id: string;
  type: 'placeholder';
  campaignId: string;
  campaignName: string;
  scheduledAt: string;
  status: 'placeholder';
  message: string;
}

export function computePlaceholders(
  campaigns: Campaign[],
  existingContent: Content[],
  monthStart: Date,
  monthEnd: Date
): CalendarPlaceholder[] {
  const placeholders: CalendarPlaceholder[] = [];
  const now = new Date(); // Cache current time for consistent comparisons

  console.log(
    `[Placeholders] Computing for month ${monthStart.toISOString()} to ${monthEnd.toISOString()}`
  );
  console.log(`[Placeholders] Processing ${campaigns.length} campaigns`);

  campaigns.forEach((campaign) => {
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
      return;
    }

    const { frequency, duration, postingTime = '12:00' } = config;
    if (!duration?.start || !duration?.end) {
      console.log(`[Placeholders] Skipping campaign ${campaign.name} - invalid duration`);
      return;
    }

    const campaignStart = new Date(duration.start);
    const campaignEnd = new Date(duration.end);

    // Calculate posting schedule within month bounds
    const scheduleStart = new Date(Math.max(monthStart.getTime(), campaignStart.getTime()));
    const scheduleEnd = new Date(Math.min(monthEnd.getTime(), campaignEnd.getTime()));

    // Skip if campaign doesn't overlap with this month
    if (scheduleStart > scheduleEnd) {
      console.log(`[Placeholders] Skipping campaign ${campaign.name} - doesn't overlap with month`);
      return;
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
      return;
    }

    const hours = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10);

    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      console.error(
        `[Placeholders] Invalid hours/minutes for campaign ${campaign.name}: ${hours}:${minutes}`
      );
      return;
    }

    const currentDate = new Date(scheduleStart);
    let generatedCount = 0;

    while (currentDate <= scheduleEnd) {
      // Create a new date for the scheduled time to avoid mutation issues
      const scheduledAt = new Date(currentDate);
      scheduledAt.setHours(hours, minutes, 0, 0);

      // Check if content already exists for this slot (within 2 hour window)
      const hasContent = existingContent.some((content) => {
        if (!content.scheduledAt) return false;
        const contentTime = new Date(content.scheduledAt).getTime();
        const slotTime = scheduledAt.getTime();
        return Math.abs(contentTime - slotTime) < 2 * 60 * 60 * 1000; // 2 hour window
      });

      // Only add placeholder if no content exists for this slot and it's in the future
      if (!hasContent && scheduledAt > now) {
        placeholders.push({
          id: `placeholder-${campaign.id}-${scheduledAt.toISOString()}`,
          type: 'placeholder',
          campaignId: campaign.id,
          campaignName: campaign.name,
          scheduledAt: scheduledAt.toISOString(),
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
  });

  console.log(`[Placeholders] Total placeholders generated: ${placeholders.length}`);

  // Sort by scheduled time
  return placeholders.sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  );
}
