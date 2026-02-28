import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { assetsApi, type CollectionNode } from '@/features/assets/api/client';

import { ROOT_COLLECTION_INLINE_PARENT_ID } from './constants';

type SetCollectionSelection = (
  collectionId: string | null,
  options?: { replace?: boolean }
) => void;
type SetCollectionExpanded = (collectionId: string, open: boolean) => void;

type UseCollectionInlineActionsParams = {
  brandId?: string;
  collectionId: string | null;
  inlineRenameId: string | null;
  inlineCreateParentId: string | null;
  setCollectionSelection: SetCollectionSelection;
  setCollectionExpanded: SetCollectionExpanded;
  clearInlineRename: () => void;
  clearInlineCreate: () => void;
};

type UseInlineCreateSubmitParams = {
  brandId?: string;
  inlineCreateParentId: string | null;
  inlineCreateValue: string;
  clearInlineCreate: () => void;
  setCollectionSelection: SetCollectionSelection;
  setCollectionExpanded: SetCollectionExpanded;
};

export type CollectionInlineActionsState = {
  inlineRenameId: string | null;
  inlineRenameValue: string;
  isInlineRenameSaving: boolean;
  setInlineRenameValue: (value: string) => void;
  startInlineRenameCollection: (collection: CollectionNode) => void;
  cancelInlineRenameCollection: () => void;
  submitInlineRenameCollection: () => Promise<void>;
  clearInlineRename: () => void;
  inlineCreateParentId: string | null;
  inlineCreateValue: string;
  isInlineCreateSaving: boolean;
  setInlineCreateValue: (value: string) => void;
  startInlineCreateRootCollection: () => void;
  startInlineCreateSubcollection: (collection: CollectionNode) => void;
  cancelInlineCreateCollection: () => void;
  submitInlineCreateCollection: () => Promise<void>;
  clearInlineCreate: () => void;
  deleteCollection: (collection: CollectionNode) => Promise<void>;
};

function useInlineRenameState({
  brandId,
}: {
  brandId?: string;
}): Omit<
  CollectionInlineActionsState,
  | 'inlineCreateParentId'
  | 'inlineCreateValue'
  | 'isInlineCreateSaving'
  | 'setInlineCreateValue'
  | 'startInlineCreateRootCollection'
  | 'startInlineCreateSubcollection'
  | 'cancelInlineCreateCollection'
  | 'submitInlineCreateCollection'
  | 'clearInlineCreate'
  | 'deleteCollection'
> {
  const queryClient = useQueryClient();
  const [inlineRenameId, setInlineRenameId] = useState<string | null>(null);
  const [inlineRenameValue, setInlineRenameValue] = useState('');
  const [isInlineRenameSaving, setIsInlineRenameSaving] = useState(false);

  const clearInlineRename = useCallback(() => {
    setInlineRenameId(null);
    setInlineRenameValue('');
  }, []);

  const startInlineRenameCollection = useCallback((collection: CollectionNode) => {
    setInlineRenameId(collection.id);
    setInlineRenameValue(collection.name);
  }, []);

  const submitInlineRenameCollection = useCallback(async () => {
    if (!brandId || !inlineRenameId) {
      return;
    }
    const nextName = inlineRenameValue.trim();
    if (!nextName) {
      toast.error('Collection name is required');
      return;
    }

    setIsInlineRenameSaving(true);
    try {
      await assetsApi.updateTaxonomy(inlineRenameId, { brandId, name: nextName });
      clearInlineRename();
      await queryClient.invalidateQueries({ queryKey: ['asset-collections', brandId] });
      toast.success('Collection renamed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rename collection';
      toast.error(message);
    } finally {
      setIsInlineRenameSaving(false);
    }
  }, [brandId, clearInlineRename, inlineRenameId, inlineRenameValue, queryClient]);

  return {
    inlineRenameId,
    inlineRenameValue,
    isInlineRenameSaving,
    setInlineRenameValue,
    startInlineRenameCollection,
    cancelInlineRenameCollection: clearInlineRename,
    submitInlineRenameCollection,
    clearInlineRename,
  };
}

function useInlineCreateFormState() {
  const [inlineCreateParentId, setInlineCreateParentId] = useState<string | null>(null);
  const [inlineCreateValue, setInlineCreateValue] = useState('');
  const [isInlineCreateSaving, setIsInlineCreateSaving] = useState(false);

  const clearInlineCreate = useCallback(() => {
    setInlineCreateParentId(null);
    setInlineCreateValue('');
  }, []);

  return {
    inlineCreateParentId,
    setInlineCreateParentId,
    inlineCreateValue,
    setInlineCreateValue,
    isInlineCreateSaving,
    setIsInlineCreateSaving,
    clearInlineCreate,
  };
}

function useInlineCreateSubmit({
  brandId,
  inlineCreateParentId,
  inlineCreateValue,
  clearInlineCreate,
  setCollectionSelection,
  setCollectionExpanded,
}: UseInlineCreateSubmitParams) {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    if (!brandId || !inlineCreateParentId) {
      return;
    }
    const nextName = inlineCreateValue.trim();
    if (!nextName) {
      toast.error('Collection name is required');
      return;
    }

    const isRootCollection = inlineCreateParentId === ROOT_COLLECTION_INLINE_PARENT_ID;
    const parentId = isRootCollection ? null : inlineCreateParentId;

    try {
      const response = await assetsApi.createTaxonomy({
        brandId,
        type: 'COLLECTION',
        name: nextName,
        parentId,
      });
      clearInlineCreate();
      if (parentId) {
        setCollectionExpanded(parentId, true);
      }
      setCollectionSelection(response.item.id);
      await queryClient.invalidateQueries({ queryKey: ['asset-collections', brandId] });
      toast.success(isRootCollection ? 'Collection created' : 'Sub-collection created');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create collection';
      toast.error(message);
      throw error;
    }
  }, [
    brandId,
    clearInlineCreate,
    inlineCreateParentId,
    inlineCreateValue,
    queryClient,
    setCollectionExpanded,
    setCollectionSelection,
  ]);
}

function useInlineCreateState({
  brandId,
  setCollectionSelection,
  setCollectionExpanded,
  clearInlineRename,
}: {
  brandId?: string;
  setCollectionSelection: SetCollectionSelection;
  setCollectionExpanded: SetCollectionExpanded;
  clearInlineRename: () => void;
}) {
  const formState = useInlineCreateFormState();

  const startInlineCreateRootCollection = useCallback(() => {
    clearInlineRename();
    formState.setInlineCreateParentId(ROOT_COLLECTION_INLINE_PARENT_ID);
    formState.setInlineCreateValue('');
  }, [clearInlineRename, formState]);

  const startInlineCreateSubcollection = useCallback(
    (collection: CollectionNode) => {
      clearInlineRename();
      formState.setInlineCreateParentId(collection.id);
      formState.setInlineCreateValue('');
      setCollectionSelection(collection.id);
      setCollectionExpanded(collection.id, true);
    },
    [clearInlineRename, formState, setCollectionExpanded, setCollectionSelection]
  );

  const runCreateSubmit = useInlineCreateSubmit({
    brandId,
    inlineCreateParentId: formState.inlineCreateParentId,
    inlineCreateValue: formState.inlineCreateValue,
    clearInlineCreate: formState.clearInlineCreate,
    setCollectionSelection,
    setCollectionExpanded,
  });

  const submitInlineCreateCollection = useCallback(async () => {
    formState.setIsInlineCreateSaving(true);
    try {
      await runCreateSubmit();
    } finally {
      formState.setIsInlineCreateSaving(false);
    }
  }, [formState, runCreateSubmit]);

  return {
    inlineCreateParentId: formState.inlineCreateParentId,
    inlineCreateValue: formState.inlineCreateValue,
    isInlineCreateSaving: formState.isInlineCreateSaving,
    setInlineCreateValue: formState.setInlineCreateValue,
    startInlineCreateRootCollection,
    startInlineCreateSubcollection,
    cancelInlineCreateCollection: formState.clearInlineCreate,
    submitInlineCreateCollection,
    clearInlineCreate: formState.clearInlineCreate,
  };
}

function useDeleteCollectionAction({
  brandId,
  collectionId,
  inlineRenameId,
  inlineCreateParentId,
  setCollectionSelection,
  clearInlineRename,
  clearInlineCreate,
}: UseCollectionInlineActionsParams) {
  const queryClient = useQueryClient();

  return useCallback(
    async (collection: CollectionNode) => {
      if (!brandId) {
        return;
      }

      const confirmed = window.confirm(
        'Delete this collection? Assets inside will be moved to Unsorted.'
      );
      if (!confirmed) {
        return;
      }

      try {
        await assetsApi.deleteTaxonomy(collection.id, { brandId, onNotEmpty: 'move_to_unsorted' });
        if (collectionId === collection.id) {
          setCollectionSelection(null, { replace: true });
        }
        if (inlineRenameId === collection.id) {
          clearInlineRename();
        }
        if (inlineCreateParentId === collection.id) {
          clearInlineCreate();
        }
        await queryClient.invalidateQueries({ queryKey: ['asset-collections', brandId] });
        await queryClient.invalidateQueries({ queryKey: ['assets'] });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to delete collection';
        toast.error(message);
      }
    },
    [
      brandId,
      clearInlineCreate,
      clearInlineRename,
      collectionId,
      inlineCreateParentId,
      inlineRenameId,
      queryClient,
      setCollectionSelection,
    ]
  );
}

export function useCollectionInlineActions({
  brandId,
  collectionId,
  setCollectionSelection,
  setCollectionExpanded,
}: {
  brandId?: string;
  collectionId: string | null;
  setCollectionSelection: SetCollectionSelection;
  setCollectionExpanded: SetCollectionExpanded;
}): CollectionInlineActionsState {
  const renameState = useInlineRenameState({ brandId });
  const createState = useInlineCreateState({
    brandId,
    setCollectionSelection,
    setCollectionExpanded,
    clearInlineRename: renameState.clearInlineRename,
  });
  const deleteCollection = useDeleteCollectionAction({
    brandId,
    collectionId,
    inlineRenameId: renameState.inlineRenameId,
    inlineCreateParentId: createState.inlineCreateParentId,
    setCollectionSelection,
    setCollectionExpanded,
    clearInlineRename: renameState.clearInlineRename,
    clearInlineCreate: createState.clearInlineCreate,
  });

  return {
    ...renameState,
    ...createState,
    deleteCollection,
  };
}
