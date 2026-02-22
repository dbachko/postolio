import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, Trash2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CollectionMoveDropdown, type CollectionMoveOption } from './collection-move-dropdown';

export type SelectionCollectionOption = CollectionMoveOption;

interface SelectionBarProps {
  count: number;
  onClear: () => void;
  onCreatePost: () => void;
  onDelete: () => void;
  onMoveToCollection?: (collectionId: string | null) => void;
  collectionOptions?: SelectionCollectionOption[];
  movePending?: boolean;
  deletePending?: boolean;
  deleteDisabled?: boolean;
  deleteTooltip?: string;
  deleteLabel?: string;
  deleteVariant?: 'destructive' | 'secondary';
}

export function SelectionBar({
  count,
  onClear,
  onCreatePost,
  onDelete,
  onMoveToCollection,
  collectionOptions = [],
  movePending = false,
  deletePending,
  deleteDisabled,
  deleteTooltip,
  deleteLabel = 'Delete',
  deleteVariant = 'destructive',
}: SelectionBarProps) {
  if (count === 0) {
    return null;
  }

  const isDeleteDisabled = !!deletePending || !!deleteDisabled;

  return (
    <div className="bg-card border-border fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-md border px-4 py-3 shadow-lg shadow-black/10">
      <div className="flex items-center gap-2 pr-3">
        <Badge variant="secondary">{count} selected</Badge>
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      </div>
      <div className="flex items-center gap-2">
        {onMoveToCollection ? (
          <CollectionMoveDropdown
            onMoveToCollection={onMoveToCollection}
            collectionOptions={collectionOptions}
            pending={movePending}
            disabled={!!deletePending}
            side="top"
            align="center"
          />
        ) : null}
        <Button variant="secondary" size="sm" onClick={onCreatePost} disabled={deletePending}>
          <Sparkles className="mr-2 h-4 w-4" />
          Create Post
        </Button>
        {deleteTooltip ? (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex"
                  aria-disabled={isDeleteDisabled}
                  tabIndex={isDeleteDisabled ? 0 : -1}
                >
                  <Button
                    variant={deleteVariant}
                    size="sm"
                    onClick={onDelete}
                    disabled={isDeleteDisabled}
                  >
                    {deletePending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4" />
                    )}
                    {deleteLabel}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{deleteTooltip}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <Button variant={deleteVariant} size="sm" onClick={onDelete} disabled={isDeleteDisabled}>
            {deletePending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            {deleteLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
