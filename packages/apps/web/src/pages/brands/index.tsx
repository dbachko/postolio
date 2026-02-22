import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { brand as brandApi, type Brand } from '@/lib/api';
import { PageHeader } from '@/components/page-header';
import { useBrandStore } from '@/stores/brandStore';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { BrandsList } from './components/brands-list';
import { CountrySelect } from './components/country-select';
import { SidebarViewProfileButton } from './components/sidebar-view-profile-button';

export function Brands() {
  const [isCreating, setIsCreating] = useState(false);
  const [profileAvailable, setProfileAvailable] = useState<Record<string, boolean>>({});
  const [profileSummaries, setProfileSummaries] = useState<
    Record<string, { tones: string[]; palette: string[] }>
  >({});
  const [editingBrandId, setEditingBrandId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<
    Record<string, { name: string; description: string; countryCode: string }>
  >({});
  const [createFormData, setCreateFormData] = useState({
    name: '',
    description: '',
    countryCode: '',
  });

  const queryClient = useQueryClient();
  const {
    brands,
    selectedBrand,
    setBrands,
    setSelectedBrand,
    initializeSelectedBrand,
    removeBrand,
    updateBrand,
  } = useBrandStore();
  const hasExistingBrand = brands.length > 0;

  const { data: brandsData, isLoading } = useQuery({
    queryKey: ['brands'],
    queryFn: () => brandApi.getBrands(),
  });

  useEffect(() => {
    if (brandsData?.brands) {
      setBrands(brandsData.brands);
      initializeSelectedBrand(brandsData.brands);
    }
  }, [brandsData, setBrands, initializeSelectedBrand]);

  useEffect(() => {
    const load = async () => {
      const entries = await Promise.all(
        (brands || []).map(
          async (b) => [b.id, await brandApi.hasBrandProfileProjection(b.id)] as const
        )
      );
      setProfileAvailable(Object.fromEntries(entries));
    };
    if (brands.length > 0) {
      void load();
    }
  }, [brands]);

  useEffect(() => {
    const fetchSummaries = async () => {
      const toFetch = brands.filter((b) => profileAvailable[b.id] && !profileSummaries[b.id]);
      if (toFetch.length === 0) {
        return;
      }
      const results = await Promise.all(
        toFetch.map(async (b) => {
          try {
            const prof = await brandApi.getBrandAnalysisProfile(b.id);
            if ('error' in prof) {
              return [b.id, null] as const;
            }
            const tones = Array.isArray(prof.text?.tone) ? prof.text!.tone.slice(0, 3) : [];
            const palette = Array.isArray(prof.visual?.palette)
              ? prof.visual!.palette.slice(0, 3)
              : [];
            return [b.id, { tones, palette }] as const;
          } catch {
            return [b.id, null] as const;
          }
        })
      );
      const map: Record<string, { tones: string[]; palette: string[] }> = {};
      for (const [id, data] of results) {
        if (data) {
          map[id] = data;
        }
      }
      if (Object.keys(map).length > 0) {
        setProfileSummaries((s) => ({ ...s, ...map }));
      }
    };
    if (brands.length > 0) {
      void fetchSummaries();
    }
  }, [brands, profileAvailable, profileSummaries]);

  const createBrandMutation = useMutation({
    mutationFn: (data: typeof createFormData) =>
      brandApi.createBrand({
        name: data.name,
        description: data.description,
        countryCode: data.countryCode ? data.countryCode.toUpperCase() : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brands'] });
      setIsCreating(false);
      setCreateFormData({ name: '', description: '', countryCode: '' });
    },
    onError: (error) => {
      console.error('Brand creation error:', error);
    },
  });

  const deleteBrandMutation = useMutation({
    mutationFn: (brandId: string) => brandApi.deleteBrand(brandId),
    onSuccess: (_, brandId) => {
      removeBrand(brandId);
      queryClient.invalidateQueries({ queryKey: ['brands'] });
    },
    onError: (error) => {
      console.error('Brand deletion error:', error);
    },
  });

  const updateBrandMutation = useMutation({
    mutationFn: ({
      brandId,
      data,
    }: {
      brandId: string;
      data: { name: string; description: string; countryCode?: string | null };
    }) => brandApi.updateBrand(brandId, data),
    onSuccess: (response) => {
      updateBrand(response.brand);
      queryClient.invalidateQueries({ queryKey: ['brands'] });
      setEditingBrandId(null);
      setEditFormData({});
    },
    onError: (error) => {
      console.error('Brand update error:', error);
    },
  });

  const handleSelectBrand = (brand: Brand) => {
    setSelectedBrand(brand);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createBrandMutation.mutate(createFormData);
  };

  const handleEditStart = (brand: Brand) => {
    setEditingBrandId(brand.id);
    setEditFormData({
      [brand.id]: {
        name: brand.name,
        description: brand.description || '',
        countryCode: (brand.countryCode || '') as string,
      },
    });
  };

  const handleEditCancel = (brandId: string) => {
    setEditingBrandId(null);
    setEditFormData((prev) => {
      const newData = { ...prev };
      delete newData[brandId];
      return newData;
    });
  };

  const handleEditSubmit = (e: React.FormEvent, brandId: string) => {
    e.preventDefault();
    const data = editFormData[brandId];
    if (!data) {
      return;
    }
    updateBrandMutation.mutate({
      brandId,
      data: {
        name: data.name,
        description: data.description,
        countryCode: data.countryCode ? data.countryCode.toUpperCase() : null,
      },
    });
  };

  const handleDeleteBrand = (brand: Brand) => {
    if (
      window.confirm(
        `Are you sure you want to delete "${brand.name}"? This will also delete all associated content and cannot be undone.`
      )
    ) {
      deleteBrandMutation.mutate(brand.id);
    }
  };

  const updateEditFormData = (brandId: string, field: string, value: string) => {
    setEditFormData((prev) => ({
      ...prev,
      [brandId]: {
        ...prev[brandId],
        [field]: value,
      },
    }));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Brand Management"
        description="Create and manage your brand profiles for AI content generation"
        actions={
          <div className="flex items-center gap-2">
            {selectedBrand && profileAvailable[selectedBrand.id] ? (
              <SidebarViewProfileButton brandId={selectedBrand.id} />
            ) : null}
            <div className="flex flex-col items-end gap-1">
              {hasExistingBrand ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Button variant="neutral" disabled>
                          Create Brand
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>This feature is coming later.</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <Button
                  variant={isCreating ? 'outline' : 'neutral'}
                  onClick={() => setIsCreating(!isCreating)}
                >
                  {isCreating ? 'Cancel' : 'Create Brand'}
                </Button>
              )}
            </div>
          </div>
        }
      />

      {isCreating ? (
        <div className="bg-card rounded-lg p-6 shadow">
          <h2 className="mb-4 text-lg font-medium">Create New Brand</h2>
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            {createBrandMutation.error ? (
              <div className="rounded-md border p-3">
                <p className="text-destructive text-sm">
                  {createBrandMutation.error?.message ||
                    'Failed to create brand. Please try again.'}
                </p>
              </div>
            ) : null}

            <div>
              <Label htmlFor="create-name">Brand Name</Label>
              <Input
                id="create-name"
                type="text"
                required
                value={createFormData.name}
                onChange={(e) => setCreateFormData({ ...createFormData, name: e.target.value })}
                placeholder="Enter brand name..."
              />
            </div>

            <div>
              <Label htmlFor="create-description">Description</Label>
              <Textarea
                id="create-description"
                rows={3}
                value={createFormData.description}
                onChange={(e) =>
                  setCreateFormData({
                    ...createFormData,
                    description: e.target.value,
                  })
                }
                placeholder="Brief description of your brand..."
              />
            </div>

            <div>
              <Label>Country</Label>
              <CountrySelect
                value={createFormData.countryCode}
                onChange={(code) => setCreateFormData({ ...createFormData, countryCode: code })}
              />
            </div>

            <div className="flex justify-end space-x-3">
              <Button type="button" variant="outline" onClick={() => setIsCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createBrandMutation.isPending} variant="neutral">
                {createBrandMutation.isPending ? 'Creating...' : 'Create Brand'}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {deleteBrandMutation.error ? (
        <div className="bg-muted rounded-md border p-3">
          <p className="text-destructive text-sm">
            {deleteBrandMutation.error.message || 'Failed to delete brand. Please try again.'}
          </p>
        </div>
      ) : null}

      <BrandsList
        isLoading={isLoading}
        brands={brands}
        selectedBrand={selectedBrand}
        editingBrandId={editingBrandId}
        editFormData={editFormData}
        profileAvailable={profileAvailable}
        profileSummaries={profileSummaries}
        updateErrorMessage={
          updateBrandMutation.error?.message ||
          (updateBrandMutation.error ? 'Failed to update brand. Please try again.' : undefined)
        }
        isUpdating={updateBrandMutation.isPending}
        isDeleting={deleteBrandMutation.isPending}
        onStartCreating={() => setIsCreating(true)}
        onSelectBrand={handleSelectBrand}
        onEditStart={handleEditStart}
        onEditCancel={handleEditCancel}
        onEditSubmit={handleEditSubmit}
        onDeleteBrand={handleDeleteBrand}
        onEditFieldChange={(brandId, field, value) => updateEditFormData(brandId, field, value)}
      />
    </div>
  );
}
