import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient, type CampaignTemplate } from '../lib/api'
import { TemplateCard } from './TemplateCard'
import { Card, CardContent } from './ui/card'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Search, Filter, Grid, List, Plus } from 'lucide-react'

interface TemplateLibraryProps {
  onCreateTemplate?: () => void
  onSelectTemplate?: (template: CampaignTemplate) => void
  showCreateButton?: boolean
  selectionMode?: boolean
}

export function TemplateLibrary({
  onCreateTemplate,
  onSelectTemplate,
  showCreateButton = true,
  selectionMode = false
}: TemplateLibraryProps) {
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [showPublicOnly, setShowPublicOnly] = useState(false)

  // Fetch templates with filters
  const { data: templatesData, isLoading: templatesLoading, error } = useQuery({
    queryKey: ['templates', search, selectedCategory, selectedTags, showPublicOnly],
    queryFn: () => apiClient.getTemplates({
      search: search || undefined,
      category: selectedCategory === 'all' ? undefined : selectedCategory,
      tags: selectedTags.length > 0 ? selectedTags : undefined,
      isPublic: showPublicOnly ? true : undefined
    }),
  })

  // Fetch template categories
  const { data: categoriesData } = useQuery({
    queryKey: ['template-categories'],
    queryFn: () => apiClient.getTemplateCategories(),
  })

  const templates = templatesData?.templates || []
  const categories = categoriesData?.categories || []

  // Extract all unique tags from templates for filtering
  const allTags = Array.from(
    new Set(templates.flatMap(template => template.tags))
  ).sort()

  const handleTagToggle = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) 
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    )
  }

  const clearFilters = () => {
    setSearch('')
    setSelectedCategory('all')
    setSelectedTags([])
    setShowPublicOnly(false)
  }

  const hasActiveFilters = search || (selectedCategory !== 'all') || selectedTags.length > 0 || showPublicOnly

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">
            <p className="text-red-600 mb-2">Failed to load templates</p>
            <p className="text-sm text-gray-500">{error instanceof Error ? error.message : 'Unknown error'}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            {selectionMode ? 'Select Template' : 'Template Library'}
          </h2>
          <p className="text-gray-600">
            {selectionMode 
              ? 'Choose a template to start your campaign'
              : 'Browse and manage campaign templates'
            }
          </p>
        </div>
        {showCreateButton && (
          <Button onClick={onCreateTemplate} className="flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Create Template
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="space-y-4">
            {/* Search and View Controls */}
            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search templates..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant={viewMode === 'grid' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('grid')}
                >
                  <Grid className="w-4 h-4" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                >
                  <List className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Category and Public Filter */}
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder="All categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {categories.map(category => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant={showPublicOnly ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowPublicOnly(!showPublicOnly)}
              >
                <Filter className="w-4 h-4 mr-2" />
                Public Only
              </Button>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Clear Filters
                </Button>
              )}
            </div>

            {/* Tags Filter */}
            {allTags.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Filter by tags:</p>
                <div className="flex flex-wrap gap-2">
                  {allTags.map(tag => (
                    <Badge
                      key={tag}
                      variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => handleTagToggle(tag)}
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {templatesLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
        </div>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="p-12">
            <div className="text-center">
              <Filter className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No templates found</h3>
              <p className="text-gray-500 mb-6">
                {hasActiveFilters 
                  ? 'Try adjusting your filters or search terms.'
                  : 'No templates have been created yet.'
                }
              </p>
              {!hasActiveFilters && showCreateButton && (
                <Button onClick={onCreateTemplate}>
                  Create Your First Template
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className={
          viewMode === 'grid' 
            ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'
            : 'space-y-4'
        }>
          {templates.map(template => (
            <TemplateCard
              key={template.id}
              template={template}
              viewMode={viewMode}
              onSelect={onSelectTemplate}
              selectionMode={selectionMode}
            />
          ))}
        </div>
      )}

      {/* Results Count */}
      {templates.length > 0 && (
        <div className="text-sm text-gray-500 text-center">
          Showing {templates.length} template{templates.length !== 1 ? 's' : ''}
          {hasActiveFilters && ' matching your filters'}
        </div>
      )}
    </div>
  )
}