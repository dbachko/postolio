import { useEffect, useMemo, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ArrowUp, ArrowDown, Plus, Trash2 } from 'lucide-react';

interface GoalsListInputProps {
  goals: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

export function GoalsListInput({ goals, onChange, disabled }: GoalsListInputProps) {
  // Track focus for newly added inputs
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const nextFocusIndex = useRef<number | null>(null);
  const nonEmptyCount = useMemo(() => goals.filter((g) => g.trim().length > 0).length, [goals]);
  const MAX_GOALS = 5;
  const canAdd = nonEmptyCount < MAX_GOALS;

  useEffect(() => {
    if (goals.length === 0) onChange(['']);
  }, [goals.length, onChange]);

  const addGoal = () => {
    if (!canAdd) return;
    onChange([...(goals || []), '']);
  };
  const removeGoal = (idx: number) => {
    const next = goals.slice();
    next.splice(idx, 1);
    onChange(next.length ? next : ['']);
  };
  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    const next = goals.slice();
    const tmp = next[idx - 1];
    next[idx - 1] = next[idx]!;
    next[idx] = tmp!;
    onChange(next);
  };
  const moveDown = (idx: number) => {
    if (idx >= goals.length - 1) return;
    const next = goals.slice();
    const tmp = next[idx + 1];
    next[idx + 1] = next[idx]!;
    next[idx] = tmp!;
    onChange(next);
  };

  // After a new goal is added, move focus to it
  useEffect(() => {
    if (nextFocusIndex.current != null) {
      const idx = nextFocusIndex.current;
      nextFocusIndex.current = null;
      const el = inputRefs.current[idx!];
      if (el) {
        try {
          el.focus();
        } catch (_) {
          /* noop */
        }
      }
    }
  }, [goals.length]);

  return (
    <div className="space-y-2">
      <Label>
        What do you want to achieve?{' '}
        <span className="text-destructive" aria-hidden>
          *
        </span>
      </Label>
      <div className="space-y-2">
        {goals.map((g, idx) => (
          <Card key={idx} className="transition-shadow hover:shadow-sm">
            <CardContent className="flex items-center gap-2 p-3">
              <div className="text-muted-foreground w-5 text-center text-xs">{idx + 1}</div>
              <Input
                placeholder="e.g., Increase website signups by 20%"
                value={g}
                ref={(el) => {
                  inputRefs.current[idx] = el;
                }}
                onChange={(e) => {
                  const next = goals.slice();
                  next[idx] = e.target.value;
                  onChange(next);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (canAdd) {
                      nextFocusIndex.current = idx + 1;
                      addGoal();
                    }
                  }
                }}
                disabled={disabled}
              />
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Move up"
                  onClick={() => moveUp(idx)}
                  disabled={disabled || idx === 0}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Move down"
                  onClick={() => moveDown(idx)}
                  disabled={disabled || idx === goals.length - 1}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  aria-label="Remove goal"
                  onClick={() => removeGoal(idx)}
                  disabled={disabled || (goals.length <= 1 && g.trim().length === 0)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <div>
          {nonEmptyCount}/{MAX_GOALS} goal{nonEmptyCount === 1 ? '' : 's'}
          {!canAdd && <span className="text-destructive ml-2">Max 5 goals</span>}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addGoal}
          disabled={disabled || !canAdd}
        >
          <Plus className="h-4 w-4" /> Add goal
        </Button>
      </div>
    </div>
  );
}
