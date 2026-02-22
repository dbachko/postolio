import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';
import { getPlatformConfig, type Platform } from '@/lib/platform-config';

import type { PostEditorLayout } from '../types';

export function usePostEditorDestinations(params: {
  id?: string;
  layout: PostEditorLayout;
  multiDestinationEnabled: boolean;
  isMultiDestinationGroup: boolean;
  platformPickerOptions: SocialAccountsPickerOption[];
  socialAccountsData: unknown;
}) {
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

  const [selectedPlatformAccountIds, setSelectedPlatformAccountIds] = useState<string[]>([]);
  const platformsInitializedRef = useRef(false);

  const [createDestinationsPopoverOpen, setCreateDestinationsPopoverOpen] = useState(false);
  const [createDestinationsHelpOpen, setCreateDestinationsHelpOpen] = useState(false);
  const [editDestinationsPopoverOpen, setEditDestinationsPopoverOpen] = useState(false);
  const [editDestinationsHelpOpen, setEditDestinationsHelpOpen] = useState(false);
  const [showDestinationsRequiredError, setShowDestinationsRequiredError] = useState(false);

  const handlePlatformAccountsChange = useCallback(
    (next: string[]) => {
      if (!platformPickerOptions.length) {
        setSelectedPlatformAccountIds([]);
        return;
      }

      const byId = new Set(platformPickerOptions.map((opt) => opt.id));
      const deduped = Array.from(new Set(next)).filter((nextId) => byId.has(nextId));
      const normalized =
        !multiDestinationEnabled && deduped.length > 1 ? [deduped[deduped.length - 1]!] : deduped;
      setSelectedPlatformAccountIds(normalized);
    },
    [multiDestinationEnabled, platformPickerOptions]
  );

  const createSelectedDestinations = useMemo(() => {
    if (!isCreateWithRail) {
      return [] as SocialAccountsPickerOption[];
    }
    if (!platformPickerOptions.length || !selectedPlatformAccountIds.length) {
      return [];
    }
    const byId = new Map(platformPickerOptions.map((opt) => [opt.id, opt]));
    const out: SocialAccountsPickerOption[] = [];
    for (const selectedId of selectedPlatformAccountIds) {
      const opt = byId.get(selectedId);
      if (opt) {
        out.push(opt);
      }
    }
    return out;
  }, [isCreateWithRail, platformPickerOptions, selectedPlatformAccountIds]);

  const toggleCreateDestination = useCallback(
    (accountId: string) => {
      if (!accountId) {
        return;
      }

      let next: string[];

      if (!multiDestinationEnabled) {
        // Single-destination mode behaves like radio buttons: clicking the
        // currently selected destination should be a no-op instead of
        // clearing the selection entirely.
        if (selectedPlatformAccountIds.includes(accountId)) {
          return;
        }
        next = [accountId];
      } else {
        next = selectedPlatformAccountIds.includes(accountId)
          ? selectedPlatformAccountIds.filter((selectedId) => selectedId !== accountId)
          : [...selectedPlatformAccountIds, accountId];
      }
      handlePlatformAccountsChange(next);
    },
    [handlePlatformAccountsChange, multiDestinationEnabled, selectedPlatformAccountIds]
  );

  const selectedTargetSocialAccountId = useMemo(() => {
    const first = selectedPlatformAccountIds[0];
    if (!first) {
      return null;
    }
    return first;
  }, [selectedPlatformAccountIds]);

  const selectedPlatforms = useMemo(() => {
    if (!platformPickerOptions.length || !selectedPlatformAccountIds.length) {
      return [];
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

  const schedulingSupported = useMemo(() => {
    if (selectedPlatforms.length === 0) {
      return false;
    }
    return selectedPlatforms.every((p) => getPlatformConfig(p).features.scheduling);
  }, [selectedPlatforms]);

  const publishingSupported = useMemo(() => {
    if (selectedPlatforms.length === 0) {
      return false;
    }
    return selectedPlatforms.every((p) => getPlatformConfig(p).features.publishing);
  }, [selectedPlatforms]);

  const hasSelectedPlatforms = selectedPlatformAccountIds.length > 0;

  const destinationsErrorDelayEnabled =
    (isCreateWithRail || (layout === 'sidebar' && Boolean(id) && !isMultiDestinationGroup)) &&
    platformsInitializedRef.current;

  useEffect(() => {
    if (!destinationsErrorDelayEnabled) {
      setShowDestinationsRequiredError(false);
      return;
    }

    if (selectedPlatformAccountIds.length > 0) {
      setShowDestinationsRequiredError(false);
      return;
    }

    const timer = window.setTimeout(() => setShowDestinationsRequiredError(true), 500);
    return () => window.clearTimeout(timer);
  }, [destinationsErrorDelayEnabled, selectedPlatformAccountIds.length]);

  useEffect(() => {
    if (!isCreating) {
      return;
    }
    if (platformsInitializedRef.current) {
      return;
    }
    if (!socialAccountsData) {
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
    const next: string[] = [];
    if (fallbackId) {
      next.push(fallbackId);
    }

    setSelectedPlatformAccountIds(next);
    platformsInitializedRef.current = true;
  }, [isCreating, multiDestinationEnabled, platformPickerOptions, socialAccountsData]);

  return {
    createDestinationsPopoverOpen,
    setCreateDestinationsPopoverOpen,
    createDestinationsHelpOpen,
    setCreateDestinationsHelpOpen,
    editDestinationsPopoverOpen,
    setEditDestinationsPopoverOpen,
    editDestinationsHelpOpen,
    setEditDestinationsHelpOpen,
    showDestinationsRequiredError,
    setShowDestinationsRequiredError,
    selectedPlatformAccountIds,
    setSelectedPlatformAccountIds,
    platformsInitializedRef,
    handlePlatformAccountsChange,
    createSelectedDestinations,
    toggleCreateDestination,
    selectedTargetSocialAccountId,
    selectedPlatforms,
    schedulingSupported,
    publishingSupported,
    hasSelectedPlatforms,
    multiDestinationEnabled,
  };
}
