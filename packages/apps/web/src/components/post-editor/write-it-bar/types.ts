import type { ReactNode } from 'react';

export type PostingAction = 'queue' | 'datetime' | 'now';
export type PostingPopoverView = 'menu' | 'datetime';

export type WriteItBarLayout = 'sidebar' | 'page';

export type WriteItBarProps =
  | {
      mode: 'create';
      layout: WriteItBarLayout;
      leadingActions?: ReactNode;
      scheduledAt: string;
      minScheduleInput: string;
      brandTimezone: string;
      atCapacity: boolean;
      scheduleBlocker: string | null;
      createScheduleDisabled: boolean;
      isCreatingPost: boolean;
      saveDraftDisabled: boolean;
      saveDraftBlocker: string | null;
      publishNowDisabled: boolean;
      publishNowBlocker: string | null;
      previewHandle?: ReactNode;
      onScheduledAtChange: (value: string) => void;
      onSchedule: () => void;
      onSaveDraft: () => void;
      onAddToQueue: () => void;
      onPublishNow: () => void;
      queueDisabled: boolean;
      queueBlocker: string | null;
      onPickSlot: () => void;
      pickSlotDisabled: boolean;
      pickSlotBlocker: string | null;
      onUpgradePlan?: () => void;
    }
  | {
      mode: 'edit';
      layout: WriteItBarLayout;
      leadingActions?: ReactNode;
      scheduledAt: string;
      minScheduleInput: string;
      brandTimezone: string;
      isScheduled: boolean;
      hasChanges: boolean;
      isSaving: boolean;
      isUnscheduling: boolean;
      validationOk: boolean;
      primaryEditCtaLabel: string;
      previewHandle?: ReactNode;
      onScheduledAtChange: (value: string) => void;
      onUnschedule: () => void;
      onSave: () => void | Promise<boolean>;
      onAddToQueue?: () => void;
      queueDisabled?: boolean;
      isQueueing?: boolean;
      onPublishNow?: () => void;
      publishNowDisabled?: boolean;
      publishNowBlocker?: string | null;
      isPublishingNow?: boolean;
      onPickSlot?: () => void;
      pickSlotDisabled?: boolean;
      pickSlotBlocker?: string | null;
    };
