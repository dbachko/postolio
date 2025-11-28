import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, Trash2 } from 'lucide-react';

interface SelectionBarProps {
  count: number;
  onClear: () => void;
  onCreatePost: () => void;
  onDelete: () => void;
  deletePending?: boolean;
}

export function SelectionBar({
  count,
  onClear,
  onCreatePost,
  onDelete,
  deletePending,
}: SelectionBarProps) {
  if (count === 0) return null;

  return (
    <div className="bg-card border-border fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-md border px-4 py-3 shadow-lg shadow-black/10">
      <div className="flex items-center gap-2 pr-3">
        <Badge variant="secondary">{count} selected</Badge>
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onCreatePost} disabled={deletePending}>
          <Sparkles className="mr-2 h-4 w-4" />
          Create Post
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete} disabled={deletePending}>
          {deletePending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="mr-2 h-4 w-4" />
          )}
          Delete
        </Button>
      </div>
    </div>
  );
}
