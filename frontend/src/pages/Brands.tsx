import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/api'
import { useBrandStore } from '../stores/brandStore'
import { InstagramConnect } from '../components/InstagramConnect'

export function Brands() {
  const [isCreating, setIsCreating] = useState(false)
  const [editingBrandId, setEditingBrandId] = useState<string | null>(null)
  const [editFormData, setEditFormData] = useState<{[key: string]: {name: string, description: string}}>({})
  const [createFormData, setCreateFormData] = useState({
    name: '',
    description: '',
  })
  
  const queryClient = useQueryClient()
  const { brands, selectedBrand, setBrands, setSelectedBrand, initializeSelectedBrand, removeBrand, updateBrand } = useBrandStore()
  
  const { data: brandsData, isLoading } = useQuery({
    queryKey: ['brands'],
    queryFn: () => apiClient.getBrands(),
  })

  useEffect(() => {
    if (brandsData?.brands) {
      setBrands(brandsData.brands)
      initializeSelectedBrand(brandsData.brands)
    }
  }, [brandsData, setBrands, initializeSelectedBrand])

  const createBrandMutation = useMutation({
    mutationFn: (data: typeof createFormData) => apiClient.createBrand(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brands'] })
      setIsCreating(false)
      setCreateFormData({ name: '', description: '' })
    },
    onError: (error) => {
      console.error('Brand creation error:', error)
    },
  })

  const deleteBrandMutation = useMutation({
    mutationFn: (brandId: string) => apiClient.deleteBrand(brandId),
    onSuccess: (_, brandId) => {
      removeBrand(brandId)
      queryClient.invalidateQueries({ queryKey: ['brands'] })
    },
    onError: (error) => {
      console.error('Brand deletion error:', error)
    },
  })

  const updateBrandMutation = useMutation({
    mutationFn: ({ brandId, data }: { brandId: string; data: {name: string, description: string} }) => 
      apiClient.updateBrand(brandId, data),
    onSuccess: (response) => {
      updateBrand(response.brand)
      queryClient.invalidateQueries({ queryKey: ['brands'] })
      setEditingBrandId(null)
      setEditFormData({})
    },
    onError: (error) => {
      console.error('Brand update error:', error)
    },
  })

  const handleSelectBrand = (brand: any) => {
    setSelectedBrand(brand)
    // Scroll to top to show the selected brand section
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createBrandMutation.mutate(createFormData)
  }

  const handleEditStart = (brand: any) => {
    setEditingBrandId(brand.id)
    setEditFormData({
      [brand.id]: {
        name: brand.name,
        description: brand.description || '',
      }
    })
  }

  const handleEditCancel = (brandId: string) => {
    setEditingBrandId(null)
    setEditFormData(prev => {
      const newData = { ...prev }
      delete newData[brandId]
      return newData
    })
  }

  const handleEditSubmit = (e: React.FormEvent, brandId: string) => {
    e.preventDefault()
    const data = editFormData[brandId]
    if (data) {
      updateBrandMutation.mutate({ brandId, data })
    }
  }

  const handleDeleteBrand = (brand: any) => {
    if (window.confirm(`Are you sure you want to delete "${brand.name}"? This will also delete all associated content and cannot be undone.`)) {
      deleteBrandMutation.mutate(brand.id)
    }
  }

  const updateEditFormData = (brandId: string, field: string, value: string) => {
    setEditFormData(prev => ({
      ...prev,
      [brandId]: {
        ...prev[brandId],
        [field]: value
      }
    }))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Brand Management</h1>
          <p className="text-gray-600">Create and manage your brand profiles for AI content generation</p>
        </div>
        <button
          onClick={() => setIsCreating(!isCreating)}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
        >
          {isCreating ? 'Cancel' : 'Create Brand'}
        </button>
      </div>

      {/* Create Brand Form */}
      {isCreating && (
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Create New Brand</h2>
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            {createBrandMutation.error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3">
                <p className="text-sm text-red-800">
                  {createBrandMutation.error?.message || 'Failed to create brand. Please try again.'}
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
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter brand name..."
              />
            </div>
            
            <div>
              <label htmlFor="create-description" className="block text-sm font-medium text-gray-700">
                Description
              </label>
              <textarea
                id="create-description"
                rows={3}
                value={createFormData.description}
                onChange={(e) => setCreateFormData({ ...createFormData, description: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="Brief description of your brand..."
              />
            </div>
            
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createBrandMutation.isPending}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {createBrandMutation.isPending ? 'Creating...' : 'Create Brand'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Global Error Display */}
      {deleteBrandMutation.error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3">
          <p className="text-sm text-red-800">
            {deleteBrandMutation.error.message || 'Failed to delete brand. Please try again.'}
          </p>
        </div>
      )}

      {/* Brands List */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Your Brands</h2>
        </div>
        
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
          </div>
        ) : brands.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-4">No brands created yet.</p>
            <button
              onClick={() => setIsCreating(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
            >
              Create Your First Brand
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {/* Selected Brand */}
            {selectedBrand && (
              <div key={selectedBrand.id} className="p-6 bg-blue-50 border-l-4 border-blue-500">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <h3 className="text-sm font-medium text-blue-800">Selected Brand</h3>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      Current
                    </span>
                  </div>
                </div>
                {editingBrandId === selectedBrand.id ? (
                  /* Edit Mode */
                  <form onSubmit={(e) => handleEditSubmit(e, selectedBrand.id)} className="space-y-4">
                    {updateBrandMutation.error && (
                      <div className="bg-red-50 border border-red-200 rounded-md p-3">
                        <p className="text-sm text-red-800">
                          {updateBrandMutation.error?.message || 'Failed to update brand. Please try again.'}
                        </p>
                      </div>
                    )}
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Brand Name
                      </label>
                      <input
                        type="text"
                        required
                        value={editFormData[selectedBrand.id]?.name || ''}
                        onChange={(e) => updateEditFormData(selectedBrand.id, 'name', e.target.value)}
                        className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Description
                      </label>
                      <textarea
                        rows={3}
                        value={editFormData[selectedBrand.id]?.description || ''}
                        onChange={(e) => updateEditFormData(selectedBrand.id, 'description', e.target.value)}
                        className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Brief description of your brand..."
                      />
                    </div>
                    
                    <div className="flex justify-end space-x-3">
                      <button
                        type="button"
                        onClick={() => handleEditCancel(selectedBrand.id)}
                        className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={updateBrandMutation.isPending}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
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
                          <p className="text-gray-600 mt-1">{selectedBrand.description}</p>
                        )}
                        <p className="text-xs text-gray-500 mt-2">
                          Created {new Date(selectedBrand.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center space-x-3">
                        {selectedBrand.styleProfile && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Analyzed
                          </span>
                        )}
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleEditStart(selectedBrand)}
                            className="text-sm font-medium text-gray-600 hover:text-gray-700 hover:bg-gray-50 px-3 py-1 rounded"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteBrand(selectedBrand)}
                            disabled={deleteBrandMutation.isPending}
                            className="text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1 rounded disabled:opacity-50"
                          >
                            {deleteBrandMutation.isPending ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Instagram Connection Section */}
                <div className="mt-4 pt-4 border-t border-blue-200">
                  <InstagramConnect brand={selectedBrand} />
                </div>
              </div>
            )}
            
            {/* Other Brands */}
            {brands.filter(brand => brand.id !== selectedBrand?.id).map((brand) => (
              <div key={brand.id} className="p-6">
                {/* Brand Content - Editing or Display Mode */}
                {editingBrandId === brand.id ? (
                  /* Edit Mode */
                  <form onSubmit={(e) => handleEditSubmit(e, brand.id)} className="space-y-4">
                    {updateBrandMutation.error && (
                      <div className="bg-red-50 border border-red-200 rounded-md p-3">
                        <p className="text-sm text-red-800">
                          {updateBrandMutation.error?.message || 'Failed to update brand. Please try again.'}
                        </p>
                      </div>
                    )}
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Brand Name
                      </label>
                      <input
                        type="text"
                        required
                        value={editFormData[brand.id]?.name || ''}
                        onChange={(e) => updateEditFormData(brand.id, 'name', e.target.value)}
                        className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Description
                      </label>
                      <textarea
                        rows={3}
                        value={editFormData[brand.id]?.description || ''}
                        onChange={(e) => updateEditFormData(brand.id, 'description', e.target.value)}
                        className="block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Brief description of your brand..."
                      />
                    </div>
                    
                    <div className="flex justify-end space-x-3">
                      <button
                        type="button"
                        onClick={() => handleEditCancel(brand.id)}
                        className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={updateBrandMutation.isPending}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
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
                          <p className="text-gray-600 mt-1">{brand.description}</p>
                        )}
                        <p className="text-xs text-gray-500 mt-2">
                          Created {new Date(brand.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center space-x-3">
                        {brand.styleProfile && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Analyzed
                          </span>
                        )}
                        <div className="flex space-x-2">
                          <button 
                            onClick={() => handleSelectBrand(brand)}
                            className={`text-sm font-medium px-3 py-1 rounded ${
                              selectedBrand?.id === brand.id 
                                ? 'text-blue-800 bg-blue-50' 
                                : 'text-blue-600 hover:text-blue-700 hover:bg-blue-50'
                            }`}
                          >
                            {selectedBrand?.id === brand.id ? 'Selected' : 'Select'}
                          </button>
                          <button
                            onClick={() => handleEditStart(brand)}
                            className="text-sm font-medium text-gray-600 hover:text-gray-700 hover:bg-gray-50 px-3 py-1 rounded"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteBrand(brand)}
                            disabled={deleteBrandMutation.isPending}
                            className="text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 px-3 py-1 rounded disabled:opacity-50"
                          >
                            {deleteBrandMutation.isPending ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Instagram Connection Section */}
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <InstagramConnect brand={brand} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}