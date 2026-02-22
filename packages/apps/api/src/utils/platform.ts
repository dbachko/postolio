import type { Platform as ValidationPlatform } from '@postolio/content-validation';
import type { Platform as SchedulerPlatform } from '../clients/content-scheduler-client.js';

export function toSchedulerPlatform(platform: string): SchedulerPlatform | null {
  const normalized = (platform || '').toLowerCase();
  if (normalized === 'x') {
    return 'twitter';
  }

  if (
    normalized === 'instagram' ||
    normalized === 'facebook' ||
    normalized === 'twitter' ||
    normalized === 'linkedin' ||
    normalized === 'youtube'
  ) {
    return normalized as SchedulerPlatform;
  }

  return null;
}

export function toValidationPlatform(platform: string): ValidationPlatform | null {
  const normalized = (platform || '').toLowerCase();
  if (normalized === 'x') {
    return 'twitter';
  }

  if (
    normalized === 'instagram' ||
    normalized === 'facebook' ||
    normalized === 'twitter' ||
    normalized === 'linkedin' ||
    normalized === 'youtube'
  ) {
    return normalized as ValidationPlatform;
  }

  return null;
}

const SCHEDULING_SUPPORTED_PLATFORMS = new Set<SchedulerPlatform>(['instagram', 'facebook']);

export function supportsScheduling(platform: string): boolean {
  const schedulerPlatform = toSchedulerPlatform(platform);
  if (!schedulerPlatform) {
    return false;
  }
  return SCHEDULING_SUPPORTED_PLATFORMS.has(schedulerPlatform);
}
