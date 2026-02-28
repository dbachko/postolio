import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';

import type { RecipeCategory, RecipeSummary } from '@/lib/api/recipes-client';
import type { SkillSummary } from '@/lib/api/skills-client';
import type { SortDirection } from '@/features/assets/components/asset-utils';

import {
  categoryName,
  formatSkillFilterLabel,
  getRecipeReadiness,
  normalizeRecipeName,
  type RecipeReadiness,
  type RecipeSortField,
  toHumanLabel,
} from './recipes-utils';

function useFilterState() {
  const [sortField, setSortField] = useState<RecipeSortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categoryFilters, setCategoryFilters] = useState<RecipeCategory[]>([]);
  const [requiredSkillFilters, setRequiredSkillFilters] = useState<string[]>([]);
  const [readinessFilters, setReadinessFilters] = useState<RecipeReadiness[]>([]);

  return {
    sortField,
    sortDirection,
    filtersOpen,
    categoryFilters,
    requiredSkillFilters,
    readinessFilters,
    setSortField,
    setSortDirection,
    setFiltersOpen,
    setCategoryFilters,
    setRequiredSkillFilters,
    setReadinessFilters,
  };
}

function useCategoryFilterOptions(recipes: RecipeSummary[]) {
  return useMemo(() => {
    const order: RecipeCategory[] = ['get_started', 'content', 'growth', 'social', 'other'];
    return order.filter((category) => recipes.some((recipe) => recipe.category === category));
  }, [recipes]);
}

function useRequiredSkillFilterOptions(
  recipes: RecipeSummary[],
  skillById: Map<string, SkillSummary>
) {
  return useMemo(() => {
    const ids = new Set<string>();
    recipes.forEach((recipe) => {
      const required = Array.isArray(recipe.skillsRequired) ? recipe.skillsRequired : [];
      required.forEach((id) => {
        const key = String(id || '').trim();
        if (key) {
          ids.add(key);
        }
      });
    });

    return Array.from(ids)
      .map((id) => {
        const baseLabel = skillById.get(id)?.name || toHumanLabel(id);
        return { id, label: baseLabel, displayLabel: formatSkillFilterLabel(id, baseLabel) };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [recipes, skillById]);
}

function useFilteredRecipes({
  recipes,
  categoryFilters,
  requiredSkillFilters,
  readinessFilters,
  canFilterByReadiness,
  skillById,
}: {
  recipes: RecipeSummary[];
  categoryFilters: RecipeCategory[];
  requiredSkillFilters: string[];
  readinessFilters: RecipeReadiness[];
  canFilterByReadiness: boolean;
  skillById: Map<string, SkillSummary>;
}) {
  return useMemo(() => {
    return recipes.filter((recipe) => {
      if (categoryFilters.length > 0 && !categoryFilters.includes(recipe.category)) {
        return false;
      }

      if (requiredSkillFilters.length > 0) {
        const required = Array.isArray(recipe.skillsRequired) ? recipe.skillsRequired : [];
        if (!requiredSkillFilters.some((skillId) => required.includes(skillId))) {
          return false;
        }
      }

      if (readinessFilters.length > 0) {
        if (!canFilterByReadiness) {
          return false;
        }
        const readiness = getRecipeReadiness(recipe, skillById);
        if (!readinessFilters.includes(readiness)) {
          return false;
        }
      }

      return true;
    });
  }, [
    recipes,
    categoryFilters,
    requiredSkillFilters,
    readinessFilters,
    canFilterByReadiness,
    skillById,
  ]);
}

function useSortedRecipes(
  filteredRecipes: RecipeSummary[],
  sortField: RecipeSortField,
  sortDirection: SortDirection
) {
  return useMemo(() => {
    const sorted = [...filteredRecipes];
    const multiplier = sortDirection === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
      const aName = normalizeRecipeName(a.name).toLowerCase();
      const bName = normalizeRecipeName(b.name).toLowerCase();
      const aType = categoryName(a.category).toLowerCase();
      const bType = categoryName(b.category).toLowerCase();

      if (sortField === 'type') {
        return aType.localeCompare(bType) * multiplier || aName.localeCompare(bName);
      }
      return aName.localeCompare(bName) * multiplier || aType.localeCompare(bType);
    });

    return sorted;
  }, [filteredRecipes, sortDirection, sortField]);
}

export function useRecipeFiltersModel({
  recipes,
  skillById,
  skillsLoading,
  search,
  setSearch,
}: {
  recipes: RecipeSummary[];
  skillById: Map<string, SkillSummary>;
  skillsLoading: boolean;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
}) {
  const state = useFilterState();
  const canFilterByReadiness = !skillsLoading;
  const categoryFilterOptions = useCategoryFilterOptions(recipes);
  const requiredSkillFilterOptions = useRequiredSkillFilterOptions(recipes, skillById);
  const requiredSkillFilterLabelById = useMemo(
    () => new Map(requiredSkillFilterOptions.map((item) => [item.id, item.displayLabel] as const)),
    [requiredSkillFilterOptions]
  );

  const filteredRecipes = useFilteredRecipes({
    recipes,
    categoryFilters: state.categoryFilters,
    requiredSkillFilters: state.requiredSkillFilters,
    readinessFilters: state.readinessFilters,
    canFilterByReadiness,
    skillById,
  });
  const sortedRecipes = useSortedRecipes(filteredRecipes, state.sortField, state.sortDirection);

  const hasAnyActiveFilters =
    Boolean(search.trim()) ||
    state.categoryFilters.length > 0 ||
    state.requiredSkillFilters.length > 0 ||
    state.readinessFilters.length > 0;
  const activeFilterCount =
    (search.trim().length > 0 ? 1 : 0) +
    (state.categoryFilters.length > 0 ? 1 : 0) +
    (state.requiredSkillFilters.length > 0 ? 1 : 0) +
    (state.readinessFilters.length > 0 ? 1 : 0);

  const toggleCategoryFilter = (category: RecipeCategory) => {
    state.setCategoryFilters((prev) =>
      prev.includes(category) ? prev.filter((item) => item !== category) : [...prev, category]
    );
  };

  const toggleRequiredSkillFilter = (skillId: string) => {
    state.setRequiredSkillFilters((prev) =>
      prev.includes(skillId) ? prev.filter((item) => item !== skillId) : [...prev, skillId]
    );
  };

  const toggleReadinessFilter = (readiness: RecipeReadiness) => {
    state.setReadinessFilters((prev) =>
      prev.includes(readiness) ? prev.filter((item) => item !== readiness) : [...prev, readiness]
    );
  };

  const clearFilters = () => {
    setSearch('');
    state.setCategoryFilters([]);
    state.setRequiredSkillFilters([]);
    state.setReadinessFilters([]);
  };

  return {
    ...state,
    search,
    setSearch,
    canFilterByReadiness,
    categoryFilterOptions,
    requiredSkillFilterOptions,
    requiredSkillFilterLabelById,
    sortedRecipes,
    hasAnyActiveFilters,
    activeFilterCount,
    toggleCategoryFilter,
    toggleRequiredSkillFilter,
    toggleReadinessFilter,
    clearFilters,
  };
}
