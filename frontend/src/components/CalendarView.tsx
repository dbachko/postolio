import { useState, useMemo } from 'react'
import { Calendar, dateFnsLocalizer, type View } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay, addDays, subDays, isToday } from 'date-fns'
import { enUS } from 'date-fns/locale'
import type { Content } from '../lib/api'
import { ChevronLeft, ChevronRight, Play, CheckCircle, XCircle } from 'lucide-react'
import 'react-big-calendar/lib/css/react-big-calendar.css'
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

interface CalendarEvent {
  id: string
  title: string
  start: Date
  end: Date
  resource: Content
}

interface CalendarViewProps {
  content: Content[]
  onContentClick?: (content: Content) => void
}

export function CalendarView({ content, onContentClick }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [view, setView] = useState<View>('week')

  // Convert content to calendar events
  const events: CalendarEvent[] = useMemo(() => {
    return content
      .filter(item => item.scheduledAt || item.postedAt)
      .map(item => {
        const date = new Date(item.scheduledAt || item.postedAt!)
        return {
          id: item.id,
          title: item.caption.length > 50 ? `${item.caption.substring(0, 50)}...` : item.caption,
          start: date,
          end: new Date(date.getTime() + 60 * 60 * 1000), // 1 hour duration
          resource: item,
        }
      })
  }, [content])

  // Navigation handlers
  const handlePrevious = () => {
    if (view === 'week') {
      setCurrentDate(prev => subDays(prev, 7))
    } else {
      setCurrentDate(prev => subDays(prev, 1))
    }
  }

  const handleNext = () => {
    if (view === 'week') {
      setCurrentDate(prev => addDays(prev, 7))
    } else {
      setCurrentDate(prev => addDays(prev, 1))
    }
  }

  const handleToday = () => {
    setCurrentDate(new Date())
  }

  // Custom event component
  const EventComponent = ({ event }: { event: CalendarEvent }) => {
    const content = event.resource
    const statusColors = {
      approved: 'bg-blue-100 border-blue-400 text-blue-800',
      posted: 'bg-green-100 border-green-400 text-green-800',
      rejected: 'bg-red-100 border-red-400 text-red-800',
    }

    const statusIcons = {
      approved: Play,
      posted: CheckCircle,
      rejected: XCircle,
    }

    const StatusIcon = statusIcons[content.status as keyof typeof statusIcons] || Play

    return (
      <div
        className={`p-1 rounded border-l-2 ${statusColors[content.status as keyof typeof statusColors] || statusColors.approved} cursor-pointer hover:opacity-80 transition-opacity`}
        onClick={() => onContentClick?.(content)}
      >
        <div className="flex items-center gap-1 text-xs">
          <StatusIcon className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{event.title}</span>
        </div>
      </div>
    )
  }

  // Custom toolbar component
  const CustomToolbar = () => {
    const nextRunTime = new Date()
    nextRunTime.setDate(nextRunTime.getDate() + 1)
    nextRunTime.setHours(2, 0, 0, 0)

    return (
      <div className="mb-6 space-y-4">
        {/* Autopilot Status */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
              <div>
                <h3 className="font-medium text-gray-900">Autopilot Active</h3>
                <p className="text-sm text-gray-600">
                  Next run: {format(nextRunTime, 'EEEE, MMMM d')} at {format(nextRunTime, 'h:mm a')}
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
            <span className="text-gray-600">Posted ({content.filter(c => c.status === 'posted').length})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-red-400 rounded-sm"></div>
            <span className="text-gray-600">Failed ({content.filter(c => c.status === 'rejected').length})</span>
          </div>
        </div>
      </div>
    )
  }


  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <CustomToolbar />
      
      <div className="calendar-container" style={{ height: '600px' }}>
        <Calendar
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
        />
      </div>
    </div>
  )
}