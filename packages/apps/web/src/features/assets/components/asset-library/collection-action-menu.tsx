import { MoreHorizontal } from 'lucide-react';

import type { CollectionNode } from '@/features/assets/api/client';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function CollectionActionMenu({
  node,
  selectedAssetsCount,
  onStartInlineCreateSubcollection,
  onMoveSelectedToCollection,
  onStartInlineRenameCollection,
  onDeleteCollection,
}: {
  node: CollectionNode;
  selectedAssetsCount: number;
  onStartInlineCreateSubcollection: (collection: CollectionNode) => void;
  onMoveSelectedToCollection: (collectionId: string | null) => void;
  onStartInlineRenameCollection: (collection: CollectionNode) => void;
  onDeleteCollection: (collection: CollectionNode) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'text-muted-foreground hover:text-foreground hover:bg-background/70 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity',
            'group-hover/menu-item:opacity-100 focus:opacity-100'
          )}
          onClick={(event) => event.stopPropagation()}
          aria-label={`Actions for ${node.name}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onClick={() => onStartInlineCreateSubcollection(node)}>
          New sub-collection
        </DropdownMenuItem>
        {selectedAssetsCount > 0 ? (
          <DropdownMenuItem onClick={() => onMoveSelectedToCollection(node.id)}>
            Move selected here
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onStartInlineRenameCollection(node)}>
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => onDeleteCollection(node)}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
