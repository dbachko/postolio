import { useState, useMemo, useCallback } from 'react'
import { Calendar, dateFnsLocalizer, type View, type Event } from 'react-big-calendar'
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop'
import { format, parse, startOfWeek, getDay, addDays, subDays, isToday } from 'date-fns'
import { enUS } from 'date-fns/locale'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient, type Content } from '../lib/api'
import { ChevronLeft, ChevronRight, Play, CheckCircle, XCircle, Globe } from 'lucide-react'
import { useTimezone } from '../contexts/TimezoneContext'
import { formatInUserTimezone, convertUTCToLocal, convertLocalToUTC, getTimezoneAbbr } from '../lib/timezone'
import { toast } from 'sonner'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css'
import './CalendarView.css'

const locales = {
  'en-US': enUS,
}

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
})

// Create the DnD Calendar component
const DnDCalendar = withDragAndDrop(Calendar)

interface CalendarEvent extends Event {
  id: string
  title: string
  start: Date
  end: Date
  resource: Content | (Content & { 
    type: 'placeholder'
    isPlaceholder: boolean
    message: string
  })
}

interface CalendarViewProps {
  brandId?: string
  content?: Content[]
  onContentClick?: (content: Content) => void
}

export function CalendarView({ brandId, content: propContent, onContentClick }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [view, setView] = useState<View>('week')
  const { timezone, isAutoDetected } = useTimezone()
  const queryClient = useQueryClient()

  // Fetch calendar content with placeholders if brandId is provided
  const calendarQuery = useQuery({
    queryKey: ['calendar', brandId, format(currentDate, 'yyyy-MM')],
    queryFn: () => apiClient.getCalendarContent(brandId!, format(currentDate, 'yyyy-MM')),
    enabled: !!brandId && !propContent,
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
  })

  // Use provided content or fetched content
  const content = propContent || calendarQuery.data?.data?.content || []
  const placeholders = calendarQuery.data?.data?.placeholders || []

  // Reschedule mutation with optimistic updates
  const rescheduleMutation = useMutation({
    mutationFn: ({ contentId, scheduledAt }: { contentId: string; scheduledAt: string }) => 
      apiClient.updateContent({ contentId, scheduledAt }),
    onMutate: async ({ contentId, scheduledAt }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['calendar', brandId, format(currentDate, 'yyyy-MM')] })
      
      // Snapshot the previous value
      const previousData = queryClient.getQueryData(['calendar', brandId, format(currentDate, 'yyyy-MM')])
      
      // Optimistically update the cache
      queryClient.setQueryData(['calendar', brandId, format(currentDate, 'yyyy-MM')], (old: any) => {
        if (!old?.data?.content) return old
        
        return {
          ...old,
          data: {
            ...old.data,
            content: old.data.content.map((item: Content) => 
              item.id === contentId 
                ? { ...item, scheduledAt } 
                : item
            )
          }
        }
      })
      
      // Return a context with the previous data
      return { previousData }
    },
    onError: (error, _variables, context) => {
      console.error('Reschedule failed:', error)
      // If the mutation fails, use the context to roll back
      if (context?.previousData) {
        queryClient.setQueryData(['calendar', brandId, format(currentDate, 'yyyy-MM')], context.previousData)
      }
      toast.error(`Failed to reschedule post: ${error instanceof Error ? error.message : 'Unknown error'}`)
    },
    onSuccess: (data) => {
      toast.success('Post rescheduled successfully')
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: ['calendar', brandId] })
      if (brandId) {
        calendarQuery.refetch()
      }
    }
  })

  // Convert content and placeholders to calendar events
  const events: CalendarEvent[] = useMemo(() => {
    const contentEvents = content
      .filter(item => item.scheduledAt || item.postedAt)
      .map(item => {
        // Convert UTC timestamp to user's local timezone for display
        const utcDate = item.scheduledAt || item.postedAt!
        const localDate = convertUTCToLocal(utcDate, timezone)
        return {
          id: item.id,
          title: item.caption.length > 50 ? `${item.caption.substring(0, 50)}...` : item.caption,
          start: localDate,
          end: new Date(localDate.getTime() + 60 * 60 * 1000), // 1 hour duration
          resource: item,
        }
      })

    // Add placeholder events
    const placeholderEvents = placeholders.map(placeholder => {
      const localDate = convertUTCToLocal(placeholder.scheduledAt, timezone)
      return {
        id: placeholder.id,
        title: '⏳ Future Post',
        start: localDate,
        end: new Date(localDate.getTime() + 60 * 60 * 1000),
        resource: {
          ...placeholder,
          caption: placeholder.message,
          hashtags: [],
          imageUrl: '',
          brandId: placeholder.brandId || '',
          postedAt: null,
          createdAt: placeholder.scheduledAt,
          updatedAt: placeholder.scheduledAt,
          type: 'placeholder' as const,
          isPlaceholder: true,
          message: placeholder.message
        }
      }
    })

    return [...contentEvents, ...placeholderEvents]
  }, [content, placeholders, timezone])

  // Handle event drop (rescheduling)
  const handleEventDrop = useCallback(({ event, start }: { event: CalendarEvent; start: Date | string; end: Date | string }) => {
    
    const draggedContent = event.resource
    
    // Don't allow dragging of published posts, placeholders, or rejected posts
    if (draggedContent.status === 'published' || ('isPlaceholder' in draggedContent && draggedContent.isPlaceholder) || draggedContent.status === 'rejected') {
      toast.error('Cannot reschedule this post')
      return
    }

    // The 'start' parameter from react-big-calendar is already in local timezone
    // and represents the exact date/time where the event was dropped
    const newLocalDate = typeof start === 'string' ? new Date(start) : start
    
    // IMPORTANT: We use the EXACT time from the drop location, not the original time
    // This allows users to change both date AND time by dragging
    
    // Convert the local date/time to UTC for storage
    const utcDate = convertLocalToUTC(newLocalDate, timezone)
    const scheduledAt = utcDate.toISOString()
    
    
    // Perform the mutation
    rescheduleMutation.mutate({
      contentId: draggedContent.id,
      scheduledAt
    })
  }, [rescheduleMutation, timezone])

  // Navigation handlers with memoization
  const handlePrevious = useCallback(() => {
    if (view === 'week') {
      setCurrentDate(prev => subDays(prev, 7))
    } else {
      setCurrentDate(prev => subDays(prev, 1))
    }
  }, [view])

  const handleNext = useCallback(() => {
    if (view === 'week') {
      setCurrentDate(prev => addDays(prev, 7))
    } else {
      setCurrentDate(prev => addDays(prev, 1))
    }
  }, [view])

  const handleToday = useCallback(() => {
    setCurrentDate(new Date())
  }, [])

  // Custom event component
  const EventComponent = ({ event }: { event: CalendarEvent }) => {
    const content = event.resource
    const isPlaceholder = 'isPlaceholder' in content && content.isPlaceholder
    const isDraggable = !isPlaceholder && content.status !== 'published' && content.status !== 'rejected'
    
    const statusColors = {
      approved: 'bg-blue-100 border-blue-400 text-blue-800',
      published: 'bg-green-100 border-green-400 text-green-800',
      rejected: 'bg-red-100 border-red-400 text-red-800',
      placeholder: 'bg-gray-50 border-gray-300 text-gray-600',
    }

    const statusIcons = {
      approved: Play,
      published: CheckCircle,
      rejected: XCircle,
      placeholder: null, // No icon for placeholders
    }

    const StatusIcon = statusIcons[content.status as keyof typeof statusIcons]

    return (
      <div
        className={`p-1 rounded ${isPlaceholder ? 'border border-dashed' : 'border-l-2'} ${statusColors[content.status as keyof typeof statusColors] || statusColors.approved} ${isDraggable ? 'cursor-move' : isPlaceholder ? '' : 'cursor-pointer'} hover:opacity-80 transition-opacity`}
        onClick={() => !isPlaceholder && onContentClick?.(content)}
        title={isDraggable ? 'Drag to reschedule' : ''}
      >
        <div className="flex items-center gap-1 text-xs">
          {StatusIcon && <StatusIcon className="w-3 h-3 flex-shrink-0" />}
          <span className="truncate">{event.title}</span>
        </div>
        {isPlaceholder && (
          <div className="text-[10px] opacity-60 mt-0.5">Will generate</div>
        )}
      </div>
    )
  }

  // Memoize timezone abbreviation to avoid recalculation
  const tzAbbr = useMemo(() => getTimezoneAbbr(timezone), [timezone])
  
  // Custom toolbar component
  const CustomToolbar = () => {
    const nextRunTime = new Date()
    nextRunTime.setDate(nextRunTime.getDate() + 1)
    nextRunTime.setHours(2, 0, 0, 0)

    return (
      <div className="mb-6 space-y-4">
        {/* Timezone Display */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Globe className="w-4 h-4" />
            <span>
              Showing times in {tzAbbr}
              {isAutoDetected && ' (auto-detected)'}
            </span>
          </div>
        </div>

        {/* Autopilot Status */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
              <div>
                <h3 className="font-medium text-gray-900">Autopilot Active</h3>
                <p className="text-sm text-gray-600">
                  Next run: {formatInUserTimezone(nextRunTime, 'EEEE, MMMM d \'at\' h:mm a', timezone)}
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium text-gray-900">
                {content.filter(c => c.status === 'approved').length} posts scheduled
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-semibold text-gray-900">
              {view === 'week' ? 'Weekly Schedule' : 'Daily Schedule'}
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrevious}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                title="Previous"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={handleToday}
                className="px-3 py-1 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              >
                Today
              </button>
              <button
                onClick={handleNext}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                title="Next"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-sm font-medium text-gray-700">
              {format(currentDate, 'MMMM yyyy')}
            </div>
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setView('day')}
                className={`px-3 py-1 text-sm font-medium rounded transition-colors ${
                  view === 'day'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Day
              </button>
              <button
                onClick={() => setView('week')}
                className={`px-3 py-1 text-sm font-medium rounded transition-colors ${
                  view === 'week'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Week
              </button>
            </div>
          </div>
        </div>

        {/* Status Legend */}
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-blue-400 rounded-sm"></div>
            <span className="text-gray-600">Scheduled ({content.filter(c => c.status === 'approved').length})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-400 rounded-sm"></div>
            <span className="text-gray-600">Published ({content.filter(c => c.status === 'published').length})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 border border-dashed border-gray-400 bg-gray-50 rounded-sm"></div>
            <span className="text-gray-600">Future AI ({placeholders.length})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-red-400 rounded-sm"></div>
            <span className="text-gray-600">Failed ({content.filter(c => c.status === 'rejected').length})</span>
          </div>
        </div>
      </div>
    )
  }

  // Check if event is draggable
  const isDraggableAccessor = useCallback((event: CalendarEvent) => {
    const status = event.resource.status
    const isPlaceholder = 'isPlaceholder' in event.resource && event.resource.isPlaceholder
    // Allow dragging for approved, scheduled, and pending posts
    // Disallow for published, placeholder, and rejected posts
    return !isPlaceholder && status !== 'published' && status !== 'rejected'
  }, [])

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <CustomToolbar />
      
      <div className="calendar-container" style={{ height: '600px' }}>
        <DnDCalendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          date={currentDate}
          onNavigate={setCurrentDate}
          view={view}
          onView={setView}
          views={['day', 'week']}
          toolbar={false} // We use our custom toolbar
          components={{
            event: EventComponent,
          }}
          eventPropGetter={() => ({
            className: 'calendar-event',
            style: {
              border: 'none',
              borderRadius: '4px',
              padding: '2px',
            },
          })}
          dayPropGetter={(date) => ({
            className: isToday(date) ? 'calendar-today' : '',
            style: isToday(date) ? {
              backgroundColor: '#f0f9ff',
            } : {},
          })}
          min={new Date(2024, 0, 1, 6, 0)} // 6 AM
          max={new Date(2024, 0, 1, 22, 0)} // 10 PM
          step={60}
          timeslots={1}
          defaultDate={new Date()}
          formats={{
            timeGutterFormat: 'h:mm a',
            eventTimeRangeFormat: ({ start }, culture, localizer) =>
              localizer?.format(start, 'h:mm a', culture) || '',
          }}
          // Drag and drop props
          draggableAccessor={isDraggableAccessor}
          onEventDrop={handleEventDrop}
          resizable={false}
        />
      </div>
    </div>
  )
}