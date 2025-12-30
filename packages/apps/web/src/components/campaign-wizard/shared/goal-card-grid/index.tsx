import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { campaign } from '@/lib/api';
import { cn } from '@/lib/utils';
import { goalEmoji } from '@/utils/goal-emojis';
import { MAX_GOAL_LENGTH } from './constants';
import type { GoalCardGridProps, GoalSuggestion } from './types';
import { sanitizeGoal } from './utils';

export function GoalCardGrid({
  brandId,
  campaignType,
  selectedGoals,
  onChange,
  maxGoals = 5,
}: GoalCardGridProps) {
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customGoal, setCustomGoal] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['goal-suggestions', brandId, campaignType],
    queryFn: async () => {
      const response = await campaign.suggestGoals({
        brandId,
        campaignType,
        limit: 8,
      });
      return response as { success: boolean; suggestions: GoalSuggestion[] };
    },
    enabled: !!brandId && !!campaignType,
  });

  const suggestions = data?.suggestions || [];

  const toggleGoal = (goal: string) => {
    if (selectedGoals.includes(goal)) {
      onChange(selectedGoals.filter((g) => g !== goal));
      return;
    }
    if (selectedGoals.length >= maxGoals) return;
    onChange([...selectedGoals, goal]);
  };

  const addCustomGoal = () => {
    setValidationError(null);

    const sanitized = sanitizeGoal(customGoal);
    if (!sanitized) {
      setValidationError('Goal cannot be empty');
      return;
    }
    if (sanitized.length > MAX_GOAL_LENGTH) {
      setValidationError(`Goal must be ${MAX_GOAL_LENGTH} characters or less`);
      return;
    }
    if (selectedGoals.includes(sanitized)) {
      setValidationError('This goal is already selected');
      setCustomGoal('');
      setShowCustomInput(false);
      return;
    }
    if (selectedGoals.length >= maxGoals) {
      setValidationError(`Maximum ${maxGoals} goals allowed`);
      return;
    }

    onChange([...selectedGoals, sanitized]);
    setCustomGoal('');
    setShowCustomInput(false);
    setValidationError(null);
  };

  const removeCustomGoal = (goal: string) => {
    onChange(selectedGoals.filter((g) => g !== goal));
  };

  const suggestedGoalValues = suggestions.map((s) => s.value);
  const customGoals = selectedGoals.filter((g) => !suggestedGoalValues.includes(g));
  const atMaxGoals = selectedGoals.length >= maxGoals;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          Select up to {maxGoals} goals ({selectedGoals.length}/{maxGoals} selected)
        </p>
        {!showCustomInput && !atMaxGoals ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowCustomInput(true)}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Custom Goal
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
        </div>
      ) : null}

      {error ? (
        <div className="border-destructive/50 bg-destructive/10 rounded-lg border p-4 text-center">
          <p className="text-destructive text-sm">Failed to load goal suggestions</p>
          <p className="text-muted-foreground mt-1 text-xs">You can still add custom goals below</p>
        </div>
      ) : null}

      {showCustomInput ? (
        <Card className="border-dashed">
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center gap-2">
              <Input
                type="text"
                placeholder="Enter your custom goal..."
                value={customGoal}
                onChange={(e) => {
                  setCustomGoal(e.target.value);
                  setValidationError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustomGoal();
                  } else if (e.key === 'Escape') {
                    setCustomGoal('');
                    setShowCustomInput(false);
                    setValidationError(null);
                  }
                }}
                maxLength={MAX_GOAL_LENGTH}
                autoFocus
                className="flex-1"
              />
              <Button type="button" size="sm" onClick={addCustomGoal} disabled={!customGoal.trim()}>
                Add
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCustomGoal('');
                  setShowCustomInput(false);
                  setValidationError(null);
                }}
              >
                Cancel
              </Button>
            </div>
            {validationError ? <p className="text-destructive text-xs">{validationError}</p> : null}
            <p className="text-muted-foreground text-xs">
              {customGoal.length}/{MAX_GOAL_LENGTH} characters
            </p>
          </CardContent>
        </Card>
      ) : null}

      {!isLoading && suggestions.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {suggestions.map((suggestion) => {
            const isSelected = selectedGoals.includes(suggestion.value);
            const isDisabled = !isSelected && atMaxGoals;

            return (
              <Card
                key={suggestion.value}
                onClick={() => !isDisabled && toggleGoal(suggestion.value)}
                className={cn(
                  'cursor-pointer transition-all',
                  isSelected && 'ring-primary ring-2',
                  isDisabled && 'cursor-not-allowed opacity-50',
                  !isSelected && !isDisabled && 'hover:shadow-md'
                )}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-sm leading-snug font-medium">
                        <span aria-hidden className="mr-2">
                          {goalEmoji(suggestion.value)}
                        </span>
                        {suggestion.value}
                      </p>
                      {suggestion.badge ? (
                        <Badge variant="secondary" className="mt-2 text-xs">
                          {suggestion.badge}
                        </Badge>
                      ) : null}
                    </div>
                    {isSelected ? (
                      <div className="bg-primary text-primary-foreground flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full">
                        <svg
                          className="h-3 w-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

      {customGoals.length > 0 ? (
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm font-medium">Custom Goals:</p>
          <div className="space-y-2">
            {customGoals.map((goal) => (
              <Card key={goal} className="border-dashed">
                <CardContent className="flex items-center justify-between gap-2 p-3">
                  <p className="text-sm">
                    <span aria-hidden className="mr-2">
                      {goalEmoji(goal)}
                    </span>
                    {goal}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => removeCustomGoal(goal)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {!isLoading && !error && suggestions.length === 0 && customGoals.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed py-12 text-center">
          <p className="text-muted-foreground">No goal suggestions available</p>
          <p className="text-muted-foreground mt-2 text-sm">
            Click &quot;Add Custom Goal&quot; to create your own
          </p>
        </div>
      ) : null}
    </div>
  );
}
