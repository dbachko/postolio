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

export function BrandsList({
  isLoading,
  brands,
  selectedBrand,
  editingBrandId,
  editFormData,
  profileAvailable,
  profileSummaries,
  updateErrorMessage,
  isUpdating,
  isDeleting,
  onStartCreating,
  onSelectBrand,
  onEditStart,
  onEditCancel,
  onEditSubmit,
  onDeleteBrand,
  onEditFieldChange,
}: BrandsListProps) {
  if (isLoading) {
    return (
      <div className="rounded-lg border shadow-sm">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-medium">Your Brands</h2>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="border-foreground h-6 w-6 animate-spin rounded-full border-b-2" />
        </div>
      </div>
    );
  }

  if (brands.length === 0) {
    return (
      <div className="rounded-lg border shadow-sm">
        <div className="border-b px-6 py-4">
          <h2 className="text-lg font-medium">Your Brands</h2>
        </div>
        <div className="py-8 text-center">
          <p className="text-muted-foreground mb-4">No brands created yet.</p>
          <Button variant="neutral" onClick={onStartCreating}>
            Create Your First Brand
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border shadow-sm">
      <div className="border-b px-6 py-4">
        <h2 className="text-lg font-medium">Your Brands</h2>
      </div>

      <div className="divide-y">
        {selectedBrand ? (
          <div key={selectedBrand.id} className="border-l-4 p-6">
            <div className="mb-2 flex items-start justify-between">
              <div className="flex items-center space-x-2">
                <h3 className="text-foreground text-sm font-medium">Selected Brand</h3>
                <span className="bg-accent text-primary inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
                  Current
                </span>
              </div>
            </div>

            {editingBrandId === selectedBrand.id ? (
              <BrandEditForm
                brandId={selectedBrand.id}
                data={
                  editFormData[selectedBrand.id] || { name: '', description: '', countryCode: '' }
                }
                updateErrorMessage={updateErrorMessage}
                isUpdating={isUpdating}
                onEditCancel={onEditCancel}
                onEditSubmit={onEditSubmit}
                onEditFieldChange={onEditFieldChange}
              />
            ) : (
              <div>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-medium">{selectedBrand.name}</h3>
                    {selectedBrand.description ? (
                      <p className="text-muted-foreground mt-1">{selectedBrand.description}</p>
                    ) : null}
                    <p className="text-muted-foreground mt-2 text-xs">
                      Created {new Date(selectedBrand.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                    {profileAvailable[selectedBrand.id] ? (
                      <div className="flex items-center gap-3">
                        <div className="text-muted-foreground text-xs">
                          Tones: {profileSummaries[selectedBrand.id]?.tones.join(', ') || '—'}
                        </div>
                        <div className="flex items-center gap-1">
                          {(profileSummaries[selectedBrand.id]?.palette || []).map((hex) => (
                            <span
                              key={hex}
                              title={hex}
                              className="inline-block h-3 w-3 rounded-full border"
                              style={{ backgroundColor: hex }}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      <Button variant="outline" onClick={() => onEditStart(selectedBrand)}>
                        Edit
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => onDeleteBrand(selectedBrand)}
                        disabled={isDeleting}
                      >
                        {isDeleting ? 'Deleting...' : 'Delete'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div id="brand-analysis-panel" className="mt-6">
              <BrandAnalysisPanel brandId={selectedBrand.id} />
            </div>
          </div>
        ) : null}

        {brands
          .filter((brand) => brand.id !== selectedBrand?.id)
          .map((brand) => (
            <div key={brand.id} className="p-6">
              {editingBrandId === brand.id ? (
                <BrandEditForm
                  brandId={brand.id}
                  data={editFormData[brand.id] || { name: '', description: '', countryCode: '' }}
                  updateErrorMessage={updateErrorMessage}
                  isUpdating={isUpdating}
                  onEditCancel={onEditCancel}
                  onEditSubmit={onEditSubmit}
                  onEditFieldChange={onEditFieldChange}
                />
              ) : (
                <div>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex-1">
                      <h3 className="text-lg font-medium">{brand.name}</h3>
                      {brand.description ? (
                        <p className="text-muted-foreground mt-1">{brand.description}</p>
                      ) : null}
                      <p className="text-muted-foreground mt-2 text-xs">
                        Created {new Date(brand.createdAt).toLocaleDateString()}
                      </p>
                      {brand.countryCode ? (
                        <p className="text-muted-foreground text-xs">
                          Country: {brand.countryCode}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                      <BrandAnalysisSummary
                        brandId={brand.id}
                        profileAvailable={profileAvailable}
                        profileSummaries={profileSummaries}
                      />
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        <Button
                          variant={selectedBrand?.id === brand.id ? 'secondary' : 'outline'}
                          onClick={() => onSelectBrand(brand)}
                        >
                          {selectedBrand?.id === brand.id ? 'Selected' : 'Select'}
                        </Button>
                        <Button variant="outline" onClick={() => onEditStart(brand)}>
                          Edit
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => onDeleteBrand(brand)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? 'Deleting...' : 'Delete'}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
