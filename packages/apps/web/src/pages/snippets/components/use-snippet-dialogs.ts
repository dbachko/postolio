import { useState } from 'react';
import type { Snippet } from '@/lib/api';

export function useSnippetDialogs(deleteMutation: {
  mutateAsync: (snippetId: string) => Promise<unknown>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [snippetToDelete, setSnippetToDelete] = useState<Snippet | null>(null);

  const handleCreate = () => {
    setEditingSnippet(null);
    setDialogOpen(true);
  };
  const handleEdit = (snippet: Snippet) => {
    setEditingSnippet(snippet);
    setDialogOpen(true);
  };
  const handleDelete = (snippet: Snippet) => {
    setSnippetToDelete(snippet);
    setDeleteDialogOpen(true);
  };
  const confirmDelete = async () => {
    if (snippetToDelete) {
      await deleteMutation.mutateAsync(snippetToDelete.id);
      setDeleteDialogOpen(false);
      setSnippetToDelete(null);
    }
  };

  return {
    dialogOpen,
    setDialogOpen,
    editingSnippet,
    setEditingSnippet,
    deleteDialogOpen,
    setDeleteDialogOpen,
    snippetToDelete,
    handleCreate,
    handleEdit,
    handleDelete,
    confirmDelete,
  };
}
