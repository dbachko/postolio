import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { assetsApi, type CollectionNode, type LabelRecord } from '@/features/assets/api/client';
import { getLocalSetting, setLocalSetting } from '@/lib/settings/localSettings';

import type { SelectionCollectionOption } from '../SelectionBar';
import { getCollectionExpansionStorageKey, UNSORTED_COLLECTION_PARAM } from './constants';
import {
  useCollectionInlineActions,
  type CollectionInlineActionsState,
} from './use-asset-library-collection-actions';

type CollectionSelectionOptions = {
  replace?: boolean;
};

type CollectionQueryState = {
  collections: CollectionNode[];
  labels: LabelRecord[];
  unsortedAssetCount?: number;
  isCollectionsFetched: boolean;
};

type CollectionSelectionState = {
  collectionId: string | null;
  isUnsortedCollectionSelected: boolean;
  selectedCollection: CollectionNode | null;
  setCollectionSelection: (
    collectionId: string | null,
    options?: CollectionSelectionOptions
  ) => void;
};

type CollectionExpansionState = {
  expandedCollections: Set<string>;
  setCollectionExpanded: (collectionId: string, open: boolean) => void;
};

export type AssetLibraryCollectionsState = {
  collections: CollectionNode[];
  labels: LabelRecord[];
  labelOptions: Array<{ label: string; value: string }>;
  unsortedAssetCount?: number;
  collectionId: string | null;
  isUnsortedCollectionSelected: boolean;
  selectedCollection: CollectionNode | null;
  selectionCollectionOptions: SelectionCollectionOption[];
  expandedCollections: Set<string>;
  setCollectionSelection: CollectionSelectionState['setCollectionSelection'];
  setCollectionExpanded: CollectionExpansionState['setCollectionExpanded'];
} & CollectionInlineActionsState;

function collectCollectionIds(nodes: CollectionNode[]): Set<string> {
  const ids = new Set<string>();
  const stack = [...nodes];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    ids.add(current.id);
    if (current.children?.length) {
      stack.push(...current.children);
    }
  }

  return ids;
}

function findCollectionById(nodes: CollectionNode[], id: string | null): CollectionNode | null {
  if (!id) {
    return null;
  }

  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    if (!node.children?.length) {
      continue;
    }
    const nestedMatch = findCollectionById(node.children, id);
    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return null;
}

function flattenCollectionOptions(collections: CollectionNode[]): SelectionCollectionOption[] {
  const options: SelectionCollectionOption[] = [];
  const stack = collections.map((collection) => ({ node: collection, depth: 0 }));

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    options.push({ id: current.node.id, name: current.node.name, depth: current.depth });

    const children = current.node.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child) {
        stack.push({ node: child, depth: current.depth + 1 });
      }
    }
  }

  return options;
}

function useCollectionQueries(brandId?: string): CollectionQueryState {
  const collectionsQuery = useQuery({
    queryKey: ['asset-collections', brandId ?? '', 'tree'],
    queryFn: () =>
      assetsApi.listTaxonomy({
        brandId: brandId as string,
        type: 'COLLECTION',
        format: 'tree',
      }),
    enabled: Boolean(brandId),
    staleTime: 30_000,
  });

  const labelsQuery = useQuery({
    queryKey: ['asset-labels', brandId ?? ''],
    queryFn: () =>
      assetsApi.listTaxonomy({
        brandId: brandId as string,
        type: 'LABEL',
        includeArchived: false,
      }),
    enabled: Boolean(brandId),
    staleTime: 30_000,
  });

  return {
    collections: (collectionsQuery.data?.collections ?? []) as CollectionNode[],
    labels: (labelsQuery.data?.labels ?? []) as LabelRecord[],
    unsortedAssetCount: collectionsQuery.data?.unsortedAssetCount,
    isCollectionsFetched: collectionsQuery.isFetched,
  };
}

function useCollectionSelectionState({
  collections,
  isCollectionsFetched,
}: CollectionQueryState): CollectionSelectionState {
  const [searchParams, setSearchParams] = useSearchParams();
  const [collectionId, setCollectionId] = useState<string | null>(null);

  const setCollectionSelection = useCallback(
    (nextCollectionId: string | null, options?: CollectionSelectionOptions) => {
      setCollectionId(nextCollectionId);
      const next = new URLSearchParams(searchParams);
      if (nextCollectionId) {
        next.set('collection', nextCollectionId);
      } else {
        next.delete('collection');
      }
      setSearchParams(next, { replace: options?.replace ?? false });
    },
    [searchParams, setSearchParams]
  );

  useEffect(() => {
    const fromUrl = searchParams.get('collection');
    const nextId = fromUrl && fromUrl.trim().length > 0 ? fromUrl : null;
    setCollectionId((previous) => (previous === nextId ? previous : nextId));
  }, [searchParams]);

  useEffect(() => {
    if (!collectionId || !isCollectionsFetched || collectionId === UNSORTED_COLLECTION_PARAM) {
      return;
    }
    if (findCollectionById(collections, collectionId)) {
      return;
    }
    setCollectionSelection(null, { replace: true });
  }, [collectionId, collections, isCollectionsFetched, setCollectionSelection]);

  const isUnsortedCollectionSelected = collectionId === UNSORTED_COLLECTION_PARAM;
  const selectedCollection = useMemo(() => {
    if (isUnsortedCollectionSelected) {
      return null;
    }
    return findCollectionById(collections, collectionId);
  }, [collections, collectionId, isUnsortedCollectionSelected]);

  return {
    collectionId,
    isUnsortedCollectionSelected,
    selectedCollection,
    setCollectionSelection,
  };
}

function useCollectionExpansionState({
  brandId,
  collections,
  isCollectionsFetched,
}: CollectionQueryState & { brandId?: string }): CollectionExpansionState {
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set());
  const collectionExpansionStorageKey = useMemo(
    () => getCollectionExpansionStorageKey(brandId),
    [brandId]
  );

  const setCollectionExpanded = useCallback((collectionId: string, open: boolean) => {
    setExpandedCollections((previous) => {
      const next = new Set(previous);
      if (open) {
        next.add(collectionId);
      } else {
        next.delete(collectionId);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!collectionExpansionStorageKey) {
      setExpandedCollections(new Set());
      return;
    }
    const stored = getLocalSetting<unknown>(collectionExpansionStorageKey);
    const ids = Array.isArray(stored)
      ? stored.filter((value): value is string => typeof value === 'string')
      : [];
    setExpandedCollections(new Set(ids));
  }, [collectionExpansionStorageKey]);

  useEffect(() => {
    if (!collectionExpansionStorageKey) {
      return;
    }
    setLocalSetting(collectionExpansionStorageKey, Array.from(expandedCollections));
  }, [collectionExpansionStorageKey, expandedCollections]);

  useEffect(() => {
    if (!isCollectionsFetched) {
      return;
    }
    const validIds = collectCollectionIds(collections);
    setExpandedCollections((previous) => {
      const next = new Set<string>();
      let changed = false;
      previous.forEach((id) => {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : previous;
    });
  }, [collections, isCollectionsFetched]);

  return { expandedCollections, setCollectionExpanded };
}

export function useAssetLibraryCollectionsState({
  brandId,
}: {
  brandId?: string;
}): AssetLibraryCollectionsState {
  const queryState = useCollectionQueries(brandId);
  const selectionState = useCollectionSelectionState(queryState);
  const expansionState = useCollectionExpansionState({ ...queryState, brandId });
  const actionsState = useCollectionInlineActions({
    brandId,
    collectionId: selectionState.collectionId,
    setCollectionSelection: selectionState.setCollectionSelection,
    setCollectionExpanded: expansionState.setCollectionExpanded,
  });

  const labelOptions = useMemo(
    () => queryState.labels.map((label) => ({ label: label.name, value: label.id })),
    [queryState.labels]
  );
  const selectionCollectionOptions = useMemo(
    () => flattenCollectionOptions(queryState.collections),
    [queryState.collections]
  );

  return {
    collections: queryState.collections,
    labels: queryState.labels,
    labelOptions,
    unsortedAssetCount: queryState.unsortedAssetCount,
    collectionId: selectionState.collectionId,
    isUnsortedCollectionSelected: selectionState.isUnsortedCollectionSelected,
    selectedCollection: selectionState.selectedCollection,
    selectionCollectionOptions,
    expandedCollections: expansionState.expandedCollections,
    setCollectionSelection: selectionState.setCollectionSelection,
    setCollectionExpanded: expansionState.setCollectionExpanded,
    ...actionsState,
  };
}
