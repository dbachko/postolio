import { useCallback } from 'react';
import { toast } from 'sonner';

import type { RecipeInputField, RecipeSummary } from '@/lib/api/recipes-client';
import type { SkillSummary } from '@/lib/api/skills-client';

import { getRecipeInputFields, isMissingFieldValue, toHumanLabel } from './recipes-utils';
import type { RunState } from './recipe-run-types';

type RunMutationLike = {
  mutate: (params: {
    recipe: RecipeSummary;
    input: Record<string, unknown>;
    destinationId: string;
  }) => void;
};

function getInitialRunInput(recipe: RecipeSummary): Record<string, unknown> {
  const fields = getRecipeInputFields(recipe);
  const next: Record<string, unknown> = {};
  fields.forEach((field) => {
    if (field.default != null) {
      next[field.key] = field.default;
      return;
    }
    if (
      field.multiple ||
      field.type === 'asset_picker' ||
      field.type === 'asset_reference_selector'
    ) {
      next[field.key] = [];
      return;
    }
    next[field.key] = '';
  });
  return next;
}

function ensureRequiredSkills({
  recipe,
  skills,
  navigate,
}: {
  recipe: RecipeSummary;
  skills: SkillSummary[];
  navigate: (path: string) => void;
}) {
  const enabledSkillIds = new Set(
    skills
      .filter((skill) => skill.installation?.enabled)
      .map((skill) => skill.id)
      .filter(Boolean)
  );
  const requiredSkills = Array.isArray(recipe.skillsRequired) ? recipe.skillsRequired : [];
  const missing = requiredSkills.filter((skillId) => !enabledSkillIds.has(skillId));
  if (missing.length === 0) {
    return true;
  }

  toast.error(`Missing required skills: ${missing.join(', ')}`);
  navigate(`/skills?skill=${encodeURIComponent(missing[0])}`);
  return false;
}

export function useOpenRunDialog({
  skills,
  navigate,
  preferredDestinationId,
  setState,
}: {
  skills: SkillSummary[];
  navigate: (path: string) => void;
  preferredDestinationId: string | null;
  setState: React.Dispatch<React.SetStateAction<RunState>>;
}) {
  return useCallback(
    (recipe: RecipeSummary) => {
      if (skills.length > 0 && !ensureRequiredSkills({ recipe, skills, navigate })) {
        return;
      }

      setState((prev) => ({
        ...prev,
        runRecipe: recipe,
        runDestinationIds: preferredDestinationId ? [preferredDestinationId] : [],
        runInput: getInitialRunInput(recipe),
        assetPickerFieldKey: null,
        runOpen: true,
      }));
    },
    [navigate, preferredDestinationId, setState, skills]
  );
}

export function useCloseRunDialog(setState: React.Dispatch<React.SetStateAction<RunState>>) {
  return useCallback(() => {
    setState((prev) => ({
      ...prev,
      runOpen: false,
      runRecipe: null,
      runInput: {},
      assetPickerFieldKey: null,
    }));
  }, [setState]);
}

export function useSubmitRun({
  state,
  runRequiredInputFields,
  createRunMutation,
  multiDestinationEnabled,
}: {
  state: RunState;
  runRequiredInputFields: RecipeInputField[];
  createRunMutation: RunMutationLike;
  multiDestinationEnabled: boolean;
}) {
  return useCallback(() => {
    if (!state.runRecipe) {
      return;
    }
    if (state.runDestinationIds.length === 0) {
      toast.error(
        multiDestinationEnabled
          ? 'Choose a destination'
          : 'No destination account is available for this brand.'
      );
      return;
    }

    for (const field of runRequiredInputFields) {
      if (isMissingFieldValue(state.runInput[field.key])) {
        toast.error(`Missing required input: ${field.label || toHumanLabel(field.key)}`);
        return;
      }
    }

    createRunMutation.mutate({
      recipe: state.runRecipe,
      input: state.runInput,
      destinationId: state.runDestinationIds[0],
    });
  }, [createRunMutation, multiDestinationEnabled, runRequiredInputFields, state]);
}

export function useRunStateSetters(setState: React.Dispatch<React.SetStateAction<RunState>>) {
  const setRunInputValue = useCallback(
    (key: string, value: unknown) =>
      setState((prev) => ({ ...prev, runInput: { ...prev.runInput, [key]: value } })),
    [setState]
  );

  return {
    setRunOpen: (runOpen: boolean) => setState((prev) => ({ ...prev, runOpen })),
    setRunRecipe: (runRecipe: RecipeSummary | null) => setState((prev) => ({ ...prev, runRecipe })),
    setRunInput: (runInput: Record<string, unknown>) => setState((prev) => ({ ...prev, runInput })),
    setRunDestinationIds: (runDestinationIds: string[]) =>
      setState((prev) => ({ ...prev, runDestinationIds })),
    setAssetPickerFieldKey: (assetPickerFieldKey: string | null) =>
      setState((prev) => ({ ...prev, assetPickerFieldKey })),
    setRunInputValue,
  };
}
