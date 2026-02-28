import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/stores/authStore';
import { useBrandStore } from '@/stores/brandStore';
import { isMultiDestinationEnabled, isRecipeDestinationUiEnabled } from '@/lib/feature-flags';

import { useRecipeFiltersModel } from './use-recipes-filters';
import { useRecipesData } from './use-recipes-data';
import { useRecipeRunModel } from './use-recipe-run-model';

export function useRecipesPageModel() {
  const { selectedBrand } = useBrandStore();
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const brandId = selectedBrand?.id ?? null;
  const [search, setSearch] = useState('');
  const multiDestinationEnabled = isMultiDestinationEnabled(user);
  const recipeDestinationUiEnabled = isRecipeDestinationUiEnabled();

  const dataModel = useRecipesData({
    brandId,
    search,
    multiDestinationEnabled,
  });

  const recipeFilters = useRecipeFiltersModel({
    recipes: dataModel.recipes,
    skillById: dataModel.skillById,
    skillsLoading: dataModel.skillsQuery.isLoading,
    search,
    setSearch,
  });

  const runModel = useRecipeRunModel({
    brandId,
    navigate,
    queryClient,
    skills: dataModel.skills,
    preferredDestinationId: dataModel.preferredDestinationId,
    destinationPickerOptions: dataModel.destinationPickerOptions,
    multiDestinationEnabled,
  });

  return {
    selectedBrand,
    brandId,
    navigate,
    multiDestinationEnabled,
    recipeDestinationUiEnabled,
    ...dataModel,
    ...recipeFilters,
    ...runModel,
  };
}
