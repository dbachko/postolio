import type { Campaign, Content } from "@postolio/database";

export interface CalendarPlaceholder {
  id: string;
  type: "placeholder";
  campaignId: string;
  campaignName: string;
  scheduledAt: string;
  status: "placeholder";
  message: string;
}

export function computePlaceholders(
  campaigns: Campaign[],
  existingContent: Content[],
  monthStart: Date,
  monthEnd: Date,
): CalendarPlaceholder[] {
  const placeholders: CalendarPlaceholder[] = [];

  campaigns.forEach((campaign) => {
    const raw = campaign.config as unknown;
    const config =
      raw && typeof raw === "object"
        ? (raw as {
            frequency?: string;
            duration?: { start?: string; end?: string };
            postingTime?: string;
          })
        : {};
    if (!config?.frequency || !config?.duration) return;

    const { frequency, duration, postingTime = "12:00" } = config;
    if (!duration?.start || !duration?.end) return;
    const campaignStart = new Date(duration.start);
    const campaignEnd = new Date(duration.end);

    // Calculate posting schedule within month bounds
    const scheduleStart = new Date(
      Math.max(monthStart.getTime(), campaignStart.getTime()),
    );
    const scheduleEnd = new Date(
      Math.min(monthEnd.getTime(), campaignEnd.getTime()),
    );

    // Skip if campaign doesn't overlap with this month
    if (scheduleStart > scheduleEnd) return;

    // Generate placeholder dates based on frequency
    const intervalDays =
      frequency === "daily"
        ? 1
        : frequency === "every2days"
          ? 2
          : frequency === "3weekly"
            ? 2.33
            : 7;

    const currentDate = new Date(scheduleStart);
    const [hours, minutes] = postingTime.split(":").map(Number);

    while (currentDate <= scheduleEnd) {
      // Set the posting time
      const scheduledAt = new Date(currentDate);
      scheduledAt.setHours(hours, minutes, 0, 0);

      // Check if content already exists for this slot (within 2 hour window)
      const hasContent = existingContent.some((content) => {
        if (!content.scheduledAt) return false;
        const contentTime = new Date(content.scheduledAt).getTime();
        const slotTime = scheduledAt.getTime();
        return Math.abs(contentTime - slotTime) < 2 * 60 * 60 * 1000; // 2 hour window
      });

      // Only add placeholder if no content exists for this slot
      if (!hasContent && scheduledAt >= new Date()) {
        // Only show future placeholders
        placeholders.push({
          id: `placeholder-${campaign.id}-${scheduledAt.toISOString()}`,
          type: "placeholder",
          campaignId: campaign.id,
          campaignName: campaign.name,
          scheduledAt: scheduledAt.toISOString(),
          status: "placeholder",
          message: "Content will be generated closer to scheduled date",
        });
      }

      // Move to next posting date
      currentDate.setDate(currentDate.getDate() + Math.floor(intervalDays));
      if (intervalDays % 1 !== 0) {
        // Handle fractional days (e.g., 3 times per week)
        const fractionalHours = (intervalDays % 1) * 24;
        currentDate.setHours(currentDate.getHours() + fractionalHours);
      }
    }
  });

  // Sort by scheduled time
  return placeholders.sort(
    (a, b) =>
      new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  );
}
