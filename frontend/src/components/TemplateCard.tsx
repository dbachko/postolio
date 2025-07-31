import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient, type CampaignTemplate } from '../lib/api'
import { Card, CardContent } from './ui/card'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { 
  MoreVertical, 
  Eye, 
  Edit2, 
  Trash2, 
  Copy, 
  Users,
  Calendar,
  Clock,
  Tag,
  Globe,
  Lock
} from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu'

interface TemplateCardProps {
  template: CampaignTemplate
  viewMode: 'grid' | 'list'
  onSelect?: (template: CampaignTemplate) => void
  onEdit?: (template: CampaignTemplate) => void
  onView?: (template: CampaignTemplate) => void
  selectionMode?: boolean
}

export function TemplateCard({
  template,
  viewMode,
  onSelect,
  onEdit,
  onView,
  selectionMode = false
}: TemplateCardProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const queryClient = useQueryClient()

  // Delete template mutation
  const deleteMutation = useMutation({
    mutationFn: () => apiClient.deleteTemplate(template.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
    onSettled: () => {
      setIsDeleting(false)
    }
  })

  // Duplicate template mutation
  const duplicateMutation = useMutation({
    mutationFn: () => apiClient.createTemplate({
      name: `${template.name} (Copy)`,
      description: template.description || undefined,
      category: template.category,
      config: template.config,
      tags: template.tags,
      isPublic: false
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
    }
  })

  const handleDelete = () => {
    if (confirm(`Are you sure you want to delete "${template.name}"? This action cannot be undone.`)) {
      setIsDeleting(true)
      deleteMutation.mutate()
    }
  }

  const handleDuplicate = () => {
    duplicateMutation.mutate()
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString()
  }

  const getDurationText = () => {
    if (!template.config?.duration?.start || !template.config?.duration?.end) {
      return 'Not set'
    }
    const start = new Date(template.config.duration.start)
    const end = new Date(template.config.duration.end)
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
    return `${days} days`
  }

  if (viewMode === 'list') {
    return (
      <Card className={`hover:shadow-md transition-shadow ${selectionMode ? 'cursor-pointer hover:bg-gray-50' : ''}`}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold text-lg truncate">{template.name}</h3>
                    <Badge variant="outline">{template.category}</Badge>
                    {template.isPublic ? (
                      <Globe className="w-4 h-4 text-blue-500" />
                    ) : (
                      <Lock className="w-4 h-4 text-gray-500" />
                    )}
                  </div>
                  
                  {template.description && (
                    <p className="text-gray-600 text-sm mb-3 line-clamp-2">{template.description}</p>
                  )}
                  
                  <div className="flex items-center gap-6 text-sm text-gray-500">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      <span>{getDurationText()}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span>{template.config?.frequency || 'Not set'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      <span>{template.usageCount} uses</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    {selectionMode ? (
                      <Button onClick={() => onSelect?.(template)}>
                        Select Template
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onView?.(template)}
                        >
                          <Eye className="w-4 h-4 mr-2" />
                          View
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onEdit?.(template)}>
                              <Edit2 className="w-4 h-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={handleDuplicate} disabled={duplicateMutation.isPending}>
                              <Copy className="w-4 h-4 mr-2" />
                              {duplicateMutation.isPending ? 'Duplicating...' : 'Duplicate'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                              onClick={handleDelete}
                              disabled={isDeleting}
                              className="text-red-600"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              {isDeleting ? 'Deleting...' : 'Delete'}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">
                    Created {formatDate(template.createdAt)}
                  </p>
                </div>
              </div>
              
              {(template.tags || []).length > 0 && (
                <div className="flex items-center gap-2 mt-3">
                  <Tag className="w-4 h-4 text-gray-400" />
                  <div className="flex flex-wrap gap-1">
                    {(template.tags || []).slice(0, 3).map(tag => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                    {(template.tags || []).length > 3 && (
                      <Badge variant="secondary" className="text-xs">
                        +{(template.tags || []).length - 3} more
                      </Badge>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={`hover:shadow-lg transition-shadow ${selectionMode ? 'cursor-pointer hover:bg-gray-50' : ''}`}>
      <CardContent className="p-6">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-semibold text-lg truncate">{template.name}</h3>
                {template.isPublic ? (
                  <Globe className="w-4 h-4 text-blue-500" />
                ) : (
                  <Lock className="w-4 h-4 text-gray-500" />
                )}
              </div>
              <Badge variant="outline" className="mb-2">{template.category}</Badge>
            </div>
            
            {!selectionMode && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onView?.(template)}>
                    <Eye className="w-4 h-4 mr-2" />
                    View Details
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onEdit?.(template)}>
                    <Edit2 className="w-4 h-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDuplicate} disabled={duplicateMutation.isPending}>
                    <Copy className="w-4 h-4 mr-2" />
                    {duplicateMutation.isPending ? 'Duplicating...' : 'Duplicate'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="text-red-600"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    {isDeleting ? 'Deleting...' : 'Delete'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Description */}
          {template.description && (
            <p className="text-gray-600 text-sm line-clamp-3">{template.description}</p>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2 text-gray-500">
              <Calendar className="w-4 h-4" />
              <span>{getDurationText()}</span>
            </div>
            <div className="flex items-center gap-2 text-gray-500">
              <Clock className="w-4 h-4" />
              <span>{template.config?.frequency || 'Not set'}</span>
            </div>
            <div className="flex items-center gap-2 text-gray-500">
              <Users className="w-4 h-4" />
              <span>{template.usageCount} uses</span>
            </div>
            <div className="text-gray-400 text-xs">
              {formatDate(template.createdAt)}
            </div>
          </div>

          {/* Tags */}
          {(template.tags || []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {(template.tags || []).slice(0, 4).map(tag => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
              {(template.tags || []).length > 4 && (
                <Badge variant="secondary" className="text-xs">
                  +{(template.tags || []).length - 4}
                </Badge>
              )}
            </div>
          )}

          {/* Action Button */}
          {selectionMode && (
            <Button 
              onClick={() => onSelect?.(template)}
              className="w-full"
            >
              Use This Template
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}