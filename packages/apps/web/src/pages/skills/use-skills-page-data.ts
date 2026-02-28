import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { skills as skillsApi } from '@/lib/api';
import type { SkillMode, SkillSummary } from '@/lib/api/skills-client';

import {
  extractExamplePrompt,
  normalizeProviderId,
  parseObjectSchema,
  parseSkillMeta,
} from './skills-schema';

export function useSkillsQuery(brandId: string | null) {
  return useQuery({
    queryKey: ['skills', brandId],
    enabled: Boolean(brandId),
    queryFn: async () => {
      const response = await skillsApi.listSkills(brandId!);
      return response.skills;
    },
  });
}

function useFilteredSkills(skills: SkillSummary[], search: string) {
  return useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) {
      return skills;
    }

    return skills.filter((skill) => {
      const haystack = `${skill.name} ${skill.id} ${skill.description}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [search, skills]);
}

export function useDerivedSkillCollections(skills: SkillSummary[], search: string) {
  const filteredSkills = useFilteredSkills(skills, search);
  const installedSkills = filteredSkills.filter((skill) => Boolean(skill.installation));
  const availableSkills = filteredSkills.filter((skill) => !skill.installation);

  return { installedSkills, availableSkills };
}

export function useSupportedModes(activeSkill: SkillSummary | null) {
  return useMemo(() => {
    const supported = activeSkill?.modeSupported || 'managed';
    return supported === 'both' ? (['managed', 'byok'] as const) : ([supported] as const);
  }, [activeSkill?.modeSupported]);
}

export function useActiveSkillMeta(
  activeSkill: SkillSummary | null,
  configValues: Record<string, unknown>
) {
  const activeMeta = useMemo(
    () => parseSkillMeta(activeSkill?.scopesJson),
    [activeSkill?.scopesJson]
  );
  const selectedProvider = useMemo(() => {
    const selectedFromConfig = normalizeProviderId(configValues.provider);
    if (selectedFromConfig && activeMeta.providers.includes(selectedFromConfig)) {
      return selectedFromConfig;
    }
    if (activeMeta.provider) {
      return activeMeta.provider;
    }
    return activeMeta.providers[0] ?? null;
  }, [activeMeta.provider, activeMeta.providers, configValues.provider]);

  const selectedProviderMeta = useMemo(
    () => (selectedProvider ? activeMeta.providerDetails[selectedProvider] : undefined),
    [activeMeta.providerDetails, selectedProvider]
  );
  const activeConfigSchema = useMemo(
    () => parseObjectSchema(selectedProviderMeta?.configSchema ?? activeSkill?.configSchemaJson),
    [selectedProviderMeta?.configSchema, activeSkill?.configSchemaJson]
  );
  const activeSecretSchema = useMemo(
    () => parseObjectSchema(selectedProviderMeta?.secretSchema ?? activeMeta.secretSchema),
    [selectedProviderMeta?.secretSchema, activeMeta.secretSchema]
  );

  const activeDocs = selectedProviderMeta?.docs ?? activeMeta.docs;
  const activeDocsUrl = selectedProviderMeta?.docsUrl ?? activeMeta.docsUrl;
  const activeExamples =
    selectedProviderMeta?.examples && selectedProviderMeta.examples.length > 0
      ? selectedProviderMeta.examples
      : activeMeta.examples;
  const activeTrySampleInput =
    selectedProviderMeta?.trySampleInput !== undefined
      ? selectedProviderMeta.trySampleInput
      : activeMeta.trySampleInput;

  const examplePrompt = useMemo(() => {
    const fromTrySample = extractExamplePrompt(activeTrySampleInput);
    if (fromTrySample) {
      return fromTrySample;
    }

    const fromExamples = activeExamples
      .map((example) => extractExamplePrompt(example.input))
      .find((value): value is string => Boolean(value));
    return fromExamples || null;
  }, [activeExamples, activeTrySampleInput]);

  return {
    activeConfigSchema,
    activeSecretSchema,
    activeDocs,
    activeDocsUrl,
    examplePrompt,
  };
}

export function useCopyExamplePrompt(examplePrompt: string | null) {
  return useCallback(async () => {
    if (!examplePrompt) {
      return;
    }

    try {
      await navigator.clipboard.writeText(examplePrompt);
      toast.success('Example prompt copied');
    } catch {
      toast.error('Failed to copy example prompt');
    }
  }, [examplePrompt]);
}

export function useToggleMutation(queryClient: QueryClient, brandId: string | null) {
  return useMutation({
    mutationFn: async (params: { installationId: string; enabled: boolean }) =>
      await skillsApi.toggle(params.installationId, params.enabled),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['skills', brandId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update skill');
    },
  });
}

export function useInstallMutation({
  brandId,
  queryClient,
  onSuccess,
}: {
  brandId: string | null;
  queryClient: QueryClient;
  onSuccess: () => void;
}) {
  return useMutation({
    mutationFn: async (params: {
      skillId: string;
      mode: SkillMode;
      config: Record<string, unknown>;
      apiKey?: string;
    }) => {
      if (!brandId) {
        throw new Error('Brand required');
      }
      return await skillsApi.install(params.skillId, {
        brandId,
        mode: params.mode,
        config: params.config,
        secret: params.mode === 'byok' ? { apiKey: params.apiKey || '' } : undefined,
      });
    },
    onSuccess: async () => {
      toast.success('Skill saved');
      onSuccess();
      await queryClient.invalidateQueries({ queryKey: ['skills', brandId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save skill');
    },
  });
}

export function useUninstallMutation({
  brandId,
  queryClient,
  onSuccess,
}: {
  brandId: string | null;
  queryClient: QueryClient;
  onSuccess: () => void;
}) {
  return useMutation({
    mutationFn: async (skill: SkillSummary) => {
      if (!brandId) {
        throw new Error('Brand required');
      }
      if (skill.installation?.id) {
        return await skillsApi.uninstallInstallation(skill.installation.id);
      }
      return await skillsApi.uninstall(skill.id, brandId);
    },
    onSuccess: async () => {
      toast.success('Skill uninstalled');
      onSuccess();
      await queryClient.invalidateQueries({ queryKey: ['skills', brandId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to uninstall skill');
    },
  });
}
