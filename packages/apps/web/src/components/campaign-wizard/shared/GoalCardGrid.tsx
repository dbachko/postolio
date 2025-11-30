import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { campaign } from '@/lib/api';
import { goalEmoji } from '@/utils/goal-emojis';
import type { CampaignType } from '@/types/campaign-wizard';

interface GoalSuggestion {
  value: string;
  score: number;
  source: 'cached' | 'template' | 'fallback' | 'user';
  badge?: string;
  reasons?: string[];
}

interface GoalCardGridProps {
  brandId: string;
  campaignType: CampaignType;
  selectedGoals: string[];
  onChange: (goals: string[]) => void;
  maxGoals?: number;
}

const MAX_GOAL_LENGTH = 200; // Maximum characters per goal

/**
 * Sanitize and validate custom goal input
 */
function sanitizeGoal(input: string): string | null {
  // Trim whitespace
  const trimmed = input.trim();

  // Check minimum length
  if (trimmed.length === 0) return null;

  // Check maximum length
  if (trimmed.length > MAX_GOAL_LENGTH) return null;

  // Remove potential XSS vectors (basic sanitization)
  const sanitized = trimmed
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript:/gi, '');

  return sanitized;
}

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

  // Fetch goal suggestions
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

  // Toggle goal selection
  const toggleGoal = (goal: string) => {
    if (selectedGoals.includes(goal)) {
      onChange(selectedGoals.filter((g) => g !== goal));
    } else {
      if (selectedGoals.length >= maxGoals) {
        return; // Don't allow more than maxGoals
      }
      onChange([...selectedGoals, goal]);
    }
  };

  // Add custom goal with validation
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

  // Remove custom goal
  const removeCustomGoal = (goal: string) => {
    onChange(selectedGoals.filter((g) => g !== goal));
  };

  // Separate suggested and custom goals
  const suggestedGoalValues = suggestions.map((s) => s.value);
  const customGoals = selectedGoals.filter((g) => !suggestedGoalValues.includes(g));

  const atMaxGoals = selectedGoals.length >= maxGoals;

  return (
    <div className="space-y-4">
      {/* Goal counter */}
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          Select up to {maxGoals} goals ({selectedGoals.length}/{maxGoals} selected)
        </p>
        {!showCustomInput && !atMaxGoals && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowCustomInput(true)}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Custom Goal
          </Button>
        )}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="border-destructive/50 bg-destructive/10 rounded-lg border p-4 text-center">
          <p className="text-destructive text-sm">Failed to load goal suggestions</p>
          <p className="text-muted-foreground mt-1 text-xs">You can still add custom goals below</p>
        </div>
      )}

      {/* Custom goal input */}
      {showCustomInput && (
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
            {validationError && <p className="text-destructive text-xs">{validationError}</p>}
            <p className="text-muted-foreground text-xs">
              {customGoal.length}/{MAX_GOAL_LENGTH} characters
            </p>
          </CardContent>
        </Card>
      )}

      {/* Suggested goals grid */}
      {!isLoading && suggestions.length > 0 && (
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
                      {suggestion.badge && (
                        <Badge variant="secondary" className="mt-2 text-xs">
                          {suggestion.badge}
                        </Badge>
                      )}
                    </div>
                    {isSelected && (
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
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Custom goals list */}
      {customGoals.length > 0 && (
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
      )}

      {/* Empty state (no suggestions and no loading) */}
      {!isLoading && !error && suggestions.length === 0 && customGoals.length === 0 && (
        <div className="rounded-lg border-2 border-dashed py-12 text-center">
          <p className="text-muted-foreground">No goal suggestions available</p>
          <p className="text-muted-foreground mt-2 text-sm">
            Click "Add Custom Goal" to create your own
          </p>
        </div>
      )}
    </div>
  );
}
