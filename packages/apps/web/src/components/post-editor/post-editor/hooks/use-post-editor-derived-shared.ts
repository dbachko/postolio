import { getPlatformConfig, type Platform } from '@/lib/platform-config';

export type QueueSlotState = {
  allHaveSlots: boolean;
  anyMissing: boolean;
  anyUnknown: boolean;
  anyLoading: boolean;
  anyError: boolean;
};

export function supportsScheduling(platform: Platform): boolean {
  try {
    return getPlatformConfig(platform).features.scheduling;
  } catch {
    return false;
  }
}

export function assessQueueSlotState(params: {
  accountIds: string[];
  queueSlotsBySocialAccountId: Record<string, boolean | null>;
  queueSlotsLoadingBySocialAccountId: Record<string, boolean>;
  queueSlotsErrorBySocialAccountId: Record<string, boolean>;
}): QueueSlotState {
  const uniqueIds = Array.from(
    new Set(
      params.accountIds
        .map((accountId) => (typeof accountId === 'string' ? accountId.trim() : ''))
        .filter(Boolean)
    )
  );

  if (uniqueIds.length === 0) {
    return {
      allHaveSlots: false,
      anyMissing: false,
      anyUnknown: false,
      anyLoading: false,
      anyError: false,
    };
  }

  let anyMissing = false;
  let anyUnknown = false;
  let anyLoading = false;
  let anyError = false;

  for (const accountId of uniqueIds) {
    const hasSlots = params.queueSlotsBySocialAccountId[accountId];
    if (hasSlots === false) {
      anyMissing = true;
    }
    if (hasSlots === null || hasSlots === undefined) {
      anyUnknown = true;
    }
    if (params.queueSlotsLoadingBySocialAccountId[accountId]) {
      anyLoading = true;
    }
    if (params.queueSlotsErrorBySocialAccountId[accountId]) {
      anyError = true;
    }
  }

  return { allHaveSlots: !anyMissing && !anyUnknown, anyMissing, anyUnknown, anyLoading, anyError };
}
