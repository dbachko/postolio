import {
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { useQuery } from '@tanstack/react-query';

import { assetsApi } from '@/features/assets/api/client';
import type { PostEditorFormState } from '@/components/post-editor/post-editor-main-body/types';
import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';

import { createEmptyPostFormState, formatScheduledInput } from '../utils';
import {
  applyAssetsPrefill,
  applyBasicPrefill,
  applyPlatformsPrefill,
  hasPrefillInput,
} from './use-post-editor-form-state-prefill-helpers';
import {
  parsePrefillAssetIds,
  parsePrefillContentType,
  parseTargetSocialAccountIds,
} from './use-post-editor-form-state-helpers';

function usePrefillAssetIds(locationSearch: string) {
  const searchParams = useMemo(() => new URLSearchParams(locationSearch), [locationSearch]);

  const qCaption = searchParams.get('caption');
  const qScheduledAt = searchParams.get('scheduledAt');
  const qContentType = searchParams.get('contentType');
  const qTargetSocialAccountId = searchParams.get('targetSocialAccountId');
  const qTargetSocialAccountIds = searchParams.get('targetSocialAccountIds');
  const qAssetId = searchParams.get('assetId');
  const qAssetIdsParam = searchParams.get('assetIds');

  const prefillAssetIds = useMemo(
    () => parsePrefillAssetIds(qAssetId, qAssetIdsParam),
    [qAssetId, qAssetIdsParam]
  );

  return {
    qCaption,
    qScheduledAt,
    qContentType,
    qTargetSocialAccountId,
    qTargetSocialAccountIds,
    prefillAssetIds,
  };
}

function usePrefillAssetsQuery(isCreating: boolean, prefillAssetIds: string[]) {
  return useQuery({
    queryKey: ['prefill-assets', prefillAssetIds.join(',')],
    enabled: isCreating && prefillAssetIds.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        prefillAssetIds.map(async (assetId) => {
          try {
            const { asset } = await assetsApi.getAsset(assetId);
            return asset;
          } catch {
            return null;
          }
        })
      );
      return results.filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
    },
    retry: 0,
  });
}

function useResetOnCreateTransition(params: {
  isCreating: boolean;
  setFormData: Dispatch<SetStateAction<PostEditorFormState>>;
  setHasChanges: Dispatch<SetStateAction<boolean>>;
  setFirstCommentOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedPlatformAccountIds: (ids: string[]) => void;
  platformsInitializedRef: MutableRefObject<boolean>;
  formInitializedRef: MutableRefObject<boolean>;
  scheduledAtTouchedRef: MutableRefObject<boolean>;
  prefillAppliedRef: MutableRefObject<{ basic: boolean; assets: boolean; platforms: boolean }>;
  wasCreatingRef: MutableRefObject<boolean>;
}) {
  const {
    isCreating,
    setFormData,
    setHasChanges,
    setFirstCommentOpen,
    setSelectedPlatformAccountIds,
    platformsInitializedRef,
    formInitializedRef,
    scheduledAtTouchedRef,
    prefillAppliedRef,
    wasCreatingRef,
  } = params;

  useEffect(() => {
    const wasCreating = wasCreatingRef.current;
    wasCreatingRef.current = isCreating;

    if (!isCreating || wasCreating) {
      return;
    }

    setFormData(createEmptyPostFormState());
    setHasChanges(false);
    setFirstCommentOpen(false);
    setSelectedPlatformAccountIds([]);
    platformsInitializedRef.current = false;
    formInitializedRef.current = false;
    prefillAppliedRef.current = { basic: false, assets: false, platforms: false };
    scheduledAtTouchedRef.current = false;
  }, [
    formInitializedRef,
    isCreating,
    platformsInitializedRef,
    prefillAppliedRef,
    scheduledAtTouchedRef,
    setFirstCommentOpen,
    setFormData,
    setHasChanges,
    setSelectedPlatformAccountIds,
    wasCreatingRef,
  ]);
}

type ApplyBasicAndAssetsPrefillParams = {
  isCreating: boolean;
  qCaption: string | null;
  qScheduledAt: string | null;
  qContentType: string | null;
  qTargetSocialAccountId: string | null;
  qTargetSocialAccountIds: string | null;
  brandTimezone: string;
  prefillAssetIds: string[];
  prefillAssets: any[] | undefined;
  isPrefillAssetsLoading: boolean;
  setFormData: Dispatch<SetStateAction<PostEditorFormState>>;
  prefillAppliedRef: MutableRefObject<{ basic: boolean; assets: boolean; platforms: boolean }>;
};

function useApplyBasicAndAssetsPrefill(params: ApplyBasicAndAssetsPrefillParams) {
  const {
    isCreating,
    qCaption,
    qScheduledAt,
    qContentType,
    qTargetSocialAccountId,
    qTargetSocialAccountIds,
    brandTimezone,
    prefillAssetIds,
    prefillAssets,
    isPrefillAssetsLoading,
    setFormData,
    prefillAppliedRef,
  } = params;

  useEffect(() => {
    if (!isCreating) {
      return;
    }

    const normalizedTargetSocialAccountIds = parseTargetSocialAccountIds(
      qTargetSocialAccountIds,
      qTargetSocialAccountId
    );
    const normalizedContentType = parsePrefillContentType(qContentType);

    if (
      !hasPrefillInput({
        qCaption,
        qScheduledAt,
        normalizedTargetSocialAccountIds,
        normalizedContentType,
        prefillAssetIds,
      })
    ) {
      return;
    }

    const shouldApplyBasic =
      (Boolean(qCaption) || Boolean(qScheduledAt) || Boolean(normalizedContentType)) &&
      prefillAppliedRef.current.basic === false;
    const shouldApplyAssets =
      prefillAssetIds.length > 0 && prefillAppliedRef.current.assets === false;
    applyBasicPrefill({
      shouldApplyBasic,
      qCaption,
      qScheduledAt,
      normalizedContentType,
      brandTimezone,
      setFormData,
      prefillAppliedRef,
    });

    const assetsApplied = applyAssetsPrefill({
      shouldApplyAssets,
      isPrefillAssetsLoading,
      prefillAssets,
      setFormData,
      prefillAppliedRef,
    });
    if (!assetsApplied) {
      return;
    }
  }, [
    brandTimezone,
    isCreating,
    isPrefillAssetsLoading,
    prefillAppliedRef,
    prefillAssetIds,
    prefillAssets,
    qCaption,
    qContentType,
    qScheduledAt,
    qTargetSocialAccountId,
    qTargetSocialAccountIds,
    setFormData,
  ]);
}

function useApplyPlatformPrefill(params: {
  isCreating: boolean;
  qTargetSocialAccountId: string | null;
  qTargetSocialAccountIds: string | null;
  prefillAssetIds: string[];
  isPrefillAssetsLoading: boolean;
  platformPickerOptions: SocialAccountsPickerOption[];
  multiDestinationEnabled: boolean;
  setSelectedPlatformAccountIds: (ids: string[]) => void;
  platformsInitializedRef: MutableRefObject<boolean>;
  prefillAppliedRef: MutableRefObject<{ basic: boolean; assets: boolean; platforms: boolean }>;
}) {
  const {
    isCreating,
    qTargetSocialAccountId,
    qTargetSocialAccountIds,
    prefillAssetIds,
    isPrefillAssetsLoading,
    platformPickerOptions,
    multiDestinationEnabled,
    setSelectedPlatformAccountIds,
    platformsInitializedRef,
    prefillAppliedRef,
  } = params;

  useEffect(() => {
    if (!isCreating) {
      return;
    }

    if (prefillAssetIds.length > 0 && prefillAppliedRef.current.assets === false) {
      if (isPrefillAssetsLoading) {
        return;
      }
    }

    const normalizedTargetSocialAccountIds = parseTargetSocialAccountIds(
      qTargetSocialAccountIds,
      qTargetSocialAccountId
    );
    const shouldApplyPlatforms =
      Boolean(normalizedTargetSocialAccountIds?.length) &&
      prefillAppliedRef.current.platforms === false;

    applyPlatformsPrefill({
      shouldApplyPlatforms,
      normalizedTargetSocialAccountIds,
      platformPickerOptions,
      multiDestinationEnabled,
      setSelectedPlatformAccountIds,
      platformsInitializedRef,
      prefillAppliedRef,
    });
  }, [
    isCreating,
    isPrefillAssetsLoading,
    multiDestinationEnabled,
    platformPickerOptions,
    prefillAppliedRef,
    prefillAssetIds,
    platformsInitializedRef,
    qTargetSocialAccountId,
    qTargetSocialAccountIds,
    setSelectedPlatformAccountIds,
  ]);
}

function useApplyPrefillValues(params: {
  isCreating: boolean;
  qCaption: string | null;
  qScheduledAt: string | null;
  qContentType: string | null;
  qTargetSocialAccountId: string | null;
  qTargetSocialAccountIds: string | null;
  brandTimezone: string;
  prefillAssetIds: string[];
  prefillAssets: any[] | undefined;
  isPrefillAssetsLoading: boolean;
  platformPickerOptions: SocialAccountsPickerOption[];
  multiDestinationEnabled: boolean;
  setFormData: Dispatch<SetStateAction<PostEditorFormState>>;
  setSelectedPlatformAccountIds: (ids: string[]) => void;
  platformsInitializedRef: MutableRefObject<boolean>;
  prefillAppliedRef: MutableRefObject<{ basic: boolean; assets: boolean; platforms: boolean }>;
}) {
  useApplyBasicAndAssetsPrefill(params);
  useApplyPlatformPrefill(params);
}

function useApplyScheduledAtPrefill(params: {
  isCreating: boolean;
  qScheduledAt: string | null;
  brandTimezone: string;
  scheduledAtTouchedRef: MutableRefObject<boolean>;
  setFormData: Dispatch<SetStateAction<PostEditorFormState>>;
}) {
  const { isCreating, qScheduledAt, brandTimezone, scheduledAtTouchedRef, setFormData } = params;

  useEffect(() => {
    if (!isCreating || scheduledAtTouchedRef.current) {
      return;
    }

    const raw = typeof qScheduledAt === 'string' ? qScheduledAt.trim() : '';
    if (!raw) {
      return;
    }

    const next = formatScheduledInput(raw, brandTimezone);
    setFormData((prev) => (prev.scheduledAt === next ? prev : { ...prev, scheduledAt: next }));
  }, [brandTimezone, isCreating, qScheduledAt, scheduledAtTouchedRef, setFormData]);
}

export function usePostEditorFormPrefill(params: {
  id?: string;
  locationSearch: string;
  brandTimezone: string;
  multiDestinationEnabled: boolean;
  platformPickerOptions: SocialAccountsPickerOption[];
  setFormData: Dispatch<SetStateAction<PostEditorFormState>>;
  setHasChanges: Dispatch<SetStateAction<boolean>>;
  setFirstCommentOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedPlatformAccountIds: (ids: string[]) => void;
  platformsInitializedRef: MutableRefObject<boolean>;
  formInitializedRef: MutableRefObject<boolean>;
  scheduledAtTouchedRef: MutableRefObject<boolean>;
}) {
  const isCreating = !params.id;
  const prefillValues = usePrefillAssetIds(params.locationSearch);
  const prefillAssetsQuery = usePrefillAssetsQuery(isCreating, prefillValues.prefillAssetIds);

  const prefillAppliedRef = useRef<{ basic: boolean; assets: boolean; platforms: boolean }>({
    basic: false,
    assets: false,
    platforms: false,
  });
  const wasCreatingRef = useRef<boolean>(isCreating);

  useResetOnCreateTransition({
    isCreating,
    setFormData: params.setFormData,
    setHasChanges: params.setHasChanges,
    setFirstCommentOpen: params.setFirstCommentOpen,
    setSelectedPlatformAccountIds: params.setSelectedPlatformAccountIds,
    platformsInitializedRef: params.platformsInitializedRef,
    formInitializedRef: params.formInitializedRef,
    scheduledAtTouchedRef: params.scheduledAtTouchedRef,
    prefillAppliedRef,
    wasCreatingRef,
  });

  useApplyPrefillValues({
    isCreating,
    qCaption: prefillValues.qCaption,
    qScheduledAt: prefillValues.qScheduledAt,
    qContentType: prefillValues.qContentType,
    qTargetSocialAccountId: prefillValues.qTargetSocialAccountId,
    qTargetSocialAccountIds: prefillValues.qTargetSocialAccountIds,
    brandTimezone: params.brandTimezone,
    prefillAssetIds: prefillValues.prefillAssetIds,
    prefillAssets: prefillAssetsQuery.data,
    isPrefillAssetsLoading: prefillAssetsQuery.isLoading,
    platformPickerOptions: params.platformPickerOptions,
    multiDestinationEnabled: params.multiDestinationEnabled,
    setFormData: params.setFormData,
    setSelectedPlatformAccountIds: params.setSelectedPlatformAccountIds,
    platformsInitializedRef: params.platformsInitializedRef,
    prefillAppliedRef,
  });

  useApplyScheduledAtPrefill({
    isCreating,
    qScheduledAt: prefillValues.qScheduledAt,
    brandTimezone: params.brandTimezone,
    scheduledAtTouchedRef: params.scheduledAtTouchedRef,
    setFormData: params.setFormData,
  });
}
