import { AppEmptyState } from '@/components/app-empty-state';
import { Button } from '@/components/ui/button';
import { SortControls } from '@/features/assets/components/SortControls';

import { RecipesFiltersPopover } from './recipes-filters-popover';
import { RecipesGrid } from './recipes-grid';
import { RecipeRunDialog } from './recipe-run-dialog';
import { RecipeAssetPickerOverlay } from './recipe-asset-picker-overlay';
import type { useRecipesPageModel } from './use-recipes-page-model';

type RecipesPageModel = ReturnType<typeof useRecipesPageModel>;

function RecipesHeader({ model }: { model: RecipesPageModel }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-foreground text-2xl font-semibold">Recipes</h1>
        <p className="text-muted-foreground text-sm">
          Generate content from reusable workflows powered by skills and AI.
        </p>
        {model.creditsQuery.data ? (
          <p className="text-muted-foreground mt-1 text-xs">
            AI credits: <span className="font-mono">{model.creditsQuery.data.balanceCredits}</span>
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={() => model.navigate('/skills')}>
          Skills
        </Button>
        <Button variant="outline" onClick={() => model.navigate('/runs')}>
          History
        </Button>
        <SortControls
          field={model.sortField}
          direction={model.sortDirection}
          onFieldChange={model.setSortField}
          onDirectionToggle={() =>
            model.setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
          }
          options={[
            { value: 'name', label: 'Name' },
            { value: 'type', label: 'Type' },
          ]}
          placeholder="Sort recipes"
          triggerWidthClassName="sm:w-auto"
        />
        <RecipesFiltersPopover
          filtersOpen={model.filtersOpen}
          hasAnyActiveFilters={model.hasAnyActiveFilters}
          activeFilterCount={model.activeFilterCount}
          search={model.search}
          categoryFilterOptions={model.categoryFilterOptions}
          categoryFilters={model.categoryFilters}
          requiredSkillFilterOptions={model.requiredSkillFilterOptions}
          requiredSkillFilters={model.requiredSkillFilters}
          requiredSkillFilterLabelById={model.requiredSkillFilterLabelById}
          readinessFilters={model.readinessFilters}
          canFilterByReadiness={model.canFilterByReadiness}
          setFiltersOpen={model.setFiltersOpen}
          setSearch={model.setSearch}
          clearFilters={model.clearFilters}
          toggleCategoryFilter={model.toggleCategoryFilter}
          toggleRequiredSkillFilter={model.toggleRequiredSkillFilter}
          toggleReadinessFilter={model.toggleReadinessFilter}
        />
      </div>
    </div>
  );
}

function RecipesStates({ model }: { model: RecipesPageModel }) {
  if (model.recipes.length === 0) {
    return (
      <div className="py-10">
        <AppEmptyState
          variant="minimal"
          title="No recipes yet"
          description="No recipes are currently available for this brand."
        />
      </div>
    );
  }

  if (model.sortedRecipes.length === 0) {
    return (
      <div className="py-10">
        <AppEmptyState
          variant="minimal"
          title="No recipes match current filters"
          description="Adjust filters or reset them to see more recipes."
          actions={[{ label: 'Reset filters', onClick: model.clearFilters }]}
        />
      </div>
    );
  }

  return (
    <RecipesGrid
      sortedRecipes={model.sortedRecipes}
      skillById={model.skillById}
      onOpenRunDialog={model.openRunDialog}
      onNavigateSkills={(skillId) => model.navigate(`/skills?skill=${encodeURIComponent(skillId)}`)}
    />
  );
}

function buildRunDialogProps(model: RecipesPageModel) {
  const runEstimateCredits = model.runEstimate?.estimate.estimatedCredits ?? 0;
  const runEstimateUsd = model.runEstimate?.estimate.estimatedUsd ?? '0.0000';
  const creditsBalance =
    model.runEstimate?.balanceCredits ?? model.creditsQuery.data?.balanceCredits ?? 0;
  const canSubmit =
    Boolean(model.runRecipe) &&
    !model.createRunMutation.isPending &&
    !model.topUpMutation.isPending &&
    !model.blocksRunForCredits &&
    model.runDestinationIds.length > 0;

  return {
    open: model.runOpen,
    runRecipe: model.runRecipe,
    runInput: model.runInput,
    runRequiredInputFields: model.runRequiredInputFields,
    runOptionalInputFields: model.runOptionalInputFields,
    runDestinationIds: model.runDestinationIds,
    destinationPickerOptions: model.destinationPickerOptions,
    selectedRunDestination: model.selectedRunDestination,
    connectedAccountsLoading: model.connectedAccountsQuery.isLoading,
    recipeDestinationUiEnabled: model.recipeDestinationUiEnabled,
    multiDestinationEnabled: model.multiDestinationEnabled,
    blocksRunForCredits: model.blocksRunForCredits,
    runShortfall: model.runShortfall,
    createRunPending: model.createRunMutation.isPending,
    topUpPending: model.topUpMutation.isPending,
    runEstimateLoading: model.runEstimateQuery.isLoading,
    runEstimateCredits,
    runEstimateUsd,
    creditsBalance,
    canSubmit,
    onOpenChange: (open: boolean) => {
      if (!open) {
        model.closeRunDialog();
        return;
      }
      model.setRunOpen(true);
    },
    onSelectDestinations: (next: string[]) => {
      const nextUnique = Array.from(new Set(next)).filter((id) =>
        model.destinationPickerOptions.some((option) => option.id === id)
      );
      if (nextUnique.length <= 1) {
        model.setRunDestinationIds(nextUnique);
        return;
      }
      const prevSet = new Set(model.runDestinationIds);
      const added = nextUnique.find((id) => !prevSet.has(id)) || null;
      model.setRunDestinationIds(added ? [added] : [nextUnique[0]]);
    },
    onSetInput: model.setRunInputValue,
    onOpenAssetPicker: model.setAssetPickerFieldKey,
    onClearAssetSelection: (fieldKey: string) => model.setRunInputValue(fieldKey, []),
    onTopUp: () => model.topUpMutation.mutate(),
    onSubmit: model.submitRun,
  };
}

export function RecipesPageContent({ model }: { model: RecipesPageModel }) {
  if (!model.selectedBrand) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AppEmptyState
          variant="minimal"
          title="Select a brand to use recipes"
          description="Choose which brand you want to generate content for."
          actions={[{ label: 'Choose Brand', to: '/brands' }]}
        />
      </div>
    );
  }

  const runDialogProps = buildRunDialogProps(model);

  return (
    <div className="space-y-6">
      <RecipesHeader model={model} />

      {model.recipes.length > 0 ? (
        <div className="text-muted-foreground text-xs">
          Showing {model.sortedRecipes.length} of {model.recipes.length} recipes
        </div>
      ) : null}

      <RecipesStates model={model} />

      <RecipeRunDialog {...runDialogProps} />

      <RecipeAssetPickerOverlay
        brandId={model.brandId}
        assetPickerFieldKey={model.assetPickerFieldKey}
        activeAssetPickerField={model.activeAssetPickerField}
        onSelect={(fieldKey, assetIds) => {
          model.setRunInputValue(fieldKey, assetIds);
          model.setAssetPickerFieldKey(null);
        }}
        onClose={() => model.setAssetPickerFieldKey(null)}
      />
    </div>
  );
}
