import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay } from 'date-fns'
import { Card, CardContent } from './ui/card'
import { Clock, Calendar, CheckCircle, AlertCircle } from 'lucide-react'

interface TimelineItem {
  id: string
  type: 'content' | 'placeholder'
  caption: string
  scheduledAt?: string
  postedAt?: string
  status: string
  hashtags?: string[]
  imageUrl?: string
  campaignName?: string
}

interface TimelineViewProps {
  items: TimelineItem[]
  currentDate: Date
}

export function TimelineView({ items, currentDate }: TimelineViewProps) {
  const navigate = useNavigate()
  
  // Group items by day for the current week
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 })
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd })

  const itemsByDay = useMemo(() => {
    const grouped = new Map<string, TimelineItem[]>()
    
    // Initialize all days
    weekDays.forEach(day => {
      grouped.set(format(day, 'yyyy-MM-dd'), [])
    })

    // Group items by day
    items.forEach(item => {
      const date = item.scheduledAt || item.postedAt
      if (date) {
        const dayKey = format(new Date(date), 'yyyy-MM-dd')
        const dayItems = grouped.get(dayKey) || []
        dayItems.push(item)
        grouped.set(dayKey, dayItems)
      }
    })

    return grouped
  }, [items, weekDays])

  const getStatusColor = (status: string, type: string) => {
    if (type === 'placeholder') return 'bg-gray-100 text-gray-600 border-gray-300'
    switch (status) {
      case 'published': return 'bg-green-100 text-green-800 border-green-300'
      case 'scheduled': return 'bg-blue-100 text-blue-800 border-blue-300'
      case 'failed': return 'bg-red-100 text-red-800 border-red-300'
      case 'skipped': return 'bg-yellow-100 text-yellow-800 border-yellow-300'
      case 'draft': return 'bg-gray-100 text-gray-800 border-gray-300'
      default: return 'bg-gray-100 text-gray-800 border-gray-300'
    }
  }

  const getStatusIcon = (status: string, type: string) => {
    if (type === 'placeholder') return <Clock className="w-4 h-4" />
    switch (status) {
      case 'published': return <CheckCircle className="w-4 h-4" />
      case 'failed': return <AlertCircle className="w-4 h-4" />
      case 'skipped': return <AlertCircle className="w-4 h-4" />
      default: return <Calendar className="w-4 h-4" />
    }
  }

  return (
    <Card data-testid="view-timeline">
      <CardContent className="p-6">
        <div className="space-y-6">
          {/* Timeline header with hours */}
          <div className="grid grid-cols-8 gap-4 text-sm font-medium text-gray-600 border-b pb-2">
            <div className="col-span-1">Time</div>
            {weekDays.map(day => (
              <div key={day.toISOString()} className={`text-center ${isSameDay(day, new Date()) ? 'text-blue-600 font-bold' : ''}`}>
                <div>{format(day, 'EEE')}</div>
                <div className="text-xs">{format(day, 'MMM d')}</div>
              </div>
            ))}
          </div>

          {/* Timeline content by hour */}
          {Array.from({ length: 24 }, (_, hour) => (
            <div key={hour} className="grid grid-cols-8 gap-4 min-h-[60px]">
              <div className="col-span-1 text-sm text-gray-500 pt-1">
                {format(new Date().setHours(hour, 0, 0, 0), 'ha')}
              </div>
              {weekDays.map(day => {
                const dayKey = format(day, 'yyyy-MM-dd')
                const dayItems = itemsByDay.get(dayKey) || []
                const hourItems = dayItems.filter(item => {
                  const itemDate = new Date(item.scheduledAt || item.postedAt || '')
                  return itemDate.getHours() === hour
                })

                return (
                  <div key={`${dayKey}-${hour}`} className="relative border-l border-gray-200">
                    {hourItems.map((item, idx) => (
                      <div
                        key={item.id}
                        className={`absolute left-0 right-0 mx-1 p-2 rounded text-xs ${
                          item.type === 'placeholder' ? 'border border-dashed' : 'border cursor-pointer hover:shadow-md transition-shadow'
                        } ${getStatusColor(item.status, item.type)}`}
                        style={{ top: `${idx * 25}px` }}
                        onClick={() => {
                          if (item.type === 'content') {
                            navigate(`/posts/${item.id}`)
                          }
                        }}
                      >
                        <div className="flex items-start gap-1">
                          {getStatusIcon(item.status, item.type)}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">
                              {item.type === 'placeholder' ? '⏳ Future Post' : 
                                item.caption.substring(0, 30) + (item.caption.length > 30 ? '...' : '')}
                            </div>
                            {item.type === 'placeholder' && item.campaignName && (
                              <div className="text-[10px] opacity-75">{item.campaignName}</div>
                            )}
                            {item.scheduledAt && (
                              <div className="text-[10px] opacity-75">
                                {format(new Date(item.scheduledAt), 'h:mm a')}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex gap-4 mt-6 pt-4 border-t text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-100 border border-green-300 rounded"></div>
            <span>Published</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-blue-100 border border-blue-300 rounded"></div>
            <span>Scheduled</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-gray-100 border border-dashed border-gray-300 rounded"></div>
            <span>Future AI</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-100 border border-red-300 rounded"></div>
            <span>Failed</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}