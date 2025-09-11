import { useRef, useCallback } from 'react';
import { format } from 'date-fns';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { usePostSchedulerStore } from '../stores/postSchedulerStore';

interface PostSchedulerProps {
  contentId?: string; // Optional content ID for store-based management
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  showClearButton?: boolean;
  showFormattedDate?: boolean;
}

export function PostScheduler({
  contentId,
  value,
  onChange,
  disabled = false,
  showClearButton = true,
  showFormattedDate = true,
}: PostSchedulerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Get store actions and state
  const {
    localValue,
    editingContentId,
    setLocalValue,
    startEditing,
    commitChanges,
    clearScheduledTime,
  } = usePostSchedulerStore();

  // Determine if this instance is currently being edited
  const isEditing = contentId && editingContentId === contentId;

  // Display value: use local value if editing, otherwise use prop value
  const displayValue = isEditing ? localValue : value;

  const handleClear = useCallback(() => {
    if (contentId) {
      clearScheduledTime(contentId);
    }
    onChange('');
  }, [contentId, onChange, clearScheduledTime]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;

      if (contentId) {
        // Store-based management
        if (!isEditing) {
          startEditing(contentId, newValue);
        } else {
          setLocalValue(newValue);
        }
      } else {
        // Direct callback for non-store usage
        onChange(newValue);
      }
    },
    [contentId, isEditing, startEditing, setLocalValue, onChange]
  );

  const handleBlur = useCallback(() => {
    if (contentId && isEditing) {
      // Commit changes and check if there was an actual change
      const hasChanged = commitChanges(contentId);
      if (hasChanged) {
        // Only call onChange if value actually changed
        onChange(localValue);
      }
    }
  }, [contentId, isEditing, commitChanges, localValue, onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (contentId && isEditing) {
          const hasChanged = commitChanges(contentId);
          if (hasChanged) {
            onChange(localValue);
          }
        }
      }
    },
    [contentId, isEditing, commitChanges, localValue, onChange]
  );

  const handleFocus = useCallback(() => {
    if (contentId && !isEditing) {
      startEditing(contentId, value);
    }
  }, [contentId, isEditing, startEditing, value]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="scheduledAt">Scheduled Time</Label>
        {showClearButton && displayValue && (
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
        ref={inputRef}
        id="scheduledAt"
        type="datetime-local"
        value={displayValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      {showFormattedDate && displayValue && (
        <div className="text-xs text-gray-500">
          Scheduled for: {format(new Date(displayValue), "EEEE, MMMM d, yyyy 'at' h:mm a")}
        </div>
      )}
    </div>
  );
}
