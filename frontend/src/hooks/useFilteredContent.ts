import { useMemo } from 'react'
import { useCalendarFilterStore } from '../stores/calendarFilterStore'

interface ContentItem {
  id: string
  type: 'content' | 'placeholder'
  caption: string
  status: string
  scheduledAt?: string | null
  campaignId?: string | null
  campaignName?: string
  hashtags: string[]
  createdAt?: string
  postedAt?: string | null
  brandId: string
  imageUrl?: string
  instagramPermalink?: string | null
}

export function useFilteredContent(items: ContentItem[]) {
  const filters = useCalendarFilterStore()
  
  const filteredItems = useMemo(() => {
    let filtered = [...items]
    
    // Filter by campaigns
    if (filters.campaigns.length > 0) {
      filtered = filtered.filter(item => 
        item.campaignId && filters.campaigns.includes(item.campaignId)
      )
    }
    
    // Filter by status
    if (filters.statuses.length > 0) {
      filtered = filtered.filter(item => 
        item.status && filters.statuses.includes(item.status as 'pending' | 'approved' | 'published' | 'rejected' | 'failed' | 'scheduled')
      )
    }
    
    // Filter by content type
    if (filters.contentTypes.length > 0 && filters.contentTypes.length < 2) {
      filtered = filtered.filter(item => {
        const itemType = item.type === 'placeholder' ? 'placeholder' : 'post'
        return filters.contentTypes.includes(itemType as 'post' | 'placeholder')
      })
    }
    
    // Filter by date range
    if (filters.dateRange.start || filters.dateRange.end) {
      filtered = filtered.filter(item => {
        if (!item.scheduledAt) return false
        const itemDate = new Date(item.scheduledAt)
        
        if (filters.dateRange.start && itemDate < filters.dateRange.start) {
          return false
        }
        if (filters.dateRange.end && itemDate > filters.dateRange.end) {
          return false
        }
        return true
      })
    }
    
    // Filter by search query
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase()
      filtered = filtered.filter(item => {
        const caption = (item.caption || '').toLowerCase()
        const hashtags = (item.hashtags || []).join(' ').toLowerCase()
        const campaign = (item.campaignName || '').toLowerCase()
        
        return (
          caption.includes(query) ||
          hashtags.includes(query) ||
          campaign.includes(query)
        )
      })
    }
    
    return filtered
  }, [
    items,
    filters.campaigns,
    filters.statuses,
    filters.contentTypes,
    filters.dateRange,
    filters.searchQuery
  ])
  
  return {
    filteredItems,
    totalItems: items.length,
    filteredCount: filteredItems.length,
    isFiltered: filters.hasActiveFilters()
  }
}