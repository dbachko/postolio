export function getStoredCampaignColor(campaignId: string | null | undefined): string | null {
  try {
    if (!campaignId || typeof window === 'undefined') return null;
    return localStorage.getItem(`campaignColor::${campaignId}`);
  } catch {
    return null;
  }
}

export function setStoredCampaignColor(
  campaignId: string | null | undefined,
  value: string | null | undefined
): void {
  try {
    if (!campaignId || typeof window === 'undefined') return;
    if (!value) {
      localStorage.removeItem(`campaignColor::${campaignId}`);
    } else {
      localStorage.setItem(`campaignColor::${campaignId}`, value);
    }
  } catch {
    /* noop */
  }
}
