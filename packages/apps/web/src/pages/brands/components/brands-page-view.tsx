import type { Brand } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';

import { BrandsList } from './brands-list';
import { CreateBrandPanel } from './create-brand-panel';
import { SidebarViewProfileButton } from './sidebar-view-profile-button';

type EditFormValues = { name: string; description: string; countryCode: string };

type CreateFormValues = { name: string; description: string; countryCode: string };

type BrandsPageViewProps = {
  isCreating: boolean;
  hasExistingBrand: boolean;
  selectedBrand: Brand | null;
  profileAvailable: Record<string, boolean>;
  profileSummaries: Record<string, { tones: string[]; palette: string[] }>;
  createFormData: CreateFormValues;
  editFormData: Record<string, EditFormValues>;
  editingBrandId: string | null;
  brands: Brand[];
  brandsLoading: boolean;
  createPending: boolean;
  deletePending: boolean;
  updatePending: boolean;
  createError?: string;
  deleteError?: string;
  updateError?: string;
  onToggleCreating: () => void;
  onCancelCreate: () => void;
  onCreateSubmit: (event: React.FormEvent) => void;
  onCreateFormChange: (next: CreateFormValues) => void;
  onStartCreating: () => void;
  onSelectBrand: (brand: Brand) => void;
  onEditStart: (brand: Brand) => void;
  onEditCancel: (brandId: string) => void;
  onEditSubmit: (event: React.FormEvent, brandId: string) => void;
  onDeleteBrand: (brand: Brand) => void;
  onEditFieldChange: (brandId: string, field: string, value: string) => void;
};

export function BrandsPageView(props: BrandsPageViewProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Brand Management"
        description="Create and manage your brand profiles for AI content generation"
        actions={
          <div className="flex items-center gap-2">
            {props.selectedBrand && props.profileAvailable[props.selectedBrand.id] ? (
              <SidebarViewProfileButton brandId={props.selectedBrand.id} />
            ) : null}
            {props.hasExistingBrand ? (
              <Button variant="neutral" disabled title="This feature is coming later.">
                Create Brand
              </Button>
            ) : (
              <Button
                variant={props.isCreating ? 'outline' : 'neutral'}
                onClick={props.onToggleCreating}
              >
                {props.isCreating ? 'Cancel' : 'Create Brand'}
              </Button>
            )}
          </div>
        }
      />

      {props.isCreating ? (
        <CreateBrandPanel
          formData={props.createFormData}
          isPending={props.createPending}
          errorMessage={props.createError}
          onCancel={props.onCancelCreate}
          onSubmit={props.onCreateSubmit}
          onChange={props.onCreateFormChange}
        />
      ) : null}

      {props.deleteError ? (
        <div className="bg-muted rounded-md border p-3">
          <p className="text-destructive text-sm">{props.deleteError}</p>
        </div>
      ) : null}

      <BrandsList
        isLoading={props.brandsLoading}
        brands={props.brands}
        selectedBrand={props.selectedBrand}
        editingBrandId={props.editingBrandId}
        editFormData={props.editFormData}
        profileAvailable={props.profileAvailable}
        profileSummaries={props.profileSummaries}
        updateErrorMessage={props.updateError}
        isUpdating={props.updatePending}
        isDeleting={props.deletePending}
        onStartCreating={props.onStartCreating}
        onSelectBrand={props.onSelectBrand}
        onEditStart={props.onEditStart}
        onEditCancel={props.onEditCancel}
        onEditSubmit={props.onEditSubmit}
        onDeleteBrand={props.onDeleteBrand}
        onEditFieldChange={props.onEditFieldChange}
      />
    </div>
  );
}
