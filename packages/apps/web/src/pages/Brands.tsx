import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, type Brand } from '../lib/api';
import { PageHeader } from '@/components/PageHeader';
import { useBrandStore } from '../stores/brandStore';
import { InstagramConnect } from '../components/InstagramConnect';

export function Brands() {
  const [isCreating, setIsCreating] = useState(false);
  const [editingBrandId, setEditingBrandId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<{
    [key: string]: { name: string; description: string };
  }>({});
  const [createFormData, setCreateFormData] = useState({
    name: '',
    description: '',
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

  const { data: brandsData, isLoading } = useQuery({
    queryKey: ['brands'],
    queryFn: () => apiClient.getBrands(),
  });

  useEffect(() => {
    if (brandsData?.brands) {
      setBrands(brandsData.brands);
      initializeSelectedBrand(brandsData.brands);
    }
  }, [brandsData, setBrands, initializeSelectedBrand]);

  const createBrandMutation = useMutation({
    mutationFn: (data: typeof createFormData) => apiClient.createBrand(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brands'] });
      setIsCreating(false);
      setCreateFormData({ name: '', description: '' });
    },
    onError: (error) => {
      console.error('Brand creation error:', error);
    },
  });

  const deleteBrandMutation = useMutation({
    mutationFn: (brandId: string) => apiClient.deleteBrand(brandId),
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
      data: { name: string; description: string };
    }) => apiClient.updateBrand(brandId, data),
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
      updateBrandMutation.mutate({ brandId, data });
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
          <button
            onClick={() => setIsCreating(!isCreating)}
            className="inline-flex items-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {isCreating ? 'Cancel' : 'Create Brand'}
          </button>
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

                    <div className="flex justify-end space-x-3">
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
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h3 className="text-lg font-medium text-gray-900">{selectedBrand.name}</h3>
                        {selectedBrand.description && (
                          <p className="mt-1 text-gray-600">{selectedBrand.description}</p>
                        )}
                        <p className="mt-2 text-xs text-gray-500">
                          Created {new Date(selectedBrand.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center space-x-3">
                        {selectedBrand.styleProfile && (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                            Analyzed
                          </span>
                        )}
                        <div className="flex space-x-2">
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

                      <div className="flex justify-end space-x-3">
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
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <h3 className="text-lg font-medium text-gray-900">{brand.name}</h3>
                          {brand.description && (
                            <p className="mt-1 text-gray-600">{brand.description}</p>
                          )}
                          <p className="mt-2 text-xs text-gray-500">
                            Created {new Date(brand.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center space-x-3">
                          {brand.styleProfile && (
                            <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                              Analyzed
                            </span>
                          )}
                          <div className="flex space-x-2">
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
    </div>
  );
}
