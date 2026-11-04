import type { Dispatch, KeyboardEvent, MutableRefObject, RefObject, SetStateAction } from 'react';
import { Loader2, X } from 'lucide-react';

import type { LabelRecord } from '@/features/assets/api/client';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type SuggestionItem =
  { kind: 'existing'; id: string; name: string } | { kind: 'create'; name: string };

type SuggestionsState = {
  selectedLabels: LabelRecord[];
  inputValue: string;
  setInputValue: (value: string) => void;
  activeSuggestionIndex: number;
  setActiveSuggestionIndex: Dispatch<SetStateAction<number>>;
  isFocused: boolean;
  setIsFocused: (isFocused: boolean) => void;
  showSuggestions: boolean;
  suggestions: SuggestionItem[];
  inputRef: RefObject<HTMLInputElement | null>;
  blurTimeoutRef: MutableRefObject<number | null>;
};

type CommitState = {
  isCreating: boolean;
  removeLabel: (labelId: string) => void;
  commitInput: (suggestion?: SuggestionItem) => Promise<void>;
};

type AssetLabelInputViewProps = {
  disabled: boolean;
  placeholder: string;
  suggestionsState: SuggestionsState;
  commitState: CommitState;
  handleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
};

function AssetLabelBadges(props: {
  selectedLabels: LabelRecord[];
  removeLabel: (labelId: string) => void;
  disabled: boolean;
  isCreating: boolean;
}) {
  return props.selectedLabels.map((label) => (
    <Badge key={label.id} variant="secondary" className="gap-1 rounded-full px-2 py-0.5 text-xs">
      <span>#{label.name}</span>
      <button
        type="button"
        className="hover:text-foreground/80 text-muted-foreground"
        onClick={(event) => {
          event.stopPropagation();
          props.removeLabel(label.id);
        }}
        aria-label={`Remove ${label.name}`}
        disabled={props.disabled || props.isCreating}
      >
        <X className="h-3 w-3" />
      </button>
    </Badge>
  ));
}

function AssetLabelSuggestions(props: {
  suggestions: SuggestionItem[];
  activeSuggestionIndex: number;
  setActiveSuggestionIndex: Dispatch<SetStateAction<number>>;
  commitInput: (suggestion?: SuggestionItem) => Promise<void>;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  if (props.suggestions.length === 0) {
    return (
      <div className="text-muted-foreground px-2 py-2 text-xs">
        Press Enter to create this label
      </div>
    );
  }

  return props.suggestions.map((suggestion, index) => (
    <button
      key={suggestion.kind === 'existing' ? suggestion.id : `create-${suggestion.name}`}
      type="button"
      className={cn(
        'hover:bg-accent hover:text-accent-foreground flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm',
        index === props.activeSuggestionIndex && 'bg-accent text-accent-foreground'
      )}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={() => props.setActiveSuggestionIndex(index)}
      onClick={() => {
        void props.commitInput(suggestion);
        props.inputRef.current?.focus();
      }}
      role="option"
      aria-selected={index === props.activeSuggestionIndex}
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
  ));
}

export function AssetLabelInputView({
  disabled,
  placeholder,
  suggestionsState,
  commitState,
  handleKeyDown,
}: AssetLabelInputViewProps) {
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
              suggestionsState.inputRef.current?.focus();
            }
          }}
        >
          <AssetLabelBadges
            selectedLabels={suggestionsState.selectedLabels}
            removeLabel={commitState.removeLabel}
            disabled={disabled}
            isCreating={commitState.isCreating}
          />
          <input
            ref={suggestionsState.inputRef}
            value={suggestionsState.inputValue}
            onChange={(event) => {
              suggestionsState.setInputValue(event.target.value);
              suggestionsState.setActiveSuggestionIndex(0);
            }}
            onFocus={() => {
              if (suggestionsState.blurTimeoutRef.current) {
                window.clearTimeout(suggestionsState.blurTimeoutRef.current);
                suggestionsState.blurTimeoutRef.current = null;
              }
              suggestionsState.setIsFocused(true);
            }}
            onBlur={() => {
              suggestionsState.blurTimeoutRef.current = window.setTimeout(
                () => suggestionsState.setIsFocused(false),
                100
              );
            }}
            onKeyDown={handleKeyDown}
            disabled={disabled || commitState.isCreating}
            placeholder={
              suggestionsState.selectedLabels.length === 0 ? placeholder : 'Add another label'
            }
            className="placeholder:text-muted-foreground h-8 min-w-[140px] flex-1 bg-transparent px-1 text-sm outline-none"
          />
          {commitState.isCreating ? (
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
          ) : null}
        </div>

        {suggestionsState.showSuggestions ? (
          <div
            className="bg-popover border-border absolute z-50 mt-1 w-full rounded-md border p-1 shadow-lg"
            role="listbox"
          >
            <AssetLabelSuggestions
              suggestions={suggestionsState.suggestions}
              activeSuggestionIndex={suggestionsState.activeSuggestionIndex}
              setActiveSuggestionIndex={suggestionsState.setActiveSuggestionIndex}
              commitInput={commitState.commitInput}
              inputRef={suggestionsState.inputRef}
            />
          </div>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">
        Enter, Tab, or comma to add. Backspace removes the last label.
      </p>
    </div>
  );
}
