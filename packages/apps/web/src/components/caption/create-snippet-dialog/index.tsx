import { useEffect, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { snippets as snippetsApi, type Snippet } from '@/lib/api';

import { SnippetFormFields } from './components/create-snippet-dialog-fields';
import type { SnippetFormState } from './types';

interface CreateSnippetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  onSuccess?: () => void;
  initialContent?: string;
  snippet?: Snippet | null;
}

function createInitialSnippetState(params: {
  snippet: Snippet | null;
  initialContent: string;
}): SnippetFormState {
  if (params.snippet) {
    return {
      title: params.snippet.title,
      content: params.snippet.content,
      tags: params.snippet.tags,
      category: params.snippet.category || '',
      isFavorite: params.snippet.isFavorite,
    };
  }

  return {
    title: '',
    content: params.initialContent,
    tags: [],
    category: '',
    isFavorite: false,
  };
}

function useSnippetFormState(params: {
  open: boolean;
  initialContent: string;
  snippet: Snippet | null;
}) {
  const [form, setForm] = useState<SnippetFormState>(
    createInitialSnippetState({ snippet: params.snippet, initialContent: params.initialContent })
  );
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    if (!params.open) {
      return;
    }

    setForm(
      createInitialSnippetState({ snippet: params.snippet, initialContent: params.initialContent })
    );
    setTagInput('');
  }, [params.initialContent, params.open, params.snippet]);

  const addTag = () => {
    const trimmed = tagInput.trim().toLowerCase();
    if (trimmed && !form.tags.includes(trimmed)) {
      setForm({ ...form, tags: [...form.tags, trimmed] });
      setTagInput('');
    }
  };

  const removeTag = (tag: string) => {
    setForm({ ...form, tags: form.tags.filter((value) => value !== tag) });
  };

  return { form, setForm, tagInput, setTagInput, addTag, removeTag };
}

function useSnippetMutations(params: {
  brandId: string;
  snippet: Snippet | null;
  form: SnippetFormState;
  onSuccess?: () => void;
  onClose: () => void;
}) {
  const payload = {
    title: params.form.title.trim(),
    content: params.form.content.trim(),
    tags: params.form.tags,
    category: params.form.category.trim() || undefined,
    isFavorite: params.form.isFavorite,
  };

  const createMutation = useMutation({
    mutationFn: () => snippetsApi.createSnippet(params.brandId, payload),
    onSuccess: () => {
      toast.success('Snippet created successfully');
      params.onSuccess?.();
      params.onClose();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create snippet');
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => snippetsApi.updateSnippet(params.brandId, params.snippet!.id, payload),
    onSuccess: () => {
      toast.success('Snippet updated successfully');
      params.onSuccess?.();
      params.onClose();
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update snippet');
    },
  });

  return {
    createMutation,
    updateMutation,
    isPending: createMutation.isPending || updateMutation.isPending,
  };
}

export function CreateSnippetDialog({
  open,
  onOpenChange,
  brandId,
  onSuccess,
  initialContent = '',
  snippet = null,
}: CreateSnippetDialogProps) {
  const isEditMode = Boolean(snippet);
  const form = useSnippetFormState({
    open,
    initialContent,
    snippet,
  });

  const mutations = useSnippetMutations({
    brandId,
    snippet,
    form: form.form,
    onSuccess,
    onClose: () => onOpenChange(false),
  });

  const canSave =
    Boolean(form.form.title.trim()) &&
    Boolean(form.form.content.trim()) &&
    form.form.content.length <= 2000;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) {
      return;
    }

    if (isEditMode) {
      mutations.updateMutation.mutate();
      return;
    }

    mutations.createMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit Snippet' : 'Create Snippet'}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Update your snippet details'
              : 'Save this text as a reusable snippet for future captions'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <SnippetFormFields
            form={form.form}
            setForm={form.setForm}
            tagInput={form.tagInput}
            setTagInput={form.setTagInput}
            addTag={form.addTag}
            removeTag={form.removeTag}
            disabled={mutations.isPending}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutations.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave || mutations.isPending}>
              {mutations.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {isEditMode ? 'Update Snippet' : 'Create Snippet'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
