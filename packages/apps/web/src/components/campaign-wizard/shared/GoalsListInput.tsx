import { useEffect, useMemo, useRef } from 'react';
import { Card, CardContent } from '../../ui/card';
import { Label } from '../../ui/label';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { ArrowUp, ArrowDown, Plus, Trash2, GripVertical } from 'lucide-react';

interface GoalsListInputProps {
  goals: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

export function GoalsListInput({ goals, onChange, disabled }: GoalsListInputProps) {
  const dragIndex = useRef<number>(-1);
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

  const handleDragStart = (idx: number) => (e: React.DragEvent) => {
    if (disabled) return;
    dragIndex.current = idx;
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', String(idx));
    } catch (_err) {
      void 0; // noop
    }
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleDrop = (targetIdx: number) => (e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    let from = dragIndex.current;
    try {
      const txt = e.dataTransfer.getData('text/plain');
      if (txt) from = parseInt(txt, 10);
    } catch (_err) {
      void 0; // noop
    }
    if (Number.isNaN(from) || from === targetIdx || from < 0) return;
    const next = goals.slice();
    const [moved] = next.splice(from, 1);
    next.splice(targetIdx, 0, moved);
    dragIndex.current = -1;
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <Label>What do you want to achieve?</Label>
      <div className="space-y-2">
        {goals.map((g, idx) => (
          <Card
            key={idx}
            className="transition-shadow hover:shadow-sm"
            draggable={!disabled}
            onDragStart={handleDragStart(idx)}
            onDragOver={handleDragOver}
            onDrop={handleDrop(idx)}
          >
            <CardContent className="flex items-center gap-2 p-3">
              <button
                type="button"
                className="cursor-grab rounded p-1 text-gray-500 hover:bg-gray-100 active:cursor-grabbing disabled:cursor-default"
                aria-label="Drag to reorder"
                draggable={!disabled}
                onDragStart={handleDragStart(idx)}
                onDragEnd={() => (dragIndex.current = -1)}
                disabled={disabled}
              >
                <GripVertical className="h-4 w-4" />
              </button>
              <div className="w-5 text-center text-xs text-gray-500">{idx + 1}</div>
              <Input
                placeholder="e.g., Increase website signups by 20%"
                value={g}
                onChange={(e) => {
                  const next = goals.slice();
                  next[idx] = e.target.value;
                  onChange(next);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (canAdd) addGoal();
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
                  variant="ghost"
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
      <div className="flex items-center justify-between text-xs text-gray-600">
        <div>
          {nonEmptyCount}/{MAX_GOALS} goal{nonEmptyCount === 1 ? '' : 's'}
          {!canAdd && <span className="ml-2 text-red-600">Max 5 goals</span>}
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

export function parseGoalsString(text: string | null | undefined): string[] {
  if (!text) return [];
  // Split by newline or semicolon; trim and drop empties
  return text
    .split(/\n|;/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function joinGoals(goals: string[]): string {
  return goals
    .map((g) => g.trim())
    .filter(Boolean)
    .join('\n');
}
