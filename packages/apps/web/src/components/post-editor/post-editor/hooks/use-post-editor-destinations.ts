import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';
import { getPlatformConfig, type Platform } from '@/lib/platform-config';

import type { PostEditorLayout } from '../types';

type UsePostEditorDestinationsParams = {
  id?: string;
  layout: PostEditorLayout;
  multiDestinationEnabled: boolean;
  isMultiDestinationGroup: boolean;
  platformPickerOptions: SocialAccountsPickerOption[];
  socialAccountsData: unknown;
};

function useDestinationPopoverState() {
  const [createDestinationsPopoverOpen, setCreateDestinationsPopoverOpen] = useState(false);
  const [createDestinationsHelpOpen, setCreateDestinationsHelpOpen] = useState(false);
  const [editDestinationsPopoverOpen, setEditDestinationsPopoverOpen] = useState(false);
  const [editDestinationsHelpOpen, setEditDestinationsHelpOpen] = useState(false);

  return {
    createDestinationsPopoverOpen,
    setCreateDestinationsPopoverOpen,
    createDestinationsHelpOpen,
    setCreateDestinationsHelpOpen,
    editDestinationsPopoverOpen,
    setEditDestinationsPopoverOpen,
    editDestinationsHelpOpen,
    setEditDestinationsHelpOpen,
  };
}

function normalizeSelectedIds(
  next: string[],
  byId: Set<string>,
  multiDestinationEnabled: boolean
): string[] {
  const deduped = Array.from(new Set(next)).filter((nextId) => byId.has(nextId));
  if (!multiDestinationEnabled && deduped.length > 1) {
    return [deduped[deduped.length - 1]!];
  }
  return deduped;
}

function useDestinationSelection(
  platformPickerOptions: SocialAccountsPickerOption[],
  multiDestinationEnabled: boolean
) {
  const [selectedPlatformAccountIds, setSelectedPlatformAccountIds] = useState<string[]>([]);

  const handlePlatformAccountsChange = useCallback(
    (next: string[]) => {
      if (!platformPickerOptions.length) {
        setSelectedPlatformAccountIds([]);
        return;
      }
      const byId = new Set(platformPickerOptions.map((opt) => opt.id));
      setSelectedPlatformAccountIds(normalizeSelectedIds(next, byId, multiDestinationEnabled));
    },
    [multiDestinationEnabled, platformPickerOptions]
  );

  const toggleCreateDestination = useCallback(
    (accountId: string) => {
      if (!accountId) {
        return;
      }
      if (!multiDestinationEnabled) {
        if (selectedPlatformAccountIds.includes(accountId)) {
          return;
        }
        handlePlatformAccountsChange([accountId]);
        return;
      }
      const next = selectedPlatformAccountIds.includes(accountId)
        ? selectedPlatformAccountIds.filter((selectedId) => selectedId !== accountId)
        : [...selectedPlatformAccountIds, accountId];
      handlePlatformAccountsChange(next);
    },
    [handlePlatformAccountsChange, multiDestinationEnabled, selectedPlatformAccountIds]
  );

  return {
    selectedPlatformAccountIds,
    setSelectedPlatformAccountIds,
    handlePlatformAccountsChange,
    toggleCreateDestination,
  };
}

function useSelectedPlatforms(
  platformPickerOptions: SocialAccountsPickerOption[],
  selectedPlatformAccountIds: string[]
) {
  return useMemo(() => {
    if (!platformPickerOptions.length || !selectedPlatformAccountIds.length) {
      return [] as Platform[];
    }
    const byId = new Map(platformPickerOptions.map((opt) => [opt.id, opt.platform]));
    const out = new Set<Platform>();
    for (const selectedId of selectedPlatformAccountIds) {
      const platform = byId.get(selectedId);
      if (platform) {
        out.add(platform);
      }
    }
    return Array.from(out);
  }, [platformPickerOptions, selectedPlatformAccountIds]);
}

function useCreateDestinations(
  isCreateWithRail: boolean,
  platformPickerOptions: SocialAccountsPickerOption[],
  selectedPlatformAccountIds: string[]
) {
  return useMemo(() => {
    if (!isCreateWithRail || !platformPickerOptions.length || !selectedPlatformAccountIds.length) {
      return [] as SocialAccountsPickerOption[];
    }
    const byId = new Map(platformPickerOptions.map((opt) => [opt.id, opt]));
    return selectedPlatformAccountIds
      .map((selectedId) => byId.get(selectedId))
      .filter(Boolean) as SocialAccountsPickerOption[];
  }, [isCreateWithRail, platformPickerOptions, selectedPlatformAccountIds]);
}

function useDestinationsRequiredError(
  enabled: boolean,
  selectedCount: number,
  setShowDestinationsRequiredError: (value: boolean) => void
) {
  useEffect(() => {
    if (!enabled || selectedCount > 0) {
      setShowDestinationsRequiredError(false);
      return;
    }
    const timer = window.setTimeout(() => setShowDestinationsRequiredError(true), 500);
    return () => window.clearTimeout(timer);
  }, [enabled, selectedCount, setShowDestinationsRequiredError]);
}

function initializeDefaultCreateDestination(params: {
  isCreating: boolean;
  platformPickerOptions: SocialAccountsPickerOption[];
  socialAccountsData: unknown;
  multiDestinationEnabled: boolean;
  platformsInitializedRef: React.MutableRefObject<boolean>;
  setSelectedPlatformAccountIds: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  const {
    isCreating,
    multiDestinationEnabled,
    platformPickerOptions,
    platformsInitializedRef,
    setSelectedPlatformAccountIds,
    socialAccountsData,
  } = params;

  if (!isCreating || platformsInitializedRef.current || !socialAccountsData) {
    return;
  }

  const rawDefaults = (socialAccountsData as any)?.defaultPostSocialAccountIds;
  if (Array.isArray(rawDefaults)) {
    const byId = new Set(platformPickerOptions.map((o) => o.id));
    const filtered = rawDefaults
      .filter((value: unknown) => typeof value === 'string')
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value) && byId.has(value));

    if (filtered.length > 0) {
      const normalized = Array.from(new Set(filtered));
      setSelectedPlatformAccountIds(
        !multiDestinationEnabled && normalized.length > 1 ? [normalized[0]!] : normalized
      );
      platformsInitializedRef.current = true;
      return;
    }
  }

  const fallbackId = platformPickerOptions[0]?.id || null;
  setSelectedPlatformAccountIds(fallbackId ? [fallbackId] : []);
  platformsInitializedRef.current = true;
}

export function usePostEditorDestinations(params: UsePostEditorDestinationsParams) {
  const {
    id,
    isMultiDestinationGroup,
    layout,
    multiDestinationEnabled,
    platformPickerOptions,
    socialAccountsData,
  } = params;

  const isCreating = !id;
  const isCreateWithRail = isCreating;
  const platformsInitializedRef = useRef(false);
  const [showDestinationsRequiredError, setShowDestinationsRequiredError] = useState(false);

  const popovers = useDestinationPopoverState();
  const selection = useDestinationSelection(platformPickerOptions, multiDestinationEnabled);
  const selectedPlatforms = useSelectedPlatforms(
    platformPickerOptions,
    selection.selectedPlatformAccountIds
  );
  const createSelectedDestinations = useCreateDestinations(
    isCreateWithRail,
    platformPickerOptions,
    selection.selectedPlatformAccountIds
  );

  const selectedTargetSocialAccountId = selection.selectedPlatformAccountIds[0] || null;
  const hasSelectedPlatforms = selection.selectedPlatformAccountIds.length > 0;
  const schedulingSupported =
    selectedPlatforms.length > 0 &&
    selectedPlatforms.every((platform) => getPlatformConfig(platform).features.scheduling);
  const publishingSupported =
    selectedPlatforms.length > 0 &&
    selectedPlatforms.every((platform) => getPlatformConfig(platform).features.publishing);

  const destinationsErrorDelayEnabled =
    (isCreateWithRail || (layout === 'sidebar' && Boolean(id) && !isMultiDestinationGroup)) &&
    platformsInitializedRef.current;

  useDestinationsRequiredError(
    destinationsErrorDelayEnabled,
    selection.selectedPlatformAccountIds.length,
    setShowDestinationsRequiredError
  );

  useEffect(() => {
    initializeDefaultCreateDestination({
      isCreating,
      platformPickerOptions,
      socialAccountsData,
      multiDestinationEnabled,
      platformsInitializedRef,
      setSelectedPlatformAccountIds: selection.setSelectedPlatformAccountIds,
    });
  }, [
    isCreating,
    multiDestinationEnabled,
    platformPickerOptions,
    selection.setSelectedPlatformAccountIds,
    socialAccountsData,
  ]);

  return {
    ...popovers,
    showDestinationsRequiredError,
    setShowDestinationsRequiredError,
    selectedPlatformAccountIds: selection.selectedPlatformAccountIds,
    setSelectedPlatformAccountIds: selection.setSelectedPlatformAccountIds,
    platformsInitializedRef,
    handlePlatformAccountsChange: selection.handlePlatformAccountsChange,
    createSelectedDestinations,
    toggleCreateDestination: selection.toggleCreateDestination,
    selectedTargetSocialAccountId,
    selectedPlatforms,
    schedulingSupported,
    publishingSupported,
    hasSelectedPlatforms,
    multiDestinationEnabled,
  };
}
