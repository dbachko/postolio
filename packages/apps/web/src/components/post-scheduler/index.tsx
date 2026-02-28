import { useRef, useCallback, type ChangeEvent, type KeyboardEvent } from 'react';
import { format } from 'date-fns';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { usePostSchedulerStore } from '@/stores/postSchedulerStore';
import { Clock } from 'lucide-react';

interface PostSchedulerProps {
  contentId?: string; // Optional content ID for store-based management
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  showClearButton?: boolean;
  showFormattedDate?: boolean;
  showIcon?: boolean;
  min?: string;
}

interface SchedulerHandlersParams {
  contentId?: string;
  value: string;
  onChange: (value: string) => void;
}

function usePostSchedulerHandlers({ contentId, value, onChange }: SchedulerHandlersParams) {
  const {
    localValue,
    editingContentId,
    setLocalValue,
    startEditing,
    commitChanges,
    clearScheduledTime,
  } = usePostSchedulerStore();
  const isEditing = contentId && editingContentId === contentId;
  const displayValue = isEditing ? localValue : value;

  const handleClear = useCallback(() => {
    if (contentId) {
      clearScheduledTime(contentId);
    }
    onChange('');
  }, [contentId, onChange, clearScheduledTime]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const newValue = event.target.value;
      if (contentId) {
        if (!isEditing) {
          startEditing(contentId, newValue);
        } else {
          setLocalValue(newValue);
        }
      } else {
        onChange(newValue);
      }
    },
    [contentId, isEditing, startEditing, setLocalValue, onChange]
  );

  const commitLocalChange = useCallback(() => {
    if (contentId && isEditing) {
      const hasChanged = commitChanges(contentId);
      if (hasChanged) {
        onChange(localValue);
      }
    }
  }, [commitChanges, contentId, isEditing, localValue, onChange]);

  const handleFocus = useCallback(() => {
    if (contentId && !isEditing) {
      startEditing(contentId, value);
    }
  }, [contentId, isEditing, startEditing, value]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitLocalChange();
      }
    },
    [commitLocalChange]
  );

  return { displayValue, handleClear, handleChange, handleFocus, handleKeyDown, commitLocalChange };
}

export function PostScheduler({
  contentId,
  value,
  onChange,
  disabled = false,
  showClearButton = true,
  showFormattedDate = true,
  showIcon = false,
  min,
}: PostSchedulerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { displayValue, handleClear, handleChange, handleFocus, handleKeyDown, commitLocalChange } =
    usePostSchedulerHandlers({ contentId, value, onChange });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="scheduledAt" className="flex items-center gap-2">
          {showIcon && <Clock className="h-4 w-4" />}
          Scheduled Time
        </Label>
        {showClearButton && displayValue && (
          <Button
            type="button"
            variant="link"
            onClick={handleClear}
            className="text-xs"
            disabled={disabled}
          >
            Clear
          </Button>
        )}
      </div>
      <Input
        ref={inputRef}
        id="scheduledAt"
        type="datetime-local"
        value={displayValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={commitLocalChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        min={min}
      />
      {showFormattedDate && displayValue && (
        <div className="text-muted-foreground text-xs">
          Scheduled for: {format(new Date(displayValue), "EEEE, MMMM d, yyyy 'at' h:mm a")}
        </div>
      )}
    </div>
  );
}
