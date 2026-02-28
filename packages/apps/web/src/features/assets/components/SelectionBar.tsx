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

interface SelectionDeleteButtonProps {
  pending?: boolean;
  disabled: boolean;
  tooltip?: string;
  label: string;
  variant: SelectionBarProps['deleteVariant'];
  onDelete: () => void;
}

function SelectionDeleteButton({
  pending,
  disabled,
  tooltip,
  label,
  variant,
  onDelete,
}: SelectionDeleteButtonProps) {
  const icon = pending ? (
    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
  ) : (
    <Trash2 className="mr-2 h-4 w-4" />
  );
  const button = (
    <Button variant={variant} size="sm" onClick={onDelete} disabled={disabled}>
      {icon}
      {label}
    </Button>
  );
  if (!tooltip) {
    return button;
  }
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex" aria-disabled={disabled} tabIndex={disabled ? 0 : -1}>
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
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
        <SelectionDeleteButton
          pending={deletePending}
          disabled={isDeleteDisabled}
          tooltip={deleteTooltip}
          label={deleteLabel}
          variant={deleteVariant}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
