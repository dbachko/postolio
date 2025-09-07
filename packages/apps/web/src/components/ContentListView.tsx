import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns'
import { formatInUserTimezone } from '../lib/timezone'
import { useTimezone } from '../contexts/TimezoneContext'
import { Card, CardContent } from './ui/card'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { 
  Calendar, Clock, CheckCircle, AlertCircle, Search, Filter,
  ChevronUp, ChevronDown, Image as ImageIcon
} from 'lucide-react'

interface ListItem {
  id: string
  type: 'content' | 'placeholder'
  caption: string
  scheduledAt?: string
  postedAt?: string
  createdAt?: string
  status: string
  hashtags?: string[]
  imageUrl?: string
  campaignName?: string
  campaignId?: string
}

interface ContentListViewProps {
  items: ListItem[]
  currentDate: Date
}

type SortField = 'date' | 'status' | 'type'
type SortOrder = 'asc' | 'desc'
type FilterStatus = 'all' | 'published' | 'scheduled' | 'placeholder' | 'failed'

export function ContentListView({ items, currentDate }: ContentListViewProps) {
  const navigate = useNavigate()
  const { timezone } = useTimezone()
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())

  // Filter items for current month and apply search/filters
  const filteredItems = useMemo(() => {
    const monthStart = startOfMonth(currentDate)
    const monthEnd = endOfMonth(currentDate)

    return items.filter(item => {
      // Check if in current month
      const itemDate = new Date(item.scheduledAt || item.postedAt || item.createdAt || new Date())
      if (!isWithinInterval(itemDate, { start: monthStart, end: monthEnd })) {
        return false
      }

      // Apply status filter
      if (filterStatus !== 'all') {
        if (filterStatus === 'placeholder' && item.type !== 'placeholder') return false
        if (filterStatus === 'published' && item.status !== 'published') return false
        if (filterStatus === 'scheduled' && item.status !== 'scheduled') return false
        if (filterStatus === 'failed' && item.status !== 'failed') return false
      }

      // Apply search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        return (
          item.caption.toLowerCase().includes(query) ||
          item.hashtags?.some(tag => tag.toLowerCase().includes(query)) ||
          item.campaignName?.toLowerCase().includes(query)
        )
      }

      return true
    })
  }, [items, currentDate, filterStatus, searchQuery])

  // Sort items
  const sortedItems = useMemo(() => {
    const sorted = [...filteredItems]
    sorted.sort((a, b) => {
      let comparison = 0
      
      switch (sortField) {
        case 'date': {
          const dateA = new Date(a.scheduledAt || a.postedAt || 0).getTime()
          const dateB = new Date(b.scheduledAt || b.postedAt || 0).getTime()
          comparison = dateA - dateB
          break
        }
        case 'status':
          comparison = a.status.localeCompare(b.status)
          break
        case 'type':
          comparison = a.type.localeCompare(b.type)
          break
      }

      return sortOrder === 'asc' ? comparison : -comparison
    })
    return sorted
  }, [filteredItems, sortField, sortOrder])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  const toggleExpanded = (itemId: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }

  const getStatusBadge = (status: string, type: string) => {
    if (type === 'placeholder') {
      return <Badge variant="outline" className="gap-1"><Clock className="w-3 h-3" />Future AI</Badge>
    }
    switch (status) {
      case 'published':
        return <Badge variant="default" className="gap-1 bg-green-600"><CheckCircle className="w-3 h-3" />Published</Badge>
      case 'scheduled':
        return <Badge variant="default" className="gap-1 bg-blue-600"><Calendar className="w-3 h-3" />Scheduled</Badge>
      case 'failed':
        return <Badge variant="destructive" className="gap-1"><AlertCircle className="w-3 h-3" />Failed</Badge>
      case 'skipped':
        return <Badge variant="outline" className="gap-1 bg-yellow-100 text-yellow-800"><AlertCircle className="w-3 h-3" />Skipped</Badge>
      case 'draft':
        return <Badge variant="secondary" className="gap-1"><Clock className="w-3 h-3" />Draft</Badge>
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  return (
    <Card data-testid="view-list">
      <CardContent className="p-6">
        {/* Filters and search */}
        <div className="flex gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search posts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={filterStatus} onValueChange={(value) => setFilterStatus(value as FilterStatus)}>
            <SelectTrigger className="w-[180px]">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Posts</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="placeholder">Future AI</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* List header */}
        <div className="grid grid-cols-12 gap-4 pb-2 border-b text-sm font-medium text-gray-600">
          <div className="col-span-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toggleSort('type')}
              className="p-0 h-auto font-medium"
            >
              Type
              {sortField === 'type' && (
                sortOrder === 'asc' ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />
              )}
            </Button>
          </div>
          <div className="col-span-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toggleSort('date')}
              className="p-0 h-auto font-medium"
            >
              Date/Time
              {sortField === 'date' && (
                sortOrder === 'asc' ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />
              )}
            </Button>
          </div>
          <div className="col-span-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toggleSort('status')}
              className="p-0 h-auto font-medium"
            >
              Status
              {sortField === 'status' && (
                sortOrder === 'asc' ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />
              )}
            </Button>
          </div>
          <div className="col-span-5">Content</div>
          <div className="col-span-2">Campaign</div>
        </div>

        {/* List items */}
        <div className="space-y-2 mt-4">
          {sortedItems.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No posts found for the selected filters
            </div>
          ) : (
            sortedItems.map(item => {
              const isExpanded = expandedItems.has(item.id)
              const itemDate = new Date(item.scheduledAt || item.postedAt || '')
              
              return (
                <div
                  key={item.id}
                  className={`grid grid-cols-12 gap-4 p-3 rounded-lg hover:bg-gray-50 transition-colors ${
                    item.type === 'placeholder' ? 'border border-dashed border-gray-300' : 'border border-gray-200 cursor-pointer'
                  }`}
                  onClick={() => {
                    if (item.type === 'content') {
                      navigate(`/posts/${item.id}`)
                    }
                  }}
                >
                  <div className="col-span-1">
                    {item.type === 'placeholder' ? (
                      <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center">
                        <Clock className="w-4 h-4 text-gray-500" />
                      </div>
                    ) : item.imageUrl ? (
                      <div className="w-8 h-8 bg-gray-100 rounded overflow-hidden">
                        <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center">
                        <ImageIcon className="w-4 h-4 text-gray-400" />
                      </div>
                    )}
                  </div>
                  
                  <div className="col-span-2 text-sm">
                    <div className="font-medium">{formatInUserTimezone(itemDate, 'MMM d, yyyy', timezone)}</div>
                    <div className="text-gray-500">{formatInUserTimezone(itemDate, 'h:mm a', timezone)}</div>
                  </div>
                  
                  <div className="col-span-2">
                    {getStatusBadge(item.status, item.type)}
                  </div>
                  
                  <div className="col-span-5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleExpanded(item.id)
                      }}
                      className="text-left w-full"
                    >
                      <div className={`text-sm ${isExpanded ? '' : 'line-clamp-2'}`}>
                        {item.type === 'placeholder' 
                          ? 'Content will be generated closer to scheduled date'
                          : item.caption
                        }
                      </div>
                    </button>
                    {isExpanded && item.hashtags && item.hashtags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {item.hashtags.map((tag, idx) => (
                          <Badge key={idx} variant="secondary" className="text-xs">
                            #{tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  <div className="col-span-2 text-sm text-gray-600">
                    {item.campaignName || '-'}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Summary */}
        <div className="mt-6 pt-4 border-t text-sm text-gray-600">
          Showing {sortedItems.length} of {items.length} posts for {format(currentDate, 'MMMM yyyy')}
        </div>
      </CardContent>
    </Card>
  )
}
