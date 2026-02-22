import { useMemo } from 'react';
import { formatInTimeZone } from 'date-fns-tz';

import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';
import type { PostEditorFormState } from '@/components/post-editor/post-editor-main-body/types';
import type { PostDetailData } from '@/hooks/usePostDetail';
import { cn } from '@/lib/utils';
import { getPlatformConfig, type Platform } from '@/lib/platform-config';
import { validateContentPayload, type InstagramMediaType } from '@postolio/content-validation';

import type { PostEditorLayout } from '../types';
import {
  deriveMediaTypeFromAssets,
  getScheduleBlockerMessage,
  toValidationPlatform,
} from '../utils';

export function usePostEditorDerived(params: {
  id?: string;
  layout: PostEditorLayout;
  isMultiDestinationGroup: boolean;
  groupDestinations: Array<{
    contentId: string;
    platform: Platform;
    label: string;
    disconnected: boolean;
  }>;
  groupPlatforms: Platform[];
  contentGroupSchedule: { kind: 'none' | 'uniform' | 'mixed'; scheduledAt: string | null };
  post: PostDetailData | undefined;
  brandTimezone: string;
  atCapacity: boolean;
  limitMessage: string;
  formData: PostEditorFormState;
  firstCommentOpen: boolean;
  selectedPlatformAccountIds: string[];
  platformPickerOptions: SocialAccountsPickerOption[];
  selectedPlatforms: Platform[];
  schedulingSupported: boolean;
  publishingSupported: boolean;
  queueActionAccountIds: string[];
  queueSlotsBySocialAccountId: Record<string, boolean | null>;
  queueSlotsLoadingBySocialAccountId: Record<string, boolean>;
  queueSlotsErrorBySocialAccountId: Record<string, boolean>;
  isCreatingPost: boolean;
}) {
  const {
    atCapacity,
    brandTimezone,
    contentGroupSchedule,
    firstCommentOpen,
    formData,
    groupDestinations,
    groupPlatforms,
    id,
    isCreatingPost,
    isMultiDestinationGroup,
    layout,
    limitMessage,
    platformPickerOptions,
    post,
    publishingSupported,
    queueActionAccountIds,
    queueSlotsBySocialAccountId,
    queueSlotsErrorBySocialAccountId,
    queueSlotsLoadingBySocialAccountId,
    schedulingSupported,
    selectedPlatformAccountIds,
    selectedPlatforms,
  } = params;

  const finalMediaType = useMemo<InstagramMediaType>(() => {
    return deriveMediaTypeFromAssets(formData.carouselAssets, formData.contentType);
  }, [formData.carouselAssets, formData.contentType]);

  const validation = useMemo(() => {
    const isStory = formData.contentType === 'story';
    const mediaAssets: Array<{ key: string; type: InstagramMediaType }> = (
      formData.carouselAssets || []
    )
      .filter((asset) => typeof asset.id === 'string' && asset.id.trim().length > 0)
      .map((asset) => ({
        key: asset.id,
        type: asset.type === 'video' ? 'video' : 'image',
      }));

    const platformsForValidation: Platform[] =
      selectedPlatforms.length > 0 ? selectedPlatforms : ['instagram'];

    const validations = platformsForValidation.map((platform) => {
      const validationPlatform = toValidationPlatform(platform);
      if (!validationPlatform) {
        return {
          platform,
          result: {
            ok: false,
            errors: [
              {
                field: 'platform',
                message: `Unsupported platform: ${platform}`,
                code: 'UNSUPPORTED_PLATFORM',
              },
            ],
          },
        };
      }

      return {
        platform,
        result: validateContentPayload({
          platform: validationPlatform,
          contentType: formData.contentType,
          mediaType: mediaAssets.length > 0 ? finalMediaType : undefined,
          caption: isStory ? '' : formData.caption,
          mediaAssets,
        }),
      };
    });

    const firstFail = validations.find((v) => !v.result.ok);
    if (!firstFail) {
      return { ok: true, errors: [] };
    }

    return {
      ok: false,
      errors: firstFail.result.errors.map((e) => ({
        ...e,
        message: `${firstFail.platform}: ${e.message}`,
      })),
    };
  }, [
    finalMediaType,
    formData.caption,
    formData.carouselAssets,
    formData.contentType,
    selectedPlatforms,
  ]);

  const validationError = validation.ok ? null : validation.errors[0]?.message;
  const hasSelectedPlatforms = selectedPlatformAccountIds.length > 0;

  const assessQueueSlotState = useMemo(() => {
    return (accountIds: string[]) => {
      const uniqueIds = Array.from(
        new Set(
          accountIds
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
        const hasSlots = queueSlotsBySocialAccountId[accountId];
        if (hasSlots === false) {
          anyMissing = true;
        }
        if (hasSlots === null || hasSlots === undefined) {
          anyUnknown = true;
        }
        if (queueSlotsLoadingBySocialAccountId[accountId]) {
          anyLoading = true;
        }
        if (queueSlotsErrorBySocialAccountId[accountId]) {
          anyError = true;
        }
      }

      const allHaveSlots = !anyMissing && !anyUnknown;
      return { allHaveSlots, anyMissing, anyUnknown, anyLoading, anyError };
    };
  }, [
    queueSlotsBySocialAccountId,
    queueSlotsErrorBySocialAccountId,
    queueSlotsLoadingBySocialAccountId,
  ]);

  const queueSupportedForSelection = useMemo(() => {
    if (selectedPlatformAccountIds.length === 0) {
      return false;
    }
    const byId = new Map(platformPickerOptions.map((o) => [o.id, o]));
    return selectedPlatformAccountIds.every((accountId) => {
      const opt = byId.get(accountId);
      if (!opt) {
        return false;
      }
      try {
        return getPlatformConfig(opt.platform).features.scheduling;
      } catch {
        return false;
      }
    });
  }, [platformPickerOptions, selectedPlatformAccountIds]);

  const queueSlotStateForSelection = useMemo(
    () => assessQueueSlotState(selectedPlatformAccountIds),
    [assessQueueSlotState, selectedPlatformAccountIds]
  );

  const effectiveSchedulingSupported = useMemo(() => {
    if (!isMultiDestinationGroup) {
      return schedulingSupported;
    }
    if (groupDestinations.length === 0) {
      return false;
    }
    return groupDestinations.every(
      (dest) => dest.disconnected !== true && getPlatformConfig(dest.platform).features.scheduling
    );
  }, [groupDestinations, isMultiDestinationGroup, schedulingSupported]);

  const isCreating = !id;
  const disabled = post?.status === 'published' || Boolean(post?.postedAt);
  const isScheduled = isMultiDestinationGroup
    ? contentGroupSchedule.kind !== 'none'
    : post?.status === 'scheduled';

  const queuePlatformSupportedForPost = useMemo(() => {
    if (isCreating) {
      return queueSupportedForSelection;
    }
    if (isMultiDestinationGroup) {
      const platforms = groupPlatforms.length ? groupPlatforms : (['instagram'] as Platform[]);
      return platforms.every((p) => {
        try {
          return getPlatformConfig(p).features.scheduling;
        } catch {
          return false;
        }
      });
    }

    const targetId =
      typeof (post as any)?.targetSocialAccountId === 'string'
        ? String((post as any).targetSocialAccountId)
        : null;
    if (!targetId) {
      return false;
    }
    const opt = platformPickerOptions.find((o) => o.id === targetId) || null;
    if (!opt) {
      return false;
    }
    try {
      return getPlatformConfig(opt.platform).features.scheduling;
    } catch {
      return false;
    }
  }, [
    groupPlatforms,
    isCreating,
    isMultiDestinationGroup,
    platformPickerOptions,
    post,
    queueSupportedForSelection,
  ]);

  const queueSlotStateForPost = useMemo(
    () => assessQueueSlotState(queueActionAccountIds),
    [assessQueueSlotState, queueActionAccountIds]
  );

  const queueSupportedForPost =
    queuePlatformSupportedForPost &&
    queueSlotStateForPost.allHaveSlots &&
    !queueSlotStateForPost.anyLoading &&
    !queueSlotStateForPost.anyError;

  const minScheduleInput = useMemo(
    () => formatInTimeZone(new Date(), brandTimezone, "yyyy-MM-dd'T'HH:mm"),
    [brandTimezone]
  );

  const scheduleBlocker = getScheduleBlockerMessage({
    atCapacity,
    limitMessage,
    validationOk: validation.ok,
    validationError,
    hasScheduleTime: Boolean(formData.scheduledAt),
    hasSelectedPlatforms,
    schedulingSupported: effectiveSchedulingSupported,
  });
  const createScheduleDisabled = isCreatingPost || Boolean(scheduleBlocker);

  const hasDraftInputs =
    Boolean((formData.caption || '').trim()) ||
    (firstCommentOpen && Boolean((formData.firstComment || '').trim())) ||
    (formData.carouselAssets?.length ?? 0) > 0;
  const saveDraftDisabled = !hasDraftInputs;
  const saveDraftBlocker = saveDraftDisabled
    ? 'Add a caption, media, or first comment before saving a draft.'
    : null;

  const publishNowDisabled = !validation.ok || !hasSelectedPlatforms || !publishingSupported;
  const publishNowBlocker = (() => {
    if (!hasSelectedPlatforms) {
      return 'Select at least one destination in Destinations.';
    }
    if (!publishingSupported) {
      return 'Publishing is not available for this destination.';
    }
    if (!validation.ok) {
      return validationError || 'Please fix validation errors before continuing.';
    }
    return null;
  })();

  const queueOptionDisabled =
    !hasSelectedPlatforms ||
    !queueSupportedForSelection ||
    queueSlotStateForSelection.anyLoading ||
    !queueSlotStateForSelection.allHaveSlots;
  const queueOptionBlocker = (() => {
    if (!hasSelectedPlatforms) {
      return 'Select at least one destination in Destinations.';
    }
    if (!queueSupportedForSelection) {
      return 'Queue scheduling is not available for this destination.';
    }
    if (queueSlotStateForSelection.anyLoading) {
      return 'Checking publishing schedule...';
    }
    if (queueSlotStateForSelection.anyMissing) {
      return 'Add at least one slot in Publishing Schedule for each selected destination.';
    }
    if (queueSlotStateForSelection.anyError || queueSlotStateForSelection.anyUnknown) {
      return 'Could not verify Publishing Schedule right now. Please try again.';
    }
    return null;
  })();

  const queueDisabled = queueOptionDisabled || !validation.ok;
  const queueBlocker = (() => {
    if (queueOptionBlocker) {
      return queueOptionBlocker;
    }
    if (!validation.ok) {
      return validationError || 'Please fix validation errors before continuing.';
    }
    return null;
  })();

  const queueNeedsPublishingSchedule = queueSlotStateForSelection.anyMissing;
  const queueNeedsPublishingScheduleForPost = queueSlotStateForPost.anyMissing;

  const pickSlotDisabled =
    selectedPlatformAccountIds.length !== 1 ||
    !queueSupportedForSelection ||
    queueSlotStateForSelection.anyLoading ||
    !queueSlotStateForSelection.allHaveSlots;
  const pickSlotBlocker = (() => {
    if (!hasSelectedPlatforms) {
      return 'Select at least one destination in Destinations.';
    }
    if (!queueSupportedForSelection) {
      return 'Slot schedules are not available for this destination.';
    }
    if (selectedPlatformAccountIds.length !== 1) {
      return 'Select exactly one destination to pick a slot.';
    }
    if (queueSlotStateForSelection.anyLoading) {
      return 'Checking publishing schedule...';
    }
    if (queueSlotStateForSelection.anyMissing) {
      return 'Add at least one slot in Publishing Schedule for this destination.';
    }
    if (queueSlotStateForSelection.anyError || queueSlotStateForSelection.anyUnknown) {
      return 'Could not verify Publishing Schedule right now. Please try again.';
    }
    return null;
  })();
  const pickSlotNeedsPublishingSchedule =
    selectedPlatformAccountIds.length === 1 && queueSlotStateForSelection.anyMissing;

  const queueBlockerForPost = (() => {
    if (!queuePlatformSupportedForPost) {
      return 'Queue scheduling is not available for this destination.';
    }
    if (queueSlotStateForPost.anyLoading) {
      return 'Checking publishing schedule...';
    }
    if (queueSlotStateForPost.anyMissing) {
      return isMultiDestinationGroup
        ? 'Add at least one slot in Publishing Schedule for each destination in this post group.'
        : 'Add at least one slot in Publishing Schedule for this destination.';
    }
    if (queueSlotStateForPost.anyError || queueSlotStateForPost.anyUnknown) {
      return 'Could not verify Publishing Schedule right now. Please try again.';
    }
    return null;
  })();

  const containerClass = useMemo(
    () =>
      cn(
        'flex flex-col',
        layout === 'sidebar'
          ? 'h-full shadow-lg'
          : 'min-h-[60vh] w-full overflow-hidden rounded-lg border border-border bg-card'
      ),
    [layout]
  );

  const headerClass = useMemo(
    () =>
      cn(
        'bg-card flex items-center justify-between border-b px-4',
        layout === 'sidebar' ? 'sticky top-0 z-30 h-12' : 'h-14 rounded-t'
      ),
    [layout]
  );

  const bodyClass =
    layout === 'sidebar'
      ? 'flex-1 min-h-0 min-w-0 overflow-y-auto px-4 pt-3 pb-32'
      : 'flex-1 min-h-0 min-w-0 overflow-y-auto px-4 pt-3 pb-4';

  const groupBodyClass =
    layout === 'sidebar'
      ? 'flex-1 min-h-0 min-w-0 overflow-y-auto px-4 pb-32'
      : 'flex-1 min-h-0 min-w-0 overflow-y-auto px-4 pb-4';

  const activeDestinationLabel = useMemo(() => {
    if (!id || !isMultiDestinationGroup) {
      return null;
    }
    const dest = groupDestinations.find((d) => d.contentId === id);
    return dest?.label ?? null;
  }, [groupDestinations, id, isMultiDestinationGroup]);

  const allowMixedMedia =
    formData.contentType !== 'reel' && !selectedPlatforms.includes('facebook');

  return {
    validation,
    validationError,
    scheduleBlocker,
    createScheduleDisabled,
    saveDraftDisabled,
    saveDraftBlocker,
    publishNowDisabled,
    publishNowBlocker,
    queueOptionDisabled,
    queueOptionBlocker,
    queueDisabled,
    queueBlocker,
    queueBlockerForPost,
    queueNeedsPublishingSchedule,
    queueNeedsPublishingScheduleForPost,
    pickSlotDisabled,
    pickSlotBlocker,
    pickSlotNeedsPublishingSchedule,
    queueSupportedForSelection,
    queueSupportedForPost,
    isScheduled,
    disabled,
    minScheduleInput,
    containerClass,
    headerClass,
    bodyClass,
    groupBodyClass,
    activeDestinationLabel,
    allowMixedMedia,
    hasSelectedPlatforms,
    effectiveSchedulingSupported,
  };
}
