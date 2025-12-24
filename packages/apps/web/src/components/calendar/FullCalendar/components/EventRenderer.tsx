import type { MouseEventHandler } from 'react';
import { PostPreviewCard } from '@/components/PostPreviewCard';
import type { CalendarItem } from '@/types/calendar';
import type { SocialAccountsById } from '@/types/social-accounts';
import type { CalendarEvent } from '../types';
import type { AssetType } from '@/features/assets/api/client';

interface EventRendererProps {
  event: CalendarEvent;
  timezone: string;
  brandId: string;
  onReschedule: (item: CalendarItem) => void;
  assetsById?: Record<string, AssetType | null>;
  socialAccountsById?: SocialAccountsById;
  hideDestinations?: boolean;
}

export function EventRenderer({
  event,
  timezone,
  brandId,
  onReschedule,
  assetsById,
  socialAccountsById,
  hideDestinations = false,
}: EventRendererProps) {
  const rawResource = event.resource as unknown as Record<string, unknown> | undefined;
  if (rawResource?.type === 'more') {
    return null;
  }

  const resource = event.resource;
  const cardItem = buildCardItem(resource, brandId);
  const handleClick: MouseEventHandler<HTMLDivElement> = (e) => {
    e.stopPropagation();
  };

  if (!cardItem) {
    return <div className="text-sm">{event.title}</div>;
  }

  const primaryAssetId =
    (cardItem as any)?.primaryAssetId || (cardItem as any)?.mediaAssets?.[0]?.assetId || null;
  const primaryAsset = primaryAssetId ? (assetsById?.[primaryAssetId] ?? null) : null;

  return (
    <div onClick={handleClick}>
      <PostPreviewCard
        item={cardItem}
        timezone={timezone}
        onReschedule={onReschedule}
        primaryAsset={primaryAsset}
        socialAccountsById={socialAccountsById}
        hideDestinations={hideDestinations}
      />
    </div>
  );
}

function buildCardItem(resource: CalendarEvent['resource'], brandId: string): CalendarItem | null {
  const raw = resource.item;
  if (!raw) return null;

  if (resource.placeholder) {
    const record = raw as unknown as Record<string, unknown>;
    const nowIso = new Date().toISOString();

    const placeholder: CalendarItem = {
      id: String(record.id ?? resource.campaignId ?? nowIso),
      type: 'placeholder',
      campaignId: toStringOrDefault(record.campaignId, resource.campaignId, 'none'),
      campaignName: toStringOrDefault(record.campaignName, resource.campaignName, ''),
      campaignColor: toNullableString(record.campaignColor ?? resource.campaignColor),
      scheduledAt: toStringOrDefault(record.scheduledAt, resource.scheduledAt, nowIso),
      status: 'placeholder',
      message: toStringOrDefault(record.message, '', ''),
      caption: toStringOrDefault(record.caption, '', ''),
      hashtags: Array.isArray(record.hashtags) ? (record.hashtags as unknown[]).map(String) : [],
      brandId: toStringOrDefault(record.brandId, brandId, brandId),
      createdAt: toStringOrDefault(record.createdAt, resource.scheduledAt, nowIso),
      postedAt: undefined,
    } as CalendarItem;

    const targetSocialAccountId =
      typeof record.targetSocialAccountId === 'string' && record.targetSocialAccountId.trim()
        ? record.targetSocialAccountId.trim()
        : null;
    if (targetSocialAccountId) (placeholder as any).targetSocialAccountId = targetSocialAccountId;

    const targetSocialAccountIds = Array.isArray(record.targetSocialAccountIds)
      ? (record.targetSocialAccountIds as unknown[])
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.trim())
          .filter(Boolean)
      : [];
    if (targetSocialAccountIds.length > 0)
      (placeholder as any).targetSocialAccountIds = targetSocialAccountIds;

    const laneKey = typeof record.laneKey === 'string' ? record.laneKey : null;
    if (laneKey) (placeholder as any).laneKey = laneKey;

    return placeholder;
  }

  const content = {
    ...(raw as unknown as Record<string, unknown>),
    type: 'content',
  } as CalendarItem;
  return content;
}

function toStringOrDefault(value: unknown, fallback: unknown, defaultValue: string): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof fallback === 'string' && fallback.length > 0) return fallback;
  return defaultValue;
}

function toNullableString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  return null;
}
