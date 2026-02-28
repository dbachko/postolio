import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { runs as runsApi } from '@/lib/api';
import type { RecipeSummary } from '@/lib/api/recipes-client';
import type { SkillSummary } from '@/lib/api/skills-client';
import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';

import { getRecipeInputFields } from './recipes-utils';
import type { RunState } from './recipe-run-types';
import {
  useCloseRunDialog,
  useOpenRunDialog,
  useRunStateSetters,
  useSubmitRun,
} from './use-recipe-run-actions';

function useRunState() {
  const [state, setState] = useState<RunState>({
    runOpen: false,
    runRecipe: null,
    runDestinationIds: [],
    runInput: {},
    assetPickerFieldKey: null,
  });

  return { state, setState };
}

function normalizeRunInput(inputRaw: Record<string, unknown>, destinationId: string) {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(inputRaw)) {
    if (value == null) {
      continue;
    }
    if (Array.isArray(value)) {
      const list = value.map((item) => String(item || '').trim()).filter((item) => item.length > 0);
      if (list.length > 0) {
        normalized[key] = list;
      }
      continue;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        normalized[key] = trimmed;
      }
      continue;
    }
    normalized[key] = value;
  }

  normalized.target_social_account_id = destinationId;
  return normalized;
}

function getInsufficientCreditsMessage(data: any): string {
  const shortfall = Number(data?.details?.shortfallCredits || 0);
  const balance = Number(data?.details?.balanceCredits || 0);
  if (shortfall > 0) {
    return `Not enough AI credits (${balance} available, short by ${shortfall}).`;
  }
  return 'Not enough AI credits.';
}

function getCreateRunErrorMessage(error: unknown): string {
  const data = error instanceof Error ? ((error as any).data as any) : null;
  const missing = data?.details?.missingSkills as undefined | Array<{ skillId: string }>;
  if (Array.isArray(missing) && missing.length) {
    return `Missing required skills: ${missing.map((item) => item.skillId).join(', ')}`;
  }
  if (data?.code === 'INSUFFICIENT_AI_CREDITS') {
    return getInsufficientCreditsMessage(data);
  }
  return error instanceof Error ? error.message : 'Failed to start run';
}

function useCreateRunMutation({
  brandId,
  queryClient,
  navigate,
  setState,
}: {
  brandId: string | null;
  queryClient: QueryClient;
  navigate: (path: string) => void;
  setState: React.Dispatch<React.SetStateAction<RunState>>;
}) {
  return useMutation({
    mutationFn: async (params: {
      recipe: RecipeSummary;
      input: Record<string, unknown>;
      destinationId: string;
    }) => {
      if (!brandId) {
        throw new Error('Brand required');
      }
      const versionId = params.recipe.publishedVersion?.id;
      if (!versionId) {
        throw new Error('Recipe is not published');
      }

      return await runsApi.createRun({
        brandId,
        recipeVersionId: versionId,
        trigger: 'manual',
        input: normalizeRunInput(params.input, params.destinationId),
      });
    },
    onSuccess: async (response) => {
      toast.success('Generation started');
      setState(() => ({
        runOpen: false,
        runRecipe: null,
        runDestinationIds: [],
        runInput: {},
        assetPickerFieldKey: null,
      }));
      await queryClient.invalidateQueries({ queryKey: ['run-credits', brandId] });
      navigate(`/runs/${response.runId}`);
    },
    onError: (error) => {
      toast.error(getCreateRunErrorMessage(error));
    },
  });
}

function useRunCredits({
  brandId,
  runOpen,
  runRecipe,
  runInput,
}: {
  brandId: string | null;
  runOpen: boolean;
  runRecipe: RecipeSummary | null;
  runInput: Record<string, unknown>;
}) {
  const creditsQuery = useQuery({
    queryKey: ['run-credits', brandId],
    enabled: Boolean(brandId),
    queryFn: async () => {
      const response = await runsApi.getCredits(brandId!);
      return response.credits;
    },
  });

  const runEstimateQuery = useQuery({
    queryKey: ['run-estimate', brandId, runRecipe?.publishedVersion?.id],
    enabled: Boolean(runOpen && brandId && runRecipe?.publishedVersion?.id),
    queryFn: async () =>
      await runsApi.estimateRun({
        brandId: brandId!,
        recipeVersionId: runRecipe!.publishedVersion!.id,
        input: runInput,
      }),
  });

  const runEstimate = runEstimateQuery.data;
  const enforcementEnabled =
    runEstimate?.enforcementEnabled ?? creditsQuery.data?.enforcementEnabled ?? false;
  const runShortfall = runEstimate?.shortfallCredits ?? 0;

  return {
    creditsQuery,
    runEstimateQuery,
    runEstimate,
    blocksRunForCredits: enforcementEnabled && runShortfall > 0,
    runShortfall,
  };
}

function useTopUpMutation({
  brandId,
  queryClient,
  runRecipe,
}: {
  brandId: string | null;
  queryClient: QueryClient;
  runRecipe: RecipeSummary | null;
}) {
  return useMutation({
    mutationFn: async () => {
      if (!brandId) {
        throw new Error('Brand required');
      }
      return await runsApi.topUpCredits({ brandId, credits: 1000 });
    },
    onSuccess: async () => {
      toast.success('Added 1000 AI credits');
      await queryClient.invalidateQueries({ queryKey: ['run-credits', brandId] });
      await queryClient.invalidateQueries({
        queryKey: ['run-estimate', brandId, runRecipe?.publishedVersion?.id],
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to top up credits');
    },
  });
}

function useRunDestinationDefaults({
  runOpen,
  preferredDestinationId,
  multiDestinationEnabled,
  runDestinationIds,
  setState,
}: {
  runOpen: boolean;
  preferredDestinationId: string | null;
  multiDestinationEnabled: boolean;
  runDestinationIds: string[];
  setState: React.Dispatch<React.SetStateAction<RunState>>;
}) {
  useEffect(() => {
    if (!runOpen || !preferredDestinationId) {
      return;
    }

    if (!multiDestinationEnabled) {
      if (runDestinationIds.length === 1 && runDestinationIds[0] === preferredDestinationId) {
        return;
      }
      setState((prev) => ({ ...prev, runDestinationIds: [preferredDestinationId] }));
      return;
    }

    if (runDestinationIds.length > 0) {
      return;
    }
    setState((prev) => ({ ...prev, runDestinationIds: [preferredDestinationId] }));
  }, [multiDestinationEnabled, preferredDestinationId, runDestinationIds, runOpen, setState]);
}

export function useRecipeRunModel({
  brandId,
  navigate,
  queryClient,
  skills,
  preferredDestinationId,
  destinationPickerOptions,
  multiDestinationEnabled,
}: {
  brandId: string | null;
  navigate: (path: string) => void;
  queryClient: QueryClient;
  skills: SkillSummary[];
  preferredDestinationId: string | null;
  destinationPickerOptions: SocialAccountsPickerOption[];
  multiDestinationEnabled: boolean;
}) {
  const { state, setState } = useRunState();
  const runInputFields = useMemo(() => getRecipeInputFields(state.runRecipe), [state.runRecipe]);
  const runRequiredInputFields = useMemo(
    () => runInputFields.filter((field) => field.required),
    [runInputFields]
  );
  const runOptionalInputFields = useMemo(
    () => runInputFields.filter((field) => !field.required),
    [runInputFields]
  );
  const activeAssetPickerField = useMemo(
    () => runInputFields.find((field) => field.key === state.assetPickerFieldKey) || null,
    [runInputFields, state.assetPickerFieldKey]
  );
  const selectedRunDestination = useMemo(
    () =>
      destinationPickerOptions.find((option) => option.id === state.runDestinationIds[0]) || null,
    [destinationPickerOptions, state.runDestinationIds]
  );

  const createRunMutation = useCreateRunMutation({ brandId, queryClient, navigate, setState });
  const credits = useRunCredits({
    brandId,
    runOpen: state.runOpen,
    runRecipe: state.runRecipe,
    runInput: state.runInput,
  });
  const topUpMutation = useTopUpMutation({ brandId, queryClient, runRecipe: state.runRecipe });

  useRunDestinationDefaults({
    runOpen: state.runOpen,
    preferredDestinationId,
    multiDestinationEnabled,
    runDestinationIds: state.runDestinationIds,
    setState,
  });

  return {
    ...state,
    runInputFields,
    runRequiredInputFields,
    runOptionalInputFields,
    activeAssetPickerField,
    selectedRunDestination,
    createRunMutation,
    topUpMutation,
    creditsQuery: credits.creditsQuery,
    runEstimateQuery: credits.runEstimateQuery,
    runEstimate: credits.runEstimate,
    blocksRunForCredits: credits.blocksRunForCredits,
    runShortfall: credits.runShortfall,
    openRunDialog: useOpenRunDialog({ skills, navigate, preferredDestinationId, setState }),
    closeRunDialog: useCloseRunDialog(setState),
    submitRun: useSubmitRun({
      state,
      runRequiredInputFields,
      createRunMutation,
      multiDestinationEnabled,
    }),
    ...useRunStateSetters(setState),
  };
}
