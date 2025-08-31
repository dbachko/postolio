import { useState, useEffect } from 'react'
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
  // Use local state to track value while editing
  const [localValue, setLocalValue] = useState(value)

  // Sync local value when parent value changes from outside
  useEffect(() => {
    setLocalValue(value)
  }, [value])

  const handleClear = () => {
    setLocalValue('')
    onChange('')
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Update local state immediately for responsive UI
    setLocalValue(e.target.value)
  }

  const handleBlur = () => {
    // Only trigger parent onChange when user finishes editing
    if (localValue !== value) {
      onChange(localValue)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Also save on Enter key
    if (e.key === 'Enter') {
      e.preventDefault()
      if (localValue !== value) {
        onChange(localValue)
      }
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="scheduledAt">Scheduled Time</Label>
        {showClearButton && localValue && (
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
        value={localValue}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      {showFormattedDate && localValue && (
        <div className="text-xs text-gray-500">
          Scheduled for: {format(new Date(localValue), 'EEEE, MMMM d, yyyy \'at\' h:mm a')}
        </div>
      )}
    </div>
  )
}