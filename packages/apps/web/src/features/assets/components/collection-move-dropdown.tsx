import { ChevronDown, FolderIcon, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface CollectionMoveOption {
  id: string;
  name: string;
  depth: number;
}

type CollectionMoveDropdownProps = {
  onMoveToCollection: (collectionId: string | null) => void;
  collectionOptions: CollectionMoveOption[];
  pending?: boolean;
  disabled?: boolean;
  triggerLabel?: string;
  unsortedLabel?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  triggerClassName?: string;
};

export function CollectionMoveDropdown({
  onMoveToCollection,
  collectionOptions,
  pending = false,
  disabled = false,
  triggerLabel = 'Move to',
  unsortedLabel = 'Unsorted',
  side = 'top',
  align = 'center',
  triggerClassName,
}: CollectionMoveDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || pending}
          className={cn('gap-2', triggerClassName)}
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FolderIcon className="h-4 w-4" />
          )}
          {triggerLabel}
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} className="max-h-72 min-w-60 overflow-y-auto">
        <DropdownMenuItem onClick={() => onMoveToCollection(null)}>
          {unsortedLabel}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {collectionOptions.map((collection) => (
          <DropdownMenuItem
            key={collection.id}
            onClick={() => onMoveToCollection(collection.id)}
            className="gap-2"
          >
            <FolderIcon className="text-muted-foreground h-4 w-4 shrink-0" />
            <span
              className="min-w-0 truncate"
              style={{ paddingLeft: `${collection.depth * 12}px` }}
            >
              {collection.name}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
