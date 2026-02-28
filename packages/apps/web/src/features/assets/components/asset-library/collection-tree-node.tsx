import { Check, ChevronDown, ChevronRight, FolderIcon, Plus, X } from 'lucide-react';

import type { CollectionNode } from '@/features/assets/api/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { CollectionActionMenu } from './collection-action-menu';
import type { CollectionTreeProps } from './collection-tree-types';

type NodeFlags = {
  hasChildren: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  isInlineRenaming: boolean;
  isInlineCreatingSub: boolean;
  showExpandedCount: boolean;
};

function getNodeFlags(node: CollectionNode, props: CollectionTreeProps): NodeFlags {
  const hasChildren = Boolean(node.children?.length);
  const isExpanded = props.expandedCollections.has(node.id);
  const isSelected = props.collectionId === node.id;
  const isInlineRenaming = props.inlineRenameId === node.id;
  const isInlineCreatingSub = props.inlineCreateParentId === node.id;
  const showExpandedCount = hasChildren && isExpanded && typeof node.assetCount === 'number';
  return {
    hasChildren,
    isExpanded,
    isSelected,
    isInlineRenaming,
    isInlineCreatingSub,
    showExpandedCount,
  };
}

export function InlineCreateInputRow({
  value,
  isSaving,
  placeholder,
  onChange,
  onSubmit,
  onCancel,
  withLeadingSpacer = false,
}: {
  value: string;
  isSaving: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  withLeadingSpacer?: boolean;
}) {
  return (
    <div className="flex h-7 w-full items-center gap-2 rounded-md px-2">
      {withLeadingSpacer ? <span className="h-4 w-4 shrink-0" /> : null}
      <Plus className="text-muted-foreground h-4 w-4 shrink-0" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onSubmit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
        autoFocus
        className="h-7"
        placeholder={placeholder}
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={onSubmit}
        disabled={isSaving}
      >
        <Check className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={onCancel}
        disabled={isSaving}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

function CollectionNodeRow({
  node,
  flags,
  props,
}: {
  node: CollectionNode;
  flags: NodeFlags;
  props: CollectionTreeProps;
}) {
  const rowClass = cn(
    'group/menu-item flex h-7 w-full min-w-0 items-center justify-start gap-2 rounded-md px-2 text-sm transition-colors',
    flags.isSelected
      ? 'bg-accent text-accent-foreground'
      : 'text-foreground/80 hover:bg-accent/50 hover:text-foreground'
  );
  return (
    <div className={rowClass}>
      <CollectionChevron node={node} flags={flags} props={props} />
      {flags.isInlineRenaming ? (
        <CollectionInlineRename props={props} />
      ) : (
        <CollectionPrimaryButton node={node} flags={flags} props={props} />
      )}
      {flags.isInlineRenaming ? (
        <CollectionRenameActions props={props} />
      ) : (
        <CollectionActionMenu
          node={node}
          selectedAssetsCount={props.selectedAssetsCount}
          onStartInlineCreateSubcollection={props.onStartInlineCreateSubcollection}
          onMoveSelectedToCollection={props.onMoveSelectedToCollection}
          onStartInlineRenameCollection={props.onStartInlineRenameCollection}
          onDeleteCollection={props.onDeleteCollection}
        />
      )}
    </div>
  );
}

function CollectionChevron({
  node,
  flags,
  props,
}: {
  node: CollectionNode;
  flags: NodeFlags;
  props: CollectionTreeProps;
}) {
  const renderIcon = () => {
    if (!flags.hasChildren) {
      return <ChevronRight className="h-3.5 w-3.5 opacity-40" />;
    }
    if (flags.isExpanded) {
      return <ChevronDown className="h-3.5 w-3.5" />;
    }
    return <ChevronRight className="h-3.5 w-3.5" />;
  };
  return (
    <button
      type="button"
      className="text-muted-foreground hover:text-foreground inline-flex h-4 w-4 flex-shrink-0 items-center justify-center"
      aria-label={flags.isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
      onClick={(event) => {
        event.stopPropagation();
        if (flags.hasChildren) {
          props.onSetCollectionExpanded(node.id, !flags.isExpanded);
        } else {
          props.onSetCollectionSelection(node.id);
        }
      }}
    >
      {renderIcon()}
    </button>
  );
}

function CollectionInlineRename({ props }: { props: CollectionTreeProps }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <FolderIcon className="text-muted-foreground h-4 w-4 shrink-0" />
      <Input
        value={props.inlineRenameValue}
        onChange={(event) => props.onSetInlineRenameValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            props.onSubmitInlineRenameCollection();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            props.onCancelInlineRenameCollection();
          }
        }}
        autoFocus
        className="h-7"
        placeholder="Collection name"
      />
    </div>
  );
}

function CollectionPrimaryButton({
  node,
  flags,
  props,
}: {
  node: CollectionNode;
  flags: NodeFlags;
  props: CollectionTreeProps;
}) {
  return (
    <button
      type="button"
      className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
      onClick={() => {
        props.onSetCollectionSelection(node.id);
        if (flags.hasChildren && !flags.isExpanded) {
          props.onSetCollectionExpanded(node.id, true);
        }
      }}
    >
      <span className="flex min-w-0 items-center gap-2">
        <FolderIcon className="text-muted-foreground h-4 w-4 shrink-0" />
        <span className="truncate text-sm font-medium">{node.name}</span>
      </span>
      {flags.showExpandedCount ? (
        <span className="text-muted-foreground shrink-0 text-xs font-medium">
          {node.assetCount} {node.assetCount === 1 ? 'asset' : 'assets'}
        </span>
      ) : null}
    </button>
  );
}

function CollectionRenameActions({ props }: { props: CollectionTreeProps }) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={props.onSubmitInlineRenameCollection}
        disabled={props.isInlineRenameSaving}
      >
        <Check className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={props.onCancelInlineRenameCollection}
        disabled={props.isInlineRenameSaving}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

function CollectionInlineSubsection({
  node,
  flags,
  props,
}: {
  node: CollectionNode;
  flags: NodeFlags;
  props: CollectionTreeProps;
}) {
  const branchClass = 'ml-4 mt-1 flex min-w-0 flex-col gap-1 border-l border-border/70 pl-3';
  if (
    !flags.hasChildren &&
    (flags.isInlineCreatingSub || (flags.isSelected && !flags.isInlineRenaming))
  ) {
    return (
      <div className={branchClass}>
        {flags.isInlineCreatingSub ? (
          <InlineCreateInputRow
            value={props.inlineCreateValue}
            isSaving={props.isInlineCreateSaving}
            placeholder="New sub-collection name"
            onChange={props.onSetInlineCreateValue}
            onSubmit={props.onSubmitInlineCreateCollection}
            onCancel={props.onCancelInlineCreateCollection}
          />
        ) : (
          <button
            type="button"
            className="text-muted-foreground hover:bg-accent/50 hover:text-foreground flex h-7 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors"
            onClick={() => props.onStartInlineCreateSubcollection(node)}
          >
            <Plus className="h-4 w-4" />
            <span className="truncate font-medium">Create sub-collection</span>
          </button>
        )}
      </div>
    );
  }

  if (flags.hasChildren) {
    return (
      <CollapsibleContent className={branchClass}>
        {flags.isInlineCreatingSub ? (
          <InlineCreateInputRow
            value={props.inlineCreateValue}
            isSaving={props.isInlineCreateSaving}
            placeholder="New sub-collection name"
            onChange={props.onSetInlineCreateValue}
            onSubmit={props.onSubmitInlineCreateCollection}
            onCancel={props.onCancelInlineCreateCollection}
          />
        ) : null}
        {(node.children || []).map((child) => (
          <CollectionNodeItem key={child.id} node={child} props={props} />
        ))}
      </CollapsibleContent>
    );
  }

  return null;
}

export function CollectionNodeItem({
  node,
  props,
}: {
  node: CollectionNode;
  props: CollectionTreeProps;
}) {
  const flags = getNodeFlags(node, props);

  return (
    <Collapsible
      open={flags.hasChildren ? flags.isExpanded : false}
      onOpenChange={(open) => {
        if (flags.hasChildren) {
          props.onSetCollectionExpanded(node.id, open);
        }
      }}
    >
      <CollectionNodeRow node={node} flags={flags} props={props} />
      <CollectionInlineSubsection node={node} flags={flags} props={props} />
    </Collapsible>
  );
}
