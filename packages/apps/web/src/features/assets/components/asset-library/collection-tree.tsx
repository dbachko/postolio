import { FolderIcon, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CollectionNodeItem, InlineCreateInputRow } from './collection-tree-node';
import type { CollectionTreeProps } from './collection-tree-types';

export type { CollectionTreeProps } from './collection-tree-types';

export function CollectionTree(props: CollectionTreeProps) {
  const isUnsortedCollectionSelected = props.collectionId === props.unsortedCollectionParam;
  const isInlineCreatingRootCollection =
    props.inlineCreateParentId === props.rootCollectionInlineParentId;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">Collections</Label>
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={props.onStartInlineCreateRootCollection}
                aria-label="New collection"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">New collection</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="space-y-0.5">
        <button
          type="button"
          className={cn(
            'group/menu-item flex h-7 w-full min-w-0 items-center justify-start gap-2 rounded-md px-2 text-sm transition-colors',
            isUnsortedCollectionSelected
              ? 'bg-accent text-accent-foreground'
              : 'text-foreground/80 hover:bg-accent/50 hover:text-foreground'
          )}
          onClick={() => props.onSetCollectionSelection(props.unsortedCollectionParam)}
        >
          <span className="h-4 w-4 shrink-0" />
          <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <FolderIcon className="text-muted-foreground h-4 w-4 shrink-0" />
              <span className="truncate text-sm font-medium">Unsorted</span>
            </span>
            {typeof props.unsortedAssetCount === 'number' ? (
              <span className="text-muted-foreground shrink-0 text-xs font-medium">
                {props.unsortedAssetCount} {props.unsortedAssetCount === 1 ? 'asset' : 'assets'}
              </span>
            ) : null}
          </span>
        </button>

        {isInlineCreatingRootCollection ? (
          <InlineCreateInputRow
            value={props.inlineCreateValue}
            isSaving={props.isInlineCreateSaving}
            placeholder="Collection name"
            onChange={props.onSetInlineCreateValue}
            onSubmit={props.onSubmitInlineCreateCollection}
            onCancel={props.onCancelInlineCreateCollection}
            withLeadingSpacer
          />
        ) : null}

        {props.collections.map((node) => (
          <CollectionNodeItem key={node.id} node={node} props={props} />
        ))}

        {props.collections.length === 0 && !isInlineCreatingRootCollection ? (
          <p className="text-muted-foreground text-xs">No collections yet.</p>
        ) : null}
      </div>
    </div>
  );
}
