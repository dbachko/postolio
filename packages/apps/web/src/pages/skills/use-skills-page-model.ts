import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { skills as skillsApi } from '@/lib/api';
import type { SkillMode, SkillSummary } from '@/lib/api/skills-client';
import { useBrandStore } from '@/stores/brandStore';

import {
  buildConfigPayload,
  getInitialValuesForSchema,
  validateRequiredFields,
} from './skills-form-utils';
import { parseObjectSchema } from './skills-schema';
import {
  useActiveSkillMeta,
  useCopyExamplePrompt,
  useDerivedSkillCollections,
  useInstallMutation,
  useSkillsQuery,
  useSupportedModes,
  useToggleMutation,
  useUninstallMutation,
} from './use-skills-page-data';

type SkillsDialogState = {
  configOpen: boolean;
  activeSkill: SkillSummary | null;
  mode: SkillMode;
  configValues: Record<string, unknown>;
  secretValues: Record<string, string>;
  loadingSkillDetail: boolean;
};

function useDialogState() {
  const [state, setState] = useState<SkillsDialogState>({
    configOpen: false,
    activeSkill: null,
    mode: 'managed',
    configValues: {},
    secretValues: {},
    loadingSkillDetail: false,
  });

  const setConfigOpen = useCallback((configOpen: boolean) => {
    setState((prev) => ({ ...prev, configOpen }));
  }, []);

  return { state, setState, setConfigOpen };
}

function useModeGuard(
  activeSkill: SkillSummary | null,
  mode: SkillMode,
  supportedModes: readonly SkillMode[],
  setState: Dispatch<SetStateAction<SkillsDialogState>>
) {
  useEffect(() => {
    if (!activeSkill) {
      return;
    }
    if (supportedModes.includes(mode)) {
      return;
    }
    setState((prev) => ({ ...prev, mode: supportedModes[0] as SkillMode }));
  }, [activeSkill, mode, setState, supportedModes]);
}

function useAutoOpenRequestedSkill({
  requestedSkillId,
  skills,
  openConfigure,
  searchParams,
  setSearchParams,
}: {
  requestedSkillId: string | null;
  skills?: SkillSummary[];
  openConfigure: (skill: SkillSummary) => Promise<void>;
  searchParams: URLSearchParams;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
}) {
  const didAutoOpenRef = useRef(false);

  useEffect(() => {
    if (!requestedSkillId || didAutoOpenRef.current || !skills) {
      return;
    }

    const skill = skills.find((item) => item.id === requestedSkillId) ?? null;
    didAutoOpenRef.current = true;
    if (!skill) {
      toast.error(`Skill not found: ${requestedSkillId}`);
      return;
    }

    void openConfigure(skill);
    const next = new URLSearchParams(searchParams);
    next.delete('skill');
    setSearchParams(next, { replace: true });
  }, [requestedSkillId, skills, openConfigure, searchParams, setSearchParams]);
}

function useCloseDialog(setState: Dispatch<SetStateAction<SkillsDialogState>>) {
  return useCallback(() => {
    setState((prev) => ({ ...prev, configOpen: false, activeSkill: null, secretValues: {} }));
  }, [setState]);
}

function useInitializeSkillForm(setState: Dispatch<SetStateAction<SkillsDialogState>>) {
  return useCallback(
    (skill: SkillSummary) => {
      const fallbackMode: SkillMode = skill.modeSupported === 'byok' ? 'byok' : 'managed';
      const mode = skill.installation?.mode ?? fallbackMode;
      const configSchema = parseObjectSchema(skill.configSchemaJson);
      const configValues = getInitialValuesForSchema(configSchema, skill.installation?.configJson);

      setState((prev) => ({ ...prev, mode, configValues, secretValues: {} }));
    },
    [setState]
  );
}

function useOpenConfigure({
  brandId,
  setState,
  initializeSkillForm,
}: {
  brandId: string | null;
  setState: Dispatch<SetStateAction<SkillsDialogState>>;
  initializeSkillForm: (skill: SkillSummary) => void;
}) {
  return useCallback(
    async (skill: SkillSummary) => {
      setState((prev) => ({ ...prev, activeSkill: skill, configOpen: true }));
      initializeSkillForm(skill);
      if (!brandId) {
        return;
      }

      try {
        setState((prev) => ({ ...prev, loadingSkillDetail: true }));
        const response = await skillsApi.getSkill(skill.id, brandId);
        setState((prev) => ({ ...prev, activeSkill: response.skill }));
        initializeSkillForm(response.skill);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to load skill details');
      } finally {
        setState((prev) => ({ ...prev, loadingSkillDetail: false }));
      }
    },
    [brandId, initializeSkillForm, setState]
  );
}

function useDialogFieldSetters(setState: Dispatch<SetStateAction<SkillsDialogState>>) {
  const setMode = useCallback(
    (mode: SkillMode) => setState((prev) => ({ ...prev, mode })),
    [setState]
  );
  const setConfigValue = useCallback(
    (key: string, value: unknown) =>
      setState((prev) => ({ ...prev, configValues: { ...prev.configValues, [key]: value } })),
    [setState]
  );
  const setSecretValue = useCallback(
    (key: string, value: string) =>
      setState((prev) => ({ ...prev, secretValues: { ...prev.secretValues, [key]: value } })),
    [setState]
  );

  return { setMode, setConfigValue, setSecretValue };
}

function useDialogOpenChange({
  closeDialog,
  setConfigOpen,
}: {
  closeDialog: () => void;
  setConfigOpen: (open: boolean) => void;
}) {
  return useCallback(
    (open: boolean) => {
      if (!open) {
        closeDialog();
        return;
      }
      setConfigOpen(true);
    },
    [closeDialog, setConfigOpen]
  );
}

function useSubmitActiveSkill({
  state,
  activeConfigSchema,
  activeSecretSchema,
  installMutation,
}: {
  state: SkillsDialogState;
  activeConfigSchema: ReturnType<typeof useActiveSkillMeta>['activeConfigSchema'];
  activeSecretSchema: ReturnType<typeof useActiveSkillMeta>['activeSecretSchema'];
  installMutation: ReturnType<typeof useInstallMutation>;
}) {
  return useCallback(() => {
    if (!state.activeSkill) {
      return;
    }

    const configMissing = validateRequiredFields(activeConfigSchema, state.configValues);
    if (configMissing.length > 0) {
      toast.error(`Missing required config: ${configMissing.join(', ')}`);
      return;
    }

    if (state.mode === 'byok') {
      const secretMissing = validateRequiredFields(activeSecretSchema, state.secretValues);
      if (secretMissing.length > 0) {
        toast.error(`Missing required secret: ${secretMissing.join(', ')}`);
        return;
      }
    }

    installMutation.mutate({
      skillId: state.activeSkill.id,
      mode: state.mode,
      config: buildConfigPayload(activeConfigSchema, state.configValues),
      apiKey: state.mode === 'byok' ? String(state.secretValues.apiKey || '').trim() : undefined,
    });
  }, [activeConfigSchema, activeSecretSchema, installMutation, state]);
}

function useToggleActions({
  state,
  toggleMutation,
}: {
  state: SkillsDialogState;
  toggleMutation: ReturnType<typeof useToggleMutation>;
}) {
  const toggleActiveSkill = useCallback(() => {
    if (!state.activeSkill?.installation) {
      return;
    }

    toggleMutation.mutate({
      installationId: state.activeSkill.installation.id,
      enabled: !state.activeSkill.installation.enabled,
    });
  }, [state.activeSkill, toggleMutation]);

  const toggleInstalledSkill = useCallback(
    (installationId: string, enabled: boolean) =>
      toggleMutation.mutate({ installationId, enabled }),
    [toggleMutation]
  );

  return { toggleActiveSkill, toggleInstalledSkill };
}

export function useSkillsPageModel() {
  const { selectedBrand } = useBrandStore();
  const brandId = selectedBrand?.id ?? null;
  const userBrandName = selectedBrand?.name ?? null;
  const [search, setSearch] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSkillId = searchParams.get('skill');
  const queryClient = useQueryClient();
  const { state, setState, setConfigOpen } = useDialogState();
  const skillsQuery = useSkillsQuery(brandId);
  const skills = skillsQuery.data ?? [];
  const { installedSkills, availableSkills } = useDerivedSkillCollections(skills, search);
  const supportedModes = useSupportedModes(state.activeSkill);
  const activeSkillMeta = useActiveSkillMeta(state.activeSkill, state.configValues);
  const closeDialog = useCloseDialog(setState);
  const initializeSkillForm = useInitializeSkillForm(setState);
  const openConfigure = useOpenConfigure({ brandId, setState, initializeSkillForm });
  const toggleMutation = useToggleMutation(queryClient, brandId);
  const installMutation = useInstallMutation({ brandId, queryClient, onSuccess: closeDialog });
  const uninstallMutation = useUninstallMutation({ brandId, queryClient, onSuccess: closeDialog });
  const { setMode, setConfigValue, setSecretValue } = useDialogFieldSetters(setState);
  const onDialogOpenChange = useDialogOpenChange({ closeDialog, setConfigOpen });
  const copyExamplePrompt = useCopyExamplePrompt(activeSkillMeta.examplePrompt);
  const submitActiveSkill = useSubmitActiveSkill({
    state,
    activeConfigSchema: activeSkillMeta.activeConfigSchema,
    activeSecretSchema: activeSkillMeta.activeSecretSchema,
    installMutation,
  });
  const { toggleActiveSkill, toggleInstalledSkill } = useToggleActions({ state, toggleMutation });

  useAutoOpenRequestedSkill({
    requestedSkillId,
    skills: skillsQuery.data,
    openConfigure,
    searchParams,
    setSearchParams,
  });
  useModeGuard(state.activeSkill, state.mode, supportedModes, setState);

  return {
    selectedBrand,
    userBrandName,
    search,
    isInitialLoading: skillsQuery.isLoading && !skillsQuery.data,
    installedSkills,
    availableSkills,
    textGenerationSkill: skillsQuery.data?.find((skill) => skill.id === 'text_generation') ?? null,
    configOpen: state.configOpen,
    activeSkill: state.activeSkill,
    mode: state.mode,
    supportedModes,
    configValues: state.configValues,
    secretValues: state.secretValues,
    loadingSkillDetail: state.loadingSkillDetail,
    activeConfigSchema: activeSkillMeta.activeConfigSchema,
    activeSecretSchema: activeSkillMeta.activeSecretSchema,
    activeDocs: activeSkillMeta.activeDocs,
    activeDocsUrl: activeSkillMeta.activeDocsUrl,
    examplePrompt: activeSkillMeta.examplePrompt,
    pendingToggle: toggleMutation.isPending,
    pendingInstall: installMutation.isPending,
    pendingUninstall: uninstallMutation.isPending,
    setSearch,
    setMode,
    setConfigValue,
    setSecretValue,
    onDialogOpenChange,
    openConfigure,
    submitActiveSkill,
    uninstallActiveSkill: () => state.activeSkill && uninstallMutation.mutate(state.activeSkill),
    toggleActiveSkill,
    toggleInstalledSkill,
    copyExamplePrompt,
  };
}
