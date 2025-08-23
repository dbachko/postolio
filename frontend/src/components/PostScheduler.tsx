import { format } from 'date-fns'
import { Label } from './ui/label'
import { Input } from './ui/input'

interface PostSchedulerProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  showClearButton?: boolean
  showFormattedDate?: boolean
}

export function PostScheduler({
  value,
  onChange,
  disabled = false,
  showClearButton = true,
  showFormattedDate = true
}: PostSchedulerProps) {
  const handleClear = () => {
    onChange('')
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="scheduledAt">Scheduled Time</Label>
        {showClearButton && value && (
          <button
            type="button"
            onClick={handleClear}
            className="text-xs text-gray-500 hover:text-red-600"
            disabled={disabled}
          >
            Clear
          </button>
        )}
      </div>
      <Input
        id="scheduledAt"
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      {showFormattedDate && value && (
        <div className="text-xs text-gray-500">
          Scheduled for: {format(new Date(value), 'EEEE, MMMM d, yyyy \'at\' h:mm a')}
        </div>
      )}
    </div>
  )
}