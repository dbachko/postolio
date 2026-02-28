import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { savedReplies, type SavedReply } from '@/lib/api';
import { useBrandStore } from '@/stores/brandStore';

import type { SavedReplyPayload } from './types';

function useSavedRepliesData(selectedBrandId?: string) {
  const query = useQuery({
    queryKey: ['saved-replies', selectedBrandId],
    queryFn: () => savedReplies.listSavedReplies(selectedBrandId!),
    enabled: Boolean(selectedBrandId),
  });

  return {
    replies: query.data?.savedReplies || [],
    isLoading: query.isLoading,
  };
}

function useSavedReplyMutations(params: {
  selectedBrandId?: string;
  editingReply: SavedReply | null;
  onCreateSuccess: () => void;
  onUpdateSuccess: () => void;
  onDeleteSuccess: () => void;
}) {
  const queryClient = useQueryClient();

  const refreshSavedReplies = () =>
    queryClient.invalidateQueries({ queryKey: ['saved-replies', params.selectedBrandId] });

  const createMutation = useMutation({
    mutationFn: (payload: SavedReplyPayload) =>
      savedReplies.createSavedReply(params.selectedBrandId!, payload),
    onSuccess: () => {
      refreshSavedReplies();
      toast.success('Saved reply created');
      params.onCreateSuccess();
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to create saved reply';
      toast.error(message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: SavedReplyPayload) =>
      savedReplies.updateSavedReply(params.selectedBrandId!, params.editingReply!.id, payload),
    onSuccess: () => {
      refreshSavedReplies();
      toast.success('Saved reply updated');
      params.onUpdateSuccess();
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to update saved reply';
      toast.error(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (replyId: string) =>
      savedReplies.deleteSavedReply(params.selectedBrandId!, replyId),
    onSuccess: () => {
      refreshSavedReplies();
      toast.success('Saved reply deleted');
      params.onDeleteSuccess();
    },
    onError: () => {
      toast.error('Failed to delete saved reply');
    },
  });

  return { createMutation, updateMutation, deleteMutation };
}

export function useSavedRepliesPage() {
  const selectedBrand = useBrandStore((state) => state.selectedBrand);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingReply, setEditingReply] = useState<SavedReply | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [replyToDelete, setReplyToDelete] = useState<SavedReply | null>(null);

  const { replies, isLoading } = useSavedRepliesData(selectedBrand?.id);

  const mutations = useSavedReplyMutations({
    selectedBrandId: selectedBrand?.id,
    editingReply,
    onCreateSuccess: () => setDialogOpen(false),
    onUpdateSuccess: () => {
      setDialogOpen(false);
      setEditingReply(null);
    },
    onDeleteSuccess: () => {
      setDeleteDialogOpen(false);
      setReplyToDelete(null);
    },
  });

  const handleCreate = () => {
    setEditingReply(null);
    setDialogOpen(true);
  };

  const handleEdit = (reply: SavedReply) => {
    setEditingReply(reply);
    setDialogOpen(true);
  };

  const handleDelete = (reply: SavedReply) => {
    setReplyToDelete(reply);
    setDeleteDialogOpen(true);
  };

  const handleSave = async (payload: SavedReplyPayload) => {
    if (editingReply) {
      await mutations.updateMutation.mutateAsync(payload);
      return;
    }

    await mutations.createMutation.mutateAsync(payload);
  };

  const confirmDelete = async () => {
    if (replyToDelete) {
      await mutations.deleteMutation.mutateAsync(replyToDelete.id);
    }
  };

  return {
    selectedBrand,
    replies,
    isLoading,
    dialogOpen,
    setDialogOpen,
    editingReply,
    setEditingReply,
    deleteDialogOpen,
    setDeleteDialogOpen,
    replyToDelete,
    isSaving: mutations.createMutation.isPending || mutations.updateMutation.isPending,
    handleCreate,
    handleEdit,
    handleDelete,
    handleSave,
    confirmDelete,
  };
}
