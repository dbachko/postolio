import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCalendarFilterStore, ContentStatus, ContentType } from '../../stores/calendarFilterStore'
import { apiClient } from '../../lib/api'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover'
import { Calendar } from '../ui/calendar'
import { format } from 'date-fns'
import { Search, X, Filter, Calendar as CalendarIcon } from 'lucide-react'

interface CalendarFiltersProps {
  brandId: string
}

const STATUS_OPTIONS: { value: ContentStatus; label: string; color: string }[] = [
  { value: 'pending', label: 'Pending', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'approved', label: 'Approved', color: 'bg-blue-100 text-blue-800' },
  { value: 'scheduled', label: 'Scheduled', color: 'bg-purple-100 text-purple-800' },
  { value: 'published', label: 'Published', color: 'bg-green-100 text-green-800' },
  { value: 'rejected', label: 'Rejected', color: 'bg-red-100 text-red-800' },
]

const CONTENT_TYPE_OPTIONS: { value: ContentType; label: string }[] = [
  { value: 'post', label: 'Posts' },
  { value: 'placeholder', label: 'AI Placeholders' },
]

export function CalendarFilters({ brandId }: CalendarFiltersProps) {
  const filters = useCalendarFilterStore()
  const [isDateRangeOpen, setIsDateRangeOpen] = useState(false)
  const [tempDateRange, setTempDateRange] = useState({
    start: filters.dateRange.start,
    end: filters.dateRange.end
  })
  
  // Fetch campaigns for filter dropdown
  const { data: campaignsData } = useQuery({
    queryKey: ['campaigns', brandId],
    queryFn: () => apiClient.listCampaigns(brandId),
    staleTime: 5 * 60 * 1000,
  })
  
  const campaigns = campaignsData?.campaigns || []
  const activeFilterCount = filters.getActiveFilterCount()
  
  const handleCampaignChange = (value: string) => {
    if (value === 'all') {
      filters.setCampaigns([])
    } else {
      const selectedCampaigns = value ? value.split(',') : []
      filters.setCampaigns(selectedCampaigns)
    }
  }
  
  const handleApplyDateRange = () => {
    filters.setDateRange(tempDateRange.start, tempDateRange.end)
    setIsDateRangeOpen(false)
  }
  
  const handleClearDateRange = () => {
    setTempDateRange({ start: null, end: null })
    filters.setDateRange(null, null)
    setIsDateRangeOpen(false)
  }
  
  return (
    <div className="bg-white rounded-lg border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-500" />
          <span className="font-medium">Filters</span>
          {activeFilterCount > 0 && (
            <Badge variant="secondary">{activeFilterCount} active</Badge>
          )}
        </div>
        {filters.hasActiveFilters() && (
          <Button
            variant="ghost"
            size="sm"
            onClick={filters.clearAll}
            className="text-gray-500"
          >
            Clear All
          </Button>
        )}
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Campaign Filter */}
        <div>
          <Label className="text-xs text-gray-600 mb-1">Campaigns</Label>
          <Select
            value={filters.campaigns.length === 0 ? 'all' : filters.campaigns.join(',')}
            onValueChange={handleCampaignChange}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All campaigns" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All campaigns</SelectItem>
              {campaigns.map(campaign => (
                <SelectItem key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        {/* Status Filter */}
        <div>
          <Label className="text-xs text-gray-600 mb-1">Status</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start">
                {filters.statuses.length === 0 
                  ? 'All statuses' 
                  : `${filters.statuses.length} selected`}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56">
              <div className="space-y-2">
                {STATUS_OPTIONS.map(option => (
                  <label
                    key={option.value}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={filters.statuses.includes(option.value)}
                      onChange={() => filters.toggleStatus(option.value)}
                      className="rounded"
                    />
                    <Badge className={option.color}>
                      {option.label}
                    </Badge>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        
        {/* Content Type Filter */}
        <div>
          <Label className="text-xs text-gray-600 mb-1">Content Type</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start">
                {filters.contentTypes.length === 2 
                  ? 'All types' 
                  : filters.contentTypes.map(t => 
                      CONTENT_TYPE_OPTIONS.find(o => o.value === t)?.label
                    ).join(', ')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48">
              <div className="space-y-2">
                {CONTENT_TYPE_OPTIONS.map(option => (
                  <label
                    key={option.value}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={filters.contentTypes.includes(option.value)}
                      onChange={() => filters.toggleContentType(option.value)}
                      className="rounded"
                    />
                    <span className="text-sm">{option.label}</span>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        
        {/* Date Range Filter */}
        <div>
          <Label className="text-xs text-gray-600 mb-1">Date Range</Label>
          <Popover open={isDateRangeOpen} onOpenChange={setIsDateRangeOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start">
                <CalendarIcon className="w-4 h-4 mr-2" />
                {filters.dateRange.start || filters.dateRange.end ? (
                  <span className="text-sm">
                    {filters.dateRange.start && format(filters.dateRange.start, 'MMM d')}
                    {filters.dateRange.start && filters.dateRange.end && ' - '}
                    {filters.dateRange.end && format(filters.dateRange.end, 'MMM d')}
                  </span>
                ) : (
                  'All dates'
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-4" align="start">
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const today = new Date()
                      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
                      setTempDateRange({ start: weekAgo, end: today })
                    }}
                  >
                    Last 7 days
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const today = new Date()
                      const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
                      setTempDateRange({ start: monthAgo, end: today })
                    }}
                  >
                    Last 30 days
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const today = new Date()
                      const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
                      setTempDateRange({ start: today, end: nextWeek })
                    }}
                  >
                    Next 7 days
                  </Button>
                </div>
                
                <div className="grid gap-2">
                  <div>
                    <Label className="text-xs">From</Label>
                    <Calendar
                      mode="single"
                      selected={tempDateRange.start || undefined}
                      onSelect={(date) => setTempDateRange(prev => ({ ...prev, start: date || null }))}
                      className="rounded-md border"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">To</Label>
                    <Calendar
                      mode="single"
                      selected={tempDateRange.end || undefined}
                      onSelect={(date) => setTempDateRange(prev => ({ ...prev, end: date || null }))}
                      className="rounded-md border"
                    />
                  </div>
                </div>
                
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearDateRange}
                  >
                    Clear
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleApplyDateRange}
                  >
                    Apply
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      
      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          type="text"
          placeholder="Search captions, hashtags, or campaigns..."
          value={filters.searchQuery}
          onChange={(e) => filters.setSearchQuery(e.target.value)}
          className="pl-10 pr-10"
        />
        {filters.searchQuery && (
          <button
            onClick={() => filters.setSearchQuery('')}
            className="absolute right-3 top-1/2 transform -translate-y-1/2"
          >
            <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
          </button>
        )}
      </div>
      
      {/* Active Filters Display */}
      {filters.hasActiveFilters() && (
        <div className="flex flex-wrap gap-2 pt-2 border-t">
          {filters.campaigns.map(campaignId => {
            const campaign = campaigns.find(c => c.id === campaignId)
            return campaign ? (
              <Badge key={campaignId} variant="secondary">
                Campaign: {campaign.name}
                <button
                  onClick={() => filters.setCampaigns(filters.campaigns.filter(id => id !== campaignId))}
                  className="ml-1"
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ) : null
          })}
          
          {filters.statuses.map(status => (
            <Badge 
              key={status} 
              className={STATUS_OPTIONS.find(s => s.value === status)?.color}
            >
              {STATUS_OPTIONS.find(s => s.value === status)?.label}
              <button
                onClick={() => filters.toggleStatus(status)}
                className="ml-1"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
          
          {filters.contentTypes.length === 1 && (
            <Badge variant="secondary">
              Type: {CONTENT_TYPE_OPTIONS.find(t => t.value === filters.contentTypes[0])?.label}
              <button
                onClick={() => filters.toggleContentType(filters.contentTypes[0])}
                className="ml-1"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          )}
          
          {(filters.dateRange.start || filters.dateRange.end) && (
            <Badge variant="secondary">
              {filters.dateRange.start && format(filters.dateRange.start, 'MMM d')}
              {filters.dateRange.start && filters.dateRange.end && ' - '}
              {filters.dateRange.end && format(filters.dateRange.end, 'MMM d')}
              <button
                onClick={() => filters.setDateRange(null, null)}
                className="ml-1"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          )}
          
          {filters.searchQuery && (
            <Badge variant="secondary">
              Search: "{filters.searchQuery}"
              <button
                onClick={() => filters.setSearchQuery('')}
                className="ml-1"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          )}
        </div>
      )}
    </div>
  )
}