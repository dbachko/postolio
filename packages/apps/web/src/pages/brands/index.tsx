import type { Brand } from '@/lib/api';

import { BrandsPageView } from './components/brands-page-view';
import { useBrandsPageState } from './hooks/use-brands-page-state';

function useBrandsPageHandlers(state: ReturnType<typeof useBrandsPageState>) {
  const handleSelectBrand = (brand: Brand) => {
    state.setSelectedBrand(brand);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCreateSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    state.createBrandMutation.mutate(state.createFormData);
  };

  const handleEditStart = (brand: Brand) => {
    state.setEditingBrandId(brand.id);
    state.setEditFormData({
      [brand.id]: {
        name: brand.name,
        description: brand.description || '',
        countryCode: (brand.countryCode || '') as string,
      },
    });
  };

  const handleEditCancel = (brandId: string) => {
    state.setEditingBrandId(null);
    state.setEditFormData((current) => {
      const next = { ...current };
      delete next[brandId];
      return next;
    });
  };

  const handleEditSubmit = (event: React.FormEvent, brandId: string) => {
    event.preventDefault();
    const data = state.editFormData[brandId];
    if (!data) {
      return;
    }
    state.updateBrandMutation.mutate({
      brandId,
      data: {
        name: data.name,
        description: data.description,
        countryCode: data.countryCode ? data.countryCode.toUpperCase() : undefined,
      },
    });
  };

  const handleDeleteBrand = (brand: Brand) => {
    if (
      window.confirm(
        `Are you sure you want to delete "${brand.name}"? This will also delete all associated content and cannot be undone.`
      )
    ) {
      state.deleteBrandMutation.mutate(brand.id);
    }
  };

  return {
    handleSelectBrand,
    handleCreateSubmit,
    handleEditStart,
    handleEditCancel,
    handleEditSubmit,
    handleDeleteBrand,
  };
}

export function Brands() {
  const state = useBrandsPageState();
  const handlers = useBrandsPageHandlers(state);

  return (
    <BrandsPageView
      isCreating={state.isCreating}
      hasExistingBrand={state.hasExistingBrand}
      selectedBrand={state.selectedBrand}
      profileAvailable={state.profileAvailable}
      profileSummaries={state.profileSummaries}
      createFormData={state.createFormData}
      editFormData={state.editFormData}
      editingBrandId={state.editingBrandId}
      brands={state.brands}
      brandsLoading={state.brandsLoading}
      createPending={state.createBrandMutation.isPending}
      deletePending={state.deleteBrandMutation.isPending}
      updatePending={state.updateBrandMutation.isPending}
      createError={
        state.createBrandMutation.error?.message ||
        (state.createBrandMutation.error ? 'Failed to create brand. Please try again.' : undefined)
      }
      deleteError={
        state.deleteBrandMutation.error?.message ||
        (state.deleteBrandMutation.error ? 'Failed to delete brand. Please try again.' : undefined)
      }
      updateError={
        state.updateBrandMutation.error?.message ||
        (state.updateBrandMutation.error ? 'Failed to update brand. Please try again.' : undefined)
      }
      onToggleCreating={() => state.setIsCreating((value) => !value)}
      onCancelCreate={() => state.setIsCreating(false)}
      onCreateSubmit={handlers.handleCreateSubmit}
      onCreateFormChange={state.setCreateFormData}
      onStartCreating={() => state.setIsCreating(true)}
      onSelectBrand={handlers.handleSelectBrand}
      onEditStart={handlers.handleEditStart}
      onEditCancel={handlers.handleEditCancel}
      onEditSubmit={handlers.handleEditSubmit}
      onDeleteBrand={handlers.handleDeleteBrand}
      onEditFieldChange={(brandId, field, value) =>
        state.setEditFormData((current) => ({
          ...current,
          [brandId]: {
            ...current[brandId],
            [field]: value,
          },
        }))
      }
    />
  );
}
