import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useCalendarFilterStore } from '../stores/calendarFilterStore'
import { encodeFiltersToURL, decodeFiltersFromURL, areFiltersEqual } from '../utils/filterUrlUtils'

/**
 * Synchronizes calendar filter state between URL and Zustand store
 * - On mount/URL change: Updates store from URL
 * - On store change: Updates URL from store
 */
export function useURLFilterSync() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const filterStore = useCalendarFilterStore()
  
  // Track if we're updating from URL to prevent infinite loops
  const isUpdatingFromURL = useRef(false)
  const isUpdatingFromStore = useRef(false)
  
  // Extract current filter state from store
  const currentFilters = {
    campaigns: filterStore.campaigns,
    statuses: filterStore.statuses,
    contentTypes: filterStore.contentTypes,
    dateRange: filterStore.dateRange,
    searchQuery: filterStore.searchQuery
  }
  
  // Sync URL → Store (on mount and URL changes)
  useEffect(() => {
    if (isUpdatingFromStore.current) {
      isUpdatingFromStore.current = false
      return
    }
    
    const urlFilters = decodeFiltersFromURL(searchParams)
    
    // Only update store if URL filters differ from current store state
    if (!areFiltersEqual(urlFilters, currentFilters)) {
      isUpdatingFromURL.current = true
      
      // Update each filter in the store
      if (JSON.stringify(urlFilters.campaigns.sort()) !== JSON.stringify(currentFilters.campaigns.sort())) {
        filterStore.setCampaigns(urlFilters.campaigns)
      }
      
      if (JSON.stringify(urlFilters.statuses.sort()) !== JSON.stringify(currentFilters.statuses.sort())) {
        // Clear and set statuses
        currentFilters.statuses.forEach(status => {
          if (!urlFilters.statuses.includes(status)) {
            filterStore.toggleStatus(status)
          }
        })
        urlFilters.statuses.forEach(status => {
          if (!currentFilters.statuses.includes(status)) {
            filterStore.toggleStatus(status)
          }
        })
      }
      
      if (JSON.stringify(urlFilters.contentTypes.sort()) !== JSON.stringify(currentFilters.contentTypes.sort())) {
        // Clear and set content types
        currentFilters.contentTypes.forEach(type => {
          if (!urlFilters.contentTypes.includes(type)) {
            filterStore.toggleContentType(type)
          }
        })
        urlFilters.contentTypes.forEach(type => {
          if (!currentFilters.contentTypes.includes(type)) {
            filterStore.toggleContentType(type)
          }
        })
      }
      
      if (urlFilters.dateRange.start?.getTime() !== currentFilters.dateRange.start?.getTime() ||
          urlFilters.dateRange.end?.getTime() !== currentFilters.dateRange.end?.getTime()) {
        filterStore.setDateRange(urlFilters.dateRange.start, urlFilters.dateRange.end)
      }
      
      if (urlFilters.searchQuery !== currentFilters.searchQuery) {
        filterStore.setSearchQuery(urlFilters.searchQuery)
      }
    }
  }, [searchParams]) // Only depend on searchParams changes
  
  // Sync Store → URL (when store changes)
  useEffect(() => {
    if (isUpdatingFromURL.current) {
      isUpdatingFromURL.current = false
      return
    }
    
    isUpdatingFromStore.current = true
    const newParams = encodeFiltersToURL(currentFilters)
    
    // Compare with current URL params
    const currentParams = new URLSearchParams(searchParams)
    
    // Only navigate if params actually changed
    if (newParams.toString() !== currentParams.toString()) {
      navigate(`?${newParams.toString()}`, { replace: true })
    }
  }, [
    currentFilters.campaigns,
    currentFilters.statuses,
    currentFilters.contentTypes,
    currentFilters.dateRange.start,
    currentFilters.dateRange.end,
    currentFilters.searchQuery,
    navigate
  ])
}

/**
 * Hook to programmatically set filters via URL navigation
 */
export function useNavigateWithFilters() {
  const navigate = useNavigate()
  
  return (filters: Partial<{
    campaigns: string[]
    statuses: string[]
    contentTypes: string[]
    dateRange: { start: Date | null; end: Date | null }
    searchQuery: string
  }>) => {
    const params = new URLSearchParams()
    
    if (filters.campaigns?.length) {
      params.set('campaigns', filters.campaigns.join(','))
    }
    if (filters.statuses?.length) {
      params.set('statuses', filters.statuses.join(','))
    }
    if (filters.contentTypes?.length) {
      params.set('types', filters.contentTypes.join(','))
    }
    if (filters.dateRange?.start) {
      params.set('dateStart', filters.dateRange.start.toISOString().split('T')[0])
    }
    if (filters.dateRange?.end) {
      params.set('dateEnd', filters.dateRange.end.toISOString().split('T')[0])
    }
    if (filters.searchQuery) {
      params.set('search', filters.searchQuery)
    }
    
    navigate(`/content?${params.toString()}`)
  }
}