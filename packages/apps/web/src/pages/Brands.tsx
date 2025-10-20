import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { brand as brandApi, type Brand } from '../lib/api';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/PageHeader';
import { useBrandStore } from '../stores/brandStore';
import { InstagramConnect } from '../components/InstagramConnect';
import { BrandAnalysisPanel } from '@/components/BrandAnalysisPanel';
import { BrandProfileDrawer } from '@/components/BrandProfileDrawer';

export function Brands() {
  const [isCreating, setIsCreating] = useState(false);
  // Start undefined to avoid auto-triggering analysis on initial mount
  const [analysisTrigger, setAnalysisTrigger] = useState<number | null>(null);
  const [profileAvailable, setProfileAvailable] = useState<Record<string, boolean>>({});
  const [profileSummaries, setProfileSummaries] = useState<
    Record<string, { tones: string[]; palette: string[] }>
  >({});
  const [editingBrandId, setEditingBrandId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<{
    [key: string]: { name: string; description: string; countryCode: string };
  }>({});
  const [createFormData, setCreateFormData] = useState({
    name: '',
    description: '',
    countryCode: '',
  });
  const [viewProfileBrandId, setViewProfileBrandId] = useState<string | null>(null);

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

  // Determine whether a brand has an analysis profile projection
  useEffect(() => {
    const load = async () => {
      const entries = await Promise.all(
        (brands || []).map(
          async (b) => [b.id, await brandApi.hasBrandProfileProjection(b.id)] as const
        )
      );
      setProfileAvailable(Object.fromEntries(entries));
    };
    if (brands.length > 0) void load();
  }, [brands]);

  // Fetch compact profile summaries (tones + palette) for brands with available projection
  useEffect(() => {
    const fetchSummaries = async () => {
      const toFetch = brands.filter((b) => profileAvailable[b.id] && !profileSummaries[b.id]);
      if (toFetch.length === 0) return;
      const results = await Promise.all(
        toFetch.map(async (b) => {
          try {
            const prof = await brandApi.getBrandAnalysisProfile(b.id);
            if ('error' in prof) return [b.id, null] as const;
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
        if (data) map[id] = data;
      }
      if (Object.keys(map).length > 0) setProfileSummaries((s) => ({ ...s, ...map }));
    };
    if (brands.length > 0) void fetchSummaries();
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
    // Scroll to top to show the selected brand section
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
    if (data) {
      updateBrandMutation.mutate({
        brandId,
        data: {
          name: data.name,
          description: data.description,
          countryCode: data.countryCode ? data.countryCode.toUpperCase() : null,
        },
      });
    }
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
            {selectedBrand && (
              <button
                onClick={() => {
                  // Reveal analysis panel and trigger run
                  const el = document.getElementById('brand-analysis-panel');
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  setAnalysisTrigger((n) => (n ?? 0) + 1);
                }}
                className="inline-flex items-center rounded-md border border-transparent bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
              >
                Run Analysis
              </button>
            )}
            {selectedBrand && profileAvailable[selectedBrand.id] && (
              <button
                onClick={() => setViewProfileBrandId(selectedBrand.id)}
                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                View Profile
              </button>
            )}
            <button
              onClick={() => setIsCreating(!isCreating)}
              className="inline-flex items-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {isCreating ? 'Cancel' : 'Create Brand'}
            </button>
          </div>
        }
      />

      {/* Create Brand Form */}
      {isCreating && (
        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-lg font-medium text-gray-900">Create New Brand</h2>
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            {createBrandMutation.error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3">
                <p className="text-sm text-red-800">
                  {createBrandMutation.error?.message ||
                    'Failed to create brand. Please try again.'}
                </p>
              </div>
            )}

            <div>
              <label htmlFor="create-name" className="block text-sm font-medium text-gray-700">
                Brand Name
              </label>
              <input
                type="text"
                id="create-name"
                required
                value={createFormData.name}
                onChange={(e) => setCreateFormData({ ...createFormData, name: e.target.value })}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                placeholder="Enter brand name..."
              />
            </div>

            <div>
              <label
                htmlFor="create-description"
                className="block text-sm font-medium text-gray-700"
              >
                Description
              </label>
              <textarea
                id="create-description"
                rows={3}
                value={createFormData.description}
                onChange={(e) =>
                  setCreateFormData({
                    ...createFormData,
                    description: e.target.value,
                  })
                }
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                placeholder="Brief description of your brand..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Country</label>
              <CountrySelect
                value={createFormData.countryCode}
                onChange={(code) => setCreateFormData({ ...createFormData, countryCode: code })}
              />
            </div>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createBrandMutation.isPending}
                className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {createBrandMutation.isPending ? 'Creating...' : 'Create Brand'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Global Error Display */}
      {deleteBrandMutation.error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-800">
            {deleteBrandMutation.error.message || 'Failed to delete brand. Please try again.'}
          </p>
        </div>
      )}

      {/* Brands List */}
      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-medium text-gray-900">Your Brands</h2>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-gray-900"></div>
          </div>
        ) : brands.length === 0 ? (
          <div className="py-8 text-center">
            <p className="mb-4 text-gray-500">No brands created yet.</p>
            <button
              onClick={() => setIsCreating(true)}
              className="inline-flex items-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Create Your First Brand
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {/* Selected Brand */}
            {selectedBrand && (
              <div key={selectedBrand.id} className="border-l-4 border-blue-500 bg-blue-50 p-6">
                <div className="mb-2 flex items-start justify-between">
                  <div className="flex items-center space-x-2">
                    <h3 className="text-sm font-medium text-blue-800">Selected Brand</h3>
                    <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                      Current
                    </span>
                  </div>
                </div>
                {editingBrandId === selectedBrand.id ? (
                  /* Edit Mode */
                  <form
                    onSubmit={(e) => handleEditSubmit(e, selectedBrand.id)}
                    className="space-y-4"
                  >
                    {updateBrandMutation.error && (
                      <div className="rounded-md border border-red-200 bg-red-50 p-3">
                        <p className="text-sm text-red-800">
                          {updateBrandMutation.error?.message ||
                            'Failed to update brand. Please try again.'}
                        </p>
                      </div>
                    )}

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Brand Name
                      </label>
                      <input
                        type="text"
                        required
                        value={editFormData[selectedBrand.id]?.name || ''}
                        onChange={(e) =>
                          updateEditFormData(selectedBrand.id, 'name', e.target.value)
                        }
                        className="block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Country
                      </label>
                      <CountrySelect
                        value={editFormData[selectedBrand.id]?.countryCode || ''}
                        onChange={(code) =>
                          updateEditFormData(selectedBrand.id, 'countryCode', code)
                        }
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Description
                      </label>
                      <textarea
                        rows={3}
                        value={editFormData[selectedBrand.id]?.description || ''}
                        onChange={(e) =>
                          updateEditFormData(selectedBrand.id, 'description', e.target.value)
                        }
                        className="block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                        placeholder="Brief description of your brand..."
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700">
                        Country Code (ISO‑2)
                      </label>
                      <input
                        type="text"
                        maxLength={2}
                        className="block w-32 rounded-md border border-gray-300 px-3 py-2 uppercase focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                        value={editFormData[selectedBrand.id]?.countryCode || ''}
                        onChange={(e) =>
                          updateEditFormData(selectedBrand.id, 'countryCode', e.target.value)
                        }
                        placeholder="US"
                      />
                    </div>

                    <div className="flex flex-wrap justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => handleEditCancel(selectedBrand.id)}
                        className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={updateBrandMutation.isPending}
                        className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {updateBrandMutation.isPending ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </form>
                ) : (
                  /* Display Mode */
                  <div>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex-1">
                        <h3 className="text-lg font-medium text-gray-900">{selectedBrand.name}</h3>
                        {selectedBrand.description && (
                          <p className="mt-1 text-gray-600">{selectedBrand.description}</p>
                        )}
                        <p className="mt-2 text-xs text-gray-500">
                          Created {new Date(selectedBrand.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                        {profileAvailable[selectedBrand.id] &&
                          (profileSummaries[selectedBrand.id] ? (
                            <div className="flex items-center gap-3">
                              <div className="text-xs text-gray-600">
                                Tones: {profileSummaries[selectedBrand.id].tones.join(', ') || '—'}
                              </div>
                              <div className="flex items-center gap-1">
                                {profileSummaries[selectedBrand.id].palette.map((hex) => (
                                  <span
                                    key={hex}
                                    title={hex}
                                    className="inline-block h-3 w-3 rounded-full border border-gray-200"
                                    style={{ backgroundColor: hex }}
                                  />
                                ))}
                              </div>
                            </div>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                              Analyzed
                            </span>
                          ))}
                        <div className="flex flex-wrap gap-2 sm:justify-end">
                          <button
                            onClick={() => handleEditStart(selectedBrand)}
                            className="rounded px-3 py-1 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-700"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteBrand(selectedBrand)}
                            disabled={deleteBrandMutation.isPending}
                            className="rounded px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                          >
                            {deleteBrandMutation.isPending ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Instagram Connection Section */}
                <div className="mt-4 border-t border-blue-200 pt-4">
                  <InstagramConnect brand={selectedBrand} />
                </div>

                {/* Brand Analysis Section */}
                <div id="brand-analysis-panel" className="mt-6">
                  <BrandAnalysisPanel
                    brandId={selectedBrand.id}
                    triggerKey={analysisTrigger ?? undefined}
                  />
                </div>
              </div>
            )}

            {/* Other Brands */}
            {brands
              .filter((brand) => brand.id !== selectedBrand?.id)
              .map((brand) => (
                <div key={brand.id} className="p-6">
                  {/* Brand Content - Editing or Display Mode */}
                  {editingBrandId === brand.id ? (
                    /* Edit Mode */
                    <form onSubmit={(e) => handleEditSubmit(e, brand.id)} className="space-y-4">
                      {updateBrandMutation.error && (
                        <div className="rounded-md border border-red-200 bg-red-50 p-3">
                          <p className="text-sm text-red-800">
                            {updateBrandMutation.error?.message ||
                              'Failed to update brand. Please try again.'}
                          </p>
                        </div>
                      )}

                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                          Brand Name
                        </label>
                        <input
                          type="text"
                          required
                          value={editFormData[brand.id]?.name || ''}
                          onChange={(e) => updateEditFormData(brand.id, 'name', e.target.value)}
                          className="block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                          Country
                        </label>
                        <CountrySelect
                          value={editFormData[brand.id]?.countryCode || ''}
                          onChange={(code) => updateEditFormData(brand.id, 'countryCode', code)}
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                          Description
                        </label>
                        <textarea
                          rows={3}
                          value={editFormData[brand.id]?.description || ''}
                          onChange={(e) =>
                            updateEditFormData(brand.id, 'description', e.target.value)
                          }
                          className="block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                          placeholder="Brief description of your brand..."
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                          Country Code (ISO‑2)
                        </label>
                        <input
                          type="text"
                          maxLength={2}
                          className="block w-32 rounded-md border border-gray-300 px-3 py-2 uppercase focus:border-blue-500 focus:outline-none focus:ring-blue-500"
                          value={editFormData[brand.id]?.countryCode || ''}
                          onChange={(e) =>
                            updateEditFormData(brand.id, 'countryCode', e.target.value)
                          }
                          placeholder="US"
                        />
                      </div>

                      <div className="flex flex-wrap justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => handleEditCancel(brand.id)}
                          className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={updateBrandMutation.isPending}
                          className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {updateBrandMutation.isPending ? 'Saving...' : 'Save Changes'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    /* Display Mode */
                    <div>
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex-1">
                          <h3 className="text-lg font-medium text-gray-900">{brand.name}</h3>
                          {brand.description && (
                            <p className="mt-1 text-gray-600">{brand.description}</p>
                          )}
                          <p className="mt-2 text-xs text-gray-500">
                            Created {new Date(brand.createdAt).toLocaleDateString()}
                          </p>
                          {brand.countryCode && (
                            <p className="text-xs text-gray-500">Country: {brand.countryCode}</p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                          {profileAvailable[brand.id] &&
                            (profileSummaries[brand.id] ? (
                              <div className="flex items-center gap-2">
                                <div className="text-xs text-gray-600">
                                  {profileSummaries[brand.id].tones.join(', ') || '—'}
                                </div>
                                <div className="flex items-center gap-1">
                                  {profileSummaries[brand.id].palette.map((hex) => (
                                    <span
                                      key={hex}
                                      title={hex}
                                      className="inline-block h-3 w-3 rounded-full border border-gray-200"
                                      style={{ backgroundColor: hex }}
                                    />
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                                Analyzed
                              </span>
                            ))}
                          <div className="flex flex-wrap gap-2 sm:justify-end">
                            <button
                              onClick={() => handleSelectBrand(brand)}
                              className={`rounded px-3 py-1 text-sm font-medium ${
                                selectedBrand?.id === brand.id
                                  ? 'bg-blue-50 text-blue-800'
                                  : 'text-blue-600 hover:bg-blue-50 hover:text-blue-700'
                              }`}
                            >
                              {selectedBrand?.id === brand.id ? 'Selected' : 'Select'}
                            </button>
                            <button
                              onClick={() => handleEditStart(brand)}
                              className="rounded px-3 py-1 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-700"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteBrand(brand)}
                              disabled={deleteBrandMutation.isPending}
                              className="rounded px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                            >
                              {deleteBrandMutation.isPending ? 'Deleting...' : 'Delete'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Instagram Connection Section */}
                  <div className="mt-4 border-t border-gray-100 pt-4">
                    <InstagramConnect brand={brand} />
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
      <BrandProfileDrawer
        brandId={viewProfileBrandId}
        onClose={() => setViewProfileBrandId(null)}
      />
    </div>
  );
}

// Lightweight country select using our existing Select UI and emoji flags
function CountrySelect({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const countries: Array<{ code: string; name: string }> = [
    { code: 'US', name: 'United States' },
    { code: 'CA', name: 'Canada' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'IE', name: 'Ireland' },
    { code: 'AU', name: 'Australia' },
    { code: 'NZ', name: 'New Zealand' },
    { code: 'DE', name: 'Germany' },
    { code: 'FR', name: 'France' },
    { code: 'ES', name: 'Spain' },
    { code: 'IT', name: 'Italy' },
    { code: 'NL', name: 'Netherlands' },
    { code: 'SE', name: 'Sweden' },
    { code: 'NO', name: 'Norway' },
    { code: 'DK', name: 'Denmark' },
    { code: 'FI', name: 'Finland' },
    { code: 'PT', name: 'Portugal' },
    { code: 'PL', name: 'Poland' },
    { code: 'CZ', name: 'Czechia' },
    { code: 'AT', name: 'Austria' },
    { code: 'CH', name: 'Switzerland' },
    { code: 'BE', name: 'Belgium' },
    { code: 'JP', name: 'Japan' },
    { code: 'KR', name: 'South Korea' },
    { code: 'CN', name: 'China' },
    { code: 'IN', name: 'India' },
    { code: 'SG', name: 'Singapore' },
    { code: 'HK', name: 'Hong Kong' },
    { code: 'AE', name: 'United Arab Emirates' },
    { code: 'SA', name: 'Saudi Arabia' },
    { code: 'ZA', name: 'South Africa' },
    { code: 'BR', name: 'Brazil' },
    { code: 'AR', name: 'Argentina' },
    { code: 'CL', name: 'Chile' },
    { code: 'MX', name: 'Mexico' },
  ];

  const codeToFlag = (code: string) =>
    code.toUpperCase().replace(/[A-Z]/g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

  const selected = countries.find((c) => c.code === (value || '').toUpperCase());

  return (
    <Select value={value || undefined} onValueChange={(v) => onChange(v)}>
      <SelectTrigger className="w-60">
        <SelectValue
          placeholder="Select country"
          aria-label={selected ? selected.name : 'Select country'}
        >
          {selected ? (
            <span className="flex items-center gap-2">
              <span>{codeToFlag(selected.code)}</span>
              <span>
                {selected.name} ({selected.code})
              </span>
            </span>
          ) : (
            'Select country'
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {countries.map((c) => (
          <SelectItem key={c.code} value={c.code} aria-label={`${c.name} ${c.code}`}>
            <span className="flex items-center gap-2">
              <span>{codeToFlag(c.code)}</span>
              <span>
                {c.name} ({c.code})
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
