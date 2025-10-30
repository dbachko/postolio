import { getLocalSetting, removeLocalSetting, setLocalSetting } from '@/lib/settings/localSettings';

export function getStoredCampaignColor(campaignId: string | null | undefined): string | null {
  try {
    if (!campaignId) return null;
    const val = getLocalSetting<string>(`campaignColor::${campaignId}`);
    return val ?? null;
  } catch {
    return null;
  }
}

export function setStoredCampaignColor(
  campaignId: string | null | undefined,
  value: string | null | undefined
): void {
  try {
    if (!campaignId) return;
    if (!value) removeLocalSetting(`campaignColor::${campaignId}`);
    else setLocalSetting<string>(`campaignColor::${campaignId}`, value);
  } catch {
    /* noop */
  }
}
