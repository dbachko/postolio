import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/api'
import { useBrandStore } from '../stores/brandStore'
import { InstagramConnect } from '../components/InstagramConnect'

export function Brands() {
  const [isCreating, setIsCreating] = useState(false)
  const [editingBrand, setEditingBrand] = useState<any>(null)
  const [formData, setFormData] = useState({
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
    mutationFn: (data: typeof formData) => apiClient.createBrand(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brands'] })
      setIsCreating(false)
      setFormData({ name: '', description: '' })
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
    mutationFn: ({ brandId, data }: { brandId: string; data: typeof formData }) => 
      apiClient.updateBrand(brandId, data),
    onSuccess: (response) => {
      updateBrand(response.brand)
      queryClient.invalidateQueries({ queryKey: ['brands'] })
      setEditingBrand(null)
      setFormData({ name: '', description: '' })
    },
    onError: (error) => {
      console.error('Brand update error:', error)
    },
  })

  const handleSelectBrand = (brand: any) => {
    setSelectedBrand(brand)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (editingBrand) {
      updateBrandMutation.mutate({ brandId: editingBrand.id, data: formData })
    } else {
      createBrandMutation.mutate(formData)
    }
  }

  const handleEditBrand = (brand: any) => {
    setEditingBrand(brand)
    setFormData({
      name: brand.name,
      description: brand.description || '',
    })
    setIsCreating(true)
  }

  const handleCancelEdit = () => {
    setEditingBrand(null)
    setIsCreating(false)
    setFormData({ name: '', description: '', instagramHandle: '' })
  }

  const handleDeleteBrand = (brand: any) => {
    if (window.confirm(`Are you sure you want to delete "${brand.name}"? This will also delete all associated content and cannot be undone.`)) {
      deleteBrandMutation.mutate(brand.id)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Brand Management</h1>
          <p className="text-gray-600">Create and manage your brand profiles for AI content generation</p>
        </div>
        <button
          onClick={() => editingBrand ? handleCancelEdit() : setIsCreating(!isCreating)}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
        >
          {isCreating ? 'Cancel' : 'Create Brand'}
        </button>
      </div>

      {isCreating && (
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">
            {editingBrand ? 'Edit Brand' : 'Create New Brand'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {(createBrandMutation.error || updateBrandMutation.error) && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3">
                <p className="text-sm text-red-800">
                  {(createBrandMutation.error?.message || updateBrandMutation.error?.message) || 
                   `Failed to ${editingBrand ? 'update' : 'create'} brand. Please try again.`}
                </p>
              </div>
            )}

            {deleteBrandMutation.error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3">
                <p className="text-sm text-red-800">
                  {deleteBrandMutation.error.message || 'Failed to delete brand. Please try again.'}
                </p>
              </div>
            )}
            
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                Brand Name
              </label>
              <input
                type="text"
                id="name"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                Description
              </label>
              <textarea
                id="description"
                rows={3}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="Brief description of your brand..."
              />
            </div>
            
            
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={handleCancelEdit}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createBrandMutation.isPending || updateBrandMutation.isPending}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {editingBrand 
                  ? (updateBrandMutation.isPending ? 'Updating...' : 'Update Brand')
                  : (createBrandMutation.isPending ? 'Creating...' : 'Create Brand')
                }
              </button>
            </div>
          </form>
        </div>
      )}

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
            {brands.map((brand) => (
              <div key={brand.id} className="p-6">
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
                    {selectedBrand?.id === brand.id && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        Selected
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
                        onClick={() => handleEditBrand(brand)}
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