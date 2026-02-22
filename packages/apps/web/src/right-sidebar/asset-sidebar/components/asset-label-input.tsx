import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import type { LabelRecord } from '@/features/assets/api/client';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type SuggestionItem =
  | { kind: 'existing'; id: string; name: string }
  | { kind: 'create'; name: string };

interface AssetLabelInputProps {
  labels: LabelRecord[];
  value: string[];
  onChange: (next: string[]) => void;
  onCreateLabel: (name: string) => Promise<LabelRecord>;
  disabled?: boolean;
  placeholder?: string;
}

function stripPrefix(value: string): string {
  return value.replace(/^#+/, '');
}

function normalizeLabelName(value: string): string {
  return stripPrefix(value).toLowerCase().trim().replace(/\s+/g, ' ');
}

function toDisplayLabelName(value: string): string {
  return stripPrefix(value).trim().replace(/\s+/g, ' ');
}

function rankLabelMatch(labelName: string, term: string): number {
  const normalized = normalizeLabelName(labelName);
  if (!term) {
    return 0;
  }
  if (normalized === term) {
    return 0;
  }
  if (normalized.startsWith(term)) {
    return 1;
  }
  if (normalized.includes(term)) {
    return 2;
  }
  return 3;
}

export function AssetLabelInput({
  labels,
  value,
  onChange,
  onCreateLabel,
  disabled = false,
  placeholder = 'Type label and press Enter',
}: AssetLabelInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const blurTimeoutRef = useRef<number | null>(null);

  const labelById = useMemo(() => {
    const entries = labels.map((label) => [label.id, label] as const);
    return new Map(entries);
  }, [labels]);

  const selectedLabels = useMemo(
    () =>
      value.map((id) => labelById.get(id)).filter((label): label is LabelRecord => Boolean(label)),
    [labelById, value]
  );

  const suggestions = useMemo<SuggestionItem[]>(() => {
    const normalizedInput = normalizeLabelName(inputValue);
    const available = labels.filter((label) => !value.includes(label.id) && !label.isArchived);

    const matching = available
      .filter((label) =>
        normalizedInput ? normalizeLabelName(label.name).includes(normalizedInput) : true
      )
      .sort((a, b) => {
        const aRank = rankLabelMatch(a.name, normalizedInput);
        const bRank = rankLabelMatch(b.name, normalizedInput);
        if (aRank !== bRank) {
          return aRank - bRank;
        }
        return a.name.localeCompare(b.name);
      })
      .slice(0, 8)
      .map<SuggestionItem>((label) => ({ kind: 'existing', id: label.id, name: label.name }));

    const hasExactMatch = labels.some(
      (label) => normalizeLabelName(label.name) === normalizedInput
    );
    const createName = toDisplayLabelName(inputValue);
    const canCreate = normalizedInput.length > 0 && createName.length > 0 && !hasExactMatch;

    if (canCreate) {
      return [{ kind: 'create' as const, name: createName }, ...matching];
    }

    return matching;
  }, [inputValue, labels, value]);

  const showSuggestions = isFocused && (suggestions.length > 0 || inputValue.trim().length > 0);

  useEffect(() => {
    if (activeSuggestionIndex >= suggestions.length) {
      setActiveSuggestionIndex(0);
    }
  }, [activeSuggestionIndex, suggestions.length]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        window.clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const removeLabel = useCallback(
    (labelId: string) => {
      onChange(value.filter((id) => id !== labelId));
    },
    [onChange, value]
  );

  const addExistingLabel = useCallback(
    (labelId: string) => {
      if (value.includes(labelId)) {
        setInputValue('');
        return;
      }
      onChange([...value, labelId]);
      setInputValue('');
      setActiveSuggestionIndex(0);
    },
    [onChange, value]
  );

  const commitInput = useCallback(
    async (suggestion?: SuggestionItem) => {
      if (disabled || isCreating) {
        return;
      }

      const normalizedInput = normalizeLabelName(inputValue);
      const displayName = toDisplayLabelName(inputValue);

      let nextSuggestion = suggestion;
      if (!nextSuggestion && normalizedInput.length > 0) {
        const exactExisting = labels.find(
          (label) => normalizeLabelName(label.name) === normalizedInput
        );
        nextSuggestion = exactExisting
          ? ({
              kind: 'existing',
              id: exactExisting.id,
              name: exactExisting.name,
            } satisfies SuggestionItem)
          : ({ kind: 'create', name: displayName } satisfies SuggestionItem);
      }

      if (!nextSuggestion) {
        return;
      }

      if (nextSuggestion.kind === 'existing') {
        addExistingLabel(nextSuggestion.id);
        return;
      }

      if (!nextSuggestion.name) {
        return;
      }
      setIsCreating(true);
      try {
        const created = await onCreateLabel(nextSuggestion.name);
        if (!value.includes(created.id)) {
          onChange([...value, created.id]);
        }
        setInputValue('');
        setActiveSuggestionIndex(0);
      } finally {
        setIsCreating(false);
      }
    },
    [addExistingLabel, disabled, inputValue, isCreating, labels, onChange, onCreateLabel, value]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled) {
        return;
      }

      if (event.key === 'ArrowDown' && suggestions.length > 0) {
        event.preventDefault();
        setActiveSuggestionIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
        return;
      }

      if (event.key === 'ArrowUp' && suggestions.length > 0) {
        event.preventDefault();
        setActiveSuggestionIndex((prev) => Math.max(prev - 1, 0));
        return;
      }

      if (
        event.key === 'Enter' ||
        event.key === ',' ||
        (event.key === 'Tab' && inputValue.trim().length > 0)
      ) {
        if (inputValue.trim().length === 0) {
          return;
        }
        event.preventDefault();
        const activeSuggestion = suggestions[activeSuggestionIndex];
        void commitInput(activeSuggestion);
        return;
      }

      if (event.key === 'Backspace' && inputValue.length === 0 && value.length > 0) {
        event.preventDefault();
        onChange(value.slice(0, -1));
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setIsFocused(false);
        inputRef.current?.blur();
      }
    },
    [activeSuggestionIndex, commitInput, disabled, inputValue, onChange, suggestions, value]
  );

  return (
    <div className="space-y-2">
      <div className="relative">
        <div
          className={cn(
            'border-input bg-background ring-offset-background focus-within:ring-ring flex min-h-11 w-full flex-wrap items-center gap-1 rounded-md border px-2 py-1 focus-within:ring-1',
            disabled && 'cursor-not-allowed opacity-60'
          )}
          onMouseDown={() => {
            if (!disabled) {
              inputRef.current?.focus();
            }
          }}
        >
          {selectedLabels.map((label) => (
            <Badge
              key={label.id}
              variant="secondary"
              className="gap-1 rounded-full px-2 py-0.5 text-xs"
            >
              <span>#{label.name}</span>
              <button
                type="button"
                className="hover:text-foreground/80 text-muted-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  removeLabel(label.id);
                }}
                aria-label={`Remove ${label.name}`}
                disabled={disabled || isCreating}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <input
            ref={inputRef}
            value={inputValue}
            onChange={(event) => {
              setInputValue(event.target.value);
              setActiveSuggestionIndex(0);
            }}
            onFocus={() => {
              if (blurTimeoutRef.current) {
                window.clearTimeout(blurTimeoutRef.current);
                blurTimeoutRef.current = null;
              }
              setIsFocused(true);
            }}
            onBlur={() => {
              blurTimeoutRef.current = window.setTimeout(() => setIsFocused(false), 100);
            }}
            onKeyDown={handleKeyDown}
            disabled={disabled || isCreating}
            placeholder={selectedLabels.length === 0 ? placeholder : 'Add another label'}
            className="placeholder:text-muted-foreground h-8 min-w-[140px] flex-1 bg-transparent px-1 text-sm outline-none"
          />
          {isCreating ? <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" /> : null}
        </div>

        {showSuggestions ? (
          <div
            className="bg-popover border-border absolute z-50 mt-1 w-full rounded-md border p-1 shadow-lg"
            role="listbox"
          >
            {suggestions.length === 0 ? (
              <div className="text-muted-foreground px-2 py-2 text-xs">
                Press Enter to create this label
              </div>
            ) : (
              suggestions.map((suggestion, index) => (
                <button
                  key={suggestion.kind === 'existing' ? suggestion.id : `create-${suggestion.name}`}
                  type="button"
                  className={cn(
                    'hover:bg-accent hover:text-accent-foreground flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm',
                    index === activeSuggestionIndex && 'bg-accent text-accent-foreground'
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveSuggestionIndex(index)}
                  onClick={() => {
                    void commitInput(suggestion);
                    inputRef.current?.focus();
                  }}
                  role="option"
                  aria-selected={index === activeSuggestionIndex}
                >
                  {suggestion.kind === 'existing' ? (
                    <span>#{suggestion.name}</span>
                  ) : (
                    <span>
                      Create <span className="font-medium">#{suggestion.name}</span>
                    </span>
                  )}
                  {suggestion.kind === 'create' ? (
                    <span className="text-muted-foreground text-[11px]">Enter</span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">
        Enter, Tab, or comma to add. Backspace removes the last label.
      </p>
    </div>
  );
}
