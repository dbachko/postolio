import type { Brand } from '@/lib/api';
import { BrandAnalysisPanel } from '@/components/brand-analysis-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CountrySelect } from './country-select';

type BrandFormState = {
  name: string;
  description: string;
  countryCode: string;
};

type BrandsListProps = {
  isLoading: boolean;
  brands: Brand[];
  selectedBrand: Brand | null;
  editingBrandId: string | null;
  editFormData: Record<string, BrandFormState>;
  profileAvailable: Record<string, boolean>;
  profileSummaries: Record<string, { tones: string[]; palette: string[] }>;
  updateErrorMessage?: string;
  isUpdating: boolean;
  isDeleting: boolean;
  onStartCreating: () => void;
  onSelectBrand: (brand: Brand) => void;
  onEditStart: (brand: Brand) => void;
  onEditCancel: (brandId: string) => void;
  onEditSubmit: (e: React.FormEvent, brandId: string) => void;
  onDeleteBrand: (brand: Brand) => void;
  onEditFieldChange: (brandId: string, field: keyof BrandFormState, value: string) => void;
};

function BrandsShell(props: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border shadow-sm">
      <div className="border-b px-6 py-4">
        <h2 className="text-lg font-medium">Your Brands</h2>
      </div>
      {props.children}
    </div>
  );
}

function BrandAnalysisSummary({
  brandId,
  profileAvailable,
  profileSummaries,
}: {
  brandId: string;
  profileAvailable: Record<string, boolean>;
  profileSummaries: Record<string, { tones: string[]; palette: string[] }>;
}) {
  if (!profileAvailable[brandId]) {
    return null;
  }
  const summary = profileSummaries[brandId];
  if (!summary) {
    return (
      <span className="bg-accent text-primary inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
        Analyzed
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="text-muted-foreground text-xs">{summary.tones.join(', ') || '—'}</div>
      <div className="flex items-center gap-1">
        {summary.palette.map((hex) => (
          <span
            key={hex}
            title={hex}
            className="inline-block h-3 w-3 rounded-full border"
            style={{ backgroundColor: hex }}
          />
        ))}
      </div>
    </div>
  );
}

function BrandEditForm({
  brandId,
  data,
  updateErrorMessage,
  isUpdating,
  onEditCancel,
  onEditSubmit,
  onEditFieldChange,
}: {
  brandId: string;
  data: BrandFormState;
  updateErrorMessage?: string;
  isUpdating: boolean;
  onEditCancel: (brandId: string) => void;
  onEditSubmit: (e: React.FormEvent, brandId: string) => void;
  onEditFieldChange: (brandId: string, field: keyof BrandFormState, value: string) => void;
}) {
  return (
    <form onSubmit={(e) => onEditSubmit(e, brandId)} className="space-y-4">
      {updateErrorMessage ? (
        <div className="bg-muted rounded-md border p-3">
          <p className="text-destructive text-sm">{updateErrorMessage}</p>
        </div>
      ) : null}

      <div>
        <Label>Brand Name</Label>
        <Input
          type="text"
          required
          value={data.name}
          onChange={(e) => onEditFieldChange(brandId, 'name', e.target.value)}
        />
      </div>

      <div>
        <Label>Country</Label>
        <CountrySelect
          value={data.countryCode}
          onChange={(code) => onEditFieldChange(brandId, 'countryCode', code)}
        />
      </div>

      <div>
        <Label>Description</Label>
        <Textarea
          rows={3}
          value={data.description}
          onChange={(e) => onEditFieldChange(brandId, 'description', e.target.value)}
          placeholder="Brief description of your brand..."
        />
      </div>

      <div>
        <Label>Country Code (ISO‑2)</Label>
        <Input
          type="text"
          maxLength={2}
          className="w-32 uppercase"
          value={data.countryCode}
          onChange={(e) => onEditFieldChange(brandId, 'countryCode', e.target.value)}
          placeholder="US"
        />
      </div>

      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => onEditCancel(brandId)}>
          Cancel
        </Button>
        <Button type="submit" disabled={isUpdating}>
          {isUpdating ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </form>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="border-foreground h-6 w-6 animate-spin rounded-full border-b-2" />
    </div>
  );
}

function EmptyState(props: { onStartCreating: () => void }) {
  return (
    <div className="py-8 text-center">
      <p className="text-muted-foreground mb-4">No brands created yet.</p>
      <Button variant="neutral" onClick={props.onStartCreating}>
        Create Your First Brand
      </Button>
    </div>
  );
}

function SelectedBrandHeader() {
  return (
    <div className="mb-2 flex items-start justify-between">
      <div className="flex items-center space-x-2">
        <h3 className="text-foreground text-sm font-medium">Selected Brand</h3>
        <span className="bg-accent text-primary inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
          Current
        </span>
      </div>
    </div>
  );
}

function SelectedBrandProfileSummary(props: {
  brandId: string;
  profileAvailable: Record<string, boolean>;
  profileSummaries: Record<string, { tones: string[]; palette: string[] }>;
}) {
  if (!props.profileAvailable[props.brandId]) {
    return null;
  }
  return (
    <div className="flex items-center gap-3">
      <div className="text-muted-foreground text-xs">
        Tones: {props.profileSummaries[props.brandId]?.tones.join(', ') || '—'}
      </div>
      <div className="flex items-center gap-1">
        {(props.profileSummaries[props.brandId]?.palette || []).map((hex) => (
          <span
            key={hex}
            title={hex}
            className="inline-block h-3 w-3 rounded-full border"
            style={{ backgroundColor: hex }}
          />
        ))}
      </div>
    </div>
  );
}

function SelectedBrandActions(props: {
  brand: Brand;
  isDeleting: boolean;
  onEditStart: (brand: Brand) => void;
  onDeleteBrand: (brand: Brand) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 sm:justify-end">
      <Button variant="outline" onClick={() => props.onEditStart(props.brand)}>
        Edit
      </Button>
      <Button
        variant="destructive"
        onClick={() => props.onDeleteBrand(props.brand)}
        disabled={props.isDeleting}
      >
        {props.isDeleting ? 'Deleting...' : 'Delete'}
      </Button>
    </div>
  );
}

function SelectedBrandSection(props: {
  brand: Brand;
  editingBrandId: string | null;
  editFormData: Record<string, BrandFormState>;
  updateErrorMessage?: string;
  isUpdating: boolean;
  isDeleting: boolean;
  profileAvailable: Record<string, boolean>;
  profileSummaries: Record<string, { tones: string[]; palette: string[] }>;
  onEditStart: (brand: Brand) => void;
  onEditCancel: (brandId: string) => void;
  onEditSubmit: (e: React.FormEvent, brandId: string) => void;
  onDeleteBrand: (brand: Brand) => void;
  onEditFieldChange: (brandId: string, field: keyof BrandFormState, value: string) => void;
}) {
  return (
    <div className="border-l-4 p-6">
      <SelectedBrandHeader />

      {props.editingBrandId === props.brand.id ? (
        <BrandEditForm
          brandId={props.brand.id}
          data={
            props.editFormData[props.brand.id] || { name: '', description: '', countryCode: '' }
          }
          updateErrorMessage={props.updateErrorMessage}
          isUpdating={props.isUpdating}
          onEditCancel={props.onEditCancel}
          onEditSubmit={props.onEditSubmit}
          onEditFieldChange={props.onEditFieldChange}
        />
      ) : (
        <div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex-1">
              <h3 className="text-lg font-medium">{props.brand.name}</h3>
              {props.brand.description ? (
                <p className="text-muted-foreground mt-1">{props.brand.description}</p>
              ) : null}
              <p className="text-muted-foreground mt-2 text-xs">
                Created {new Date(props.brand.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:justify-end">
              <SelectedBrandProfileSummary
                brandId={props.brand.id}
                profileAvailable={props.profileAvailable}
                profileSummaries={props.profileSummaries}
              />
              <SelectedBrandActions
                brand={props.brand}
                isDeleting={props.isDeleting}
                onEditStart={props.onEditStart}
                onDeleteBrand={props.onDeleteBrand}
              />
            </div>
          </div>
        </div>
      )}
      <div id="brand-analysis-panel" className="mt-6">
        <BrandAnalysisPanel brandId={props.brand.id} />
      </div>
    </div>
  );
}

function OtherBrandsSection(props: {
  brands: Brand[];
  selectedBrandId?: string;
  profileAvailable: Record<string, boolean>;
  profileSummaries: Record<string, { tones: string[]; palette: string[] }>;
  onSelectBrand: (brand: Brand) => void;
}) {
  return (
    <>
      {props.brands
        .filter((brand) => !props.selectedBrandId || brand.id !== props.selectedBrandId)
        .map((brand) => (
          <div
            key={brand.id}
            className="cursor-pointer p-6 transition-colors"
            onClick={() => props.onSelectBrand(brand)}
          >
            <div className="mb-2 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <h3 className="font-medium">{brand.name}</h3>
                <BrandAnalysisSummary
                  brandId={brand.id}
                  profileAvailable={props.profileAvailable}
                  profileSummaries={props.profileSummaries}
                />
              </div>
            </div>

            {brand.description ? (
              <p className="text-muted-foreground mb-2 text-sm">{brand.description}</p>
            ) : null}
            <p className="text-muted-foreground text-xs">
              Created {new Date(brand.createdAt).toLocaleDateString()}
            </p>
          </div>
        ))}
    </>
  );
}

export function BrandsList(props: BrandsListProps) {
  if (props.isLoading) {
    return (
      <BrandsShell>
        <LoadingState />
      </BrandsShell>
    );
  }

  if (props.brands.length === 0) {
    return (
      <BrandsShell>
        <EmptyState onStartCreating={props.onStartCreating} />
      </BrandsShell>
    );
  }

  return (
    <BrandsShell>
      <div className="divide-y">
        {props.selectedBrand ? (
          <SelectedBrandSection
            brand={props.selectedBrand}
            editingBrandId={props.editingBrandId}
            editFormData={props.editFormData}
            updateErrorMessage={props.updateErrorMessage}
            isUpdating={props.isUpdating}
            isDeleting={props.isDeleting}
            profileAvailable={props.profileAvailable}
            profileSummaries={props.profileSummaries}
            onEditStart={props.onEditStart}
            onEditCancel={props.onEditCancel}
            onEditSubmit={props.onEditSubmit}
            onDeleteBrand={props.onDeleteBrand}
            onEditFieldChange={props.onEditFieldChange}
          />
        ) : null}

        <OtherBrandsSection
          brands={props.brands}
          selectedBrandId={props.selectedBrand?.id}
          profileAvailable={props.profileAvailable}
          profileSummaries={props.profileSummaries}
          onSelectBrand={props.onSelectBrand}
        />
      </div>
    </BrandsShell>
  );
}
