import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
} from 'react';

import type { LabelRecord } from '@/features/assets/api/client';

import { AssetLabelInputView } from './asset-label-input-view';

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

function buildSuggestions(params: {
  labels: LabelRecord[];
  value: string[];
  inputValue: string;
}): SuggestionItem[] {
  const normalizedInput = normalizeLabelName(params.inputValue);
  const available = params.labels.filter(
    (label) => !params.value.includes(label.id) && !label.isArchived
  );

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

  const hasExactMatch = params.labels.some(
    (label) => normalizeLabelName(label.name) === normalizedInput
  );
  const createName = toDisplayLabelName(params.inputValue);
  const canCreate = normalizedInput.length > 0 && createName.length > 0 && !hasExactMatch;
  return canCreate ? [{ kind: 'create', name: createName }, ...matching] : matching;
}

function resolveSuggestionFromInput(params: {
  suggestion: SuggestionItem | undefined;
  inputValue: string;
  labels: LabelRecord[];
}): SuggestionItem | undefined {
  if (params.suggestion) {
    return params.suggestion;
  }

  const normalizedInput = normalizeLabelName(params.inputValue);
  if (normalizedInput.length === 0) {
    return undefined;
  }

  const displayName = toDisplayLabelName(params.inputValue);
  const exactExisting = params.labels.find(
    (label) => normalizeLabelName(label.name) === normalizedInput
  );
  return exactExisting
    ? { kind: 'existing', id: exactExisting.id, name: exactExisting.name }
    : { kind: 'create', name: displayName };
}

function useAssetLabelSuggestionsState(labels: LabelRecord[], value: string[]) {
  const [inputValue, setInputValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const blurTimeoutRef = useRef<number | null>(null);
  const clearBlurTimeout = useCallback(() => {
    const timeoutId = blurTimeoutRef.current;
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }, []);

  const selectedLabels = useMemo(
    () =>
      value
        .map((id) => labels.find((label) => label.id === id))
        .filter((label): label is LabelRecord => Boolean(label)),
    [labels, value]
  );

  const suggestions = useMemo(
    () => buildSuggestions({ labels, value, inputValue }),
    [inputValue, labels, value]
  );
  const showSuggestions = isFocused && (suggestions.length > 0 || inputValue.trim().length > 0);

  useEffect(() => {
    if (activeSuggestionIndex >= suggestions.length) {
      setActiveSuggestionIndex(0);
    }
  }, [activeSuggestionIndex, suggestions.length]);

  useEffect(() => {
    return () => {
      clearBlurTimeout();
    };
  }, [clearBlurTimeout]);

  return {
    inputValue,
    setInputValue,
    isFocused,
    setIsFocused,
    activeSuggestionIndex,
    setActiveSuggestionIndex,
    selectedLabels,
    suggestions,
    showSuggestions,
    inputRef,
    blurTimeoutRef,
  };
}

function useAssetLabelCommitState(params: {
  labels: LabelRecord[];
  value: string[];
  onChange: (next: string[]) => void;
  onCreateLabel: (name: string) => Promise<LabelRecord>;
  inputValue: string;
  setInputValue: (value: string) => void;
  disabled: boolean;
  setActiveSuggestionIndex: Dispatch<SetStateAction<number>>;
}) {
  const [isCreating, setIsCreating] = useState(false);

  const removeLabel = useCallback(
    (labelId: string) => {
      params.onChange(params.value.filter((id) => id !== labelId));
    },
    [params]
  );

  const addExistingLabel = useCallback(
    (labelId: string) => {
      if (params.value.includes(labelId)) {
        params.setInputValue('');
        return;
      }
      params.onChange([...params.value, labelId]);
      params.setInputValue('');
      params.setActiveSuggestionIndex(0);
    },
    [params]
  );

  const commitInput = useCallback(
    async (suggestion?: SuggestionItem) => {
      if (params.disabled || isCreating) {
        return;
      }

      const nextSuggestion = resolveSuggestionFromInput({
        suggestion,
        inputValue: params.inputValue,
        labels: params.labels,
      });
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
        const created = await params.onCreateLabel(nextSuggestion.name);
        if (!params.value.includes(created.id)) {
          params.onChange([...params.value, created.id]);
        }
        params.setInputValue('');
        params.setActiveSuggestionIndex(0);
      } finally {
        setIsCreating(false);
      }
    },
    [addExistingLabel, isCreating, params]
  );

  return { isCreating, removeLabel, commitInput };
}

function handleSuggestionNavigationKey(
  event: KeyboardEvent<HTMLInputElement>,
  params: {
    suggestions: SuggestionItem[];
    setActiveSuggestionIndex: Dispatch<SetStateAction<number>>;
  }
): boolean {
  if (event.key === 'ArrowDown' && params.suggestions.length > 0) {
    event.preventDefault();
    params.setActiveSuggestionIndex((prev) => Math.min(prev + 1, params.suggestions.length - 1));
    return true;
  }
  if (event.key === 'ArrowUp' && params.suggestions.length > 0) {
    event.preventDefault();
    params.setActiveSuggestionIndex((prev) => Math.max(prev - 1, 0));
    return true;
  }
  return false;
}

function handleCommitKey(
  event: KeyboardEvent<HTMLInputElement>,
  params: {
    inputValue: string;
    activeSuggestionIndex: number;
    suggestions: SuggestionItem[];
    commitInput: (suggestion?: SuggestionItem) => Promise<void>;
  }
): boolean {
  const isCommitKey =
    event.key === 'Enter' || event.key === ',' || (event.key === 'Tab' && params.inputValue.trim());
  if (!isCommitKey || !params.inputValue.trim()) {
    return false;
  }

  event.preventDefault();
  void params.commitInput(params.suggestions[params.activeSuggestionIndex]);
  return true;
}

function handleBackspaceKey(
  event: KeyboardEvent<HTMLInputElement>,
  params: { inputValue: string; value: string[]; onChange: (next: string[]) => void }
): boolean {
  if (!(event.key === 'Backspace' && !params.inputValue && params.value.length > 0)) {
    return false;
  }
  event.preventDefault();
  params.onChange(params.value.slice(0, -1));
  return true;
}

function useAssetLabelKeyboard(params: {
  disabled: boolean;
  suggestions: SuggestionItem[];
  activeSuggestionIndex: number;
  setActiveSuggestionIndex: Dispatch<SetStateAction<number>>;
  inputValue: string;
  value: string[];
  onChange: (next: string[]) => void;
  commitInput: (suggestion?: SuggestionItem) => Promise<void>;
  inputRef: RefObject<HTMLInputElement | null>;
  setIsFocused: (isFocused: boolean) => void;
}) {
  return useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (params.disabled) {
        return;
      }
      if (handleSuggestionNavigationKey(event, params)) {
        return;
      }
      if (handleCommitKey(event, params)) {
        return;
      }
      if (handleBackspaceKey(event, params)) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        params.setIsFocused(false);
        params.inputRef.current?.blur();
      }
    },
    [params]
  );
}

export function AssetLabelInput({
  labels,
  value,
  onChange,
  onCreateLabel,
  disabled = false,
  placeholder = 'Type label and press Enter',
}: AssetLabelInputProps) {
  const suggestionsState = useAssetLabelSuggestionsState(labels, value);
  const commitState = useAssetLabelCommitState({
    labels,
    value,
    onChange,
    onCreateLabel,
    inputValue: suggestionsState.inputValue,
    setInputValue: suggestionsState.setInputValue,
    disabled,
    setActiveSuggestionIndex: suggestionsState.setActiveSuggestionIndex,
  });

  const handleKeyDown = useAssetLabelKeyboard({
    disabled,
    suggestions: suggestionsState.suggestions,
    activeSuggestionIndex: suggestionsState.activeSuggestionIndex,
    setActiveSuggestionIndex: suggestionsState.setActiveSuggestionIndex,
    inputValue: suggestionsState.inputValue,
    value,
    onChange,
    commitInput: commitState.commitInput,
    inputRef: suggestionsState.inputRef,
    setIsFocused: suggestionsState.setIsFocused,
  });

  return (
    <AssetLabelInputView
      disabled={disabled}
      placeholder={placeholder}
      suggestionsState={suggestionsState}
      commitState={commitState}
      handleKeyDown={handleKeyDown}
    />
  );
}
