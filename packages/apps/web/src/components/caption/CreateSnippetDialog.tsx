import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { snippets as snippetsApi, type Snippet } from '@/lib/api';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

interface CreateSnippetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  onSuccess?: () => void;
  initialContent?: string; // Pre-fill from AI-generated caption
  snippet?: Snippet | null; // For editing existing snippet
}

export function CreateSnippetDialog({
  open,
  onOpenChange,
  brandId,
  onSuccess,
  initialContent = '',
  snippet = null,
}: CreateSnippetDialogProps) {
  const isEditMode = !!snippet;

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [category, setCategory] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);

  // Reset or populate form when dialog opens/closes
  useEffect(() => {
    if (open) {
      if (snippet) {
        // Edit mode - populate with existing snippet data
        setTitle(snippet.title);
        setContent(snippet.content);
        setTags(snippet.tags);
        setCategory(snippet.category || '');
        setIsFavorite(snippet.isFavorite);
      } else {
        // Create mode - reset form
        setTitle('');
        setContent(initialContent);
        setTags([]);
        setCategory('');
        setIsFavorite(false);
      }
      setTagInput('');
    }
  }, [open, initialContent, snippet]);

  const createMutation = useMutation({
    mutationFn: () =>
      snippetsApi.createSnippet(brandId, {
        title: title.trim(),
        content: content.trim(),
        tags,
        category: category.trim() || undefined,
        isFavorite,
      }),
    onSuccess: () => {
      toast.success('Snippet created successfully');
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create snippet');
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      snippetsApi.updateSnippet(brandId, snippet!.id, {
        title: title.trim(),
        content: content.trim(),
        tags,
        category: category.trim() || undefined,
        isFavorite,
      }),
    onSuccess: () => {
      toast.success('Snippet updated successfully');
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update snippet');
    },
  });

  const handleAddTag = () => {
    const trimmed = tagInput.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    if (isEditMode) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const canSave = title.trim() && content.trim() && content.length <= 2000;

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
          <div className="space-y-4 py-4">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="title"
                placeholder="e.g., Product Launch CTA, Weekend Hashtags"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={100}
                disabled={isPending}
                autoFocus
              />
              <p className="text-muted-foreground text-xs">
                A descriptive name for this snippet ({title.length}/100)
              </p>
            </div>

            {/* Content */}
            <div className="space-y-2">
              <Label htmlFor="content">
                Content <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="content"
                placeholder="Type or paste your snippet text here..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-[150px]"
                maxLength={2000}
                disabled={isPending}
              />
              <p className="text-muted-foreground text-xs">
                The text that will be inserted ({content.length}/2000)
              </p>
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label htmlFor="tags">Tags (optional)</Label>
              <div className="flex gap-2">
                <Input
                  id="tags"
                  placeholder="Add tag (e.g., cta, promo, hashtags)"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  disabled={isPending}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleAddTag}
                  disabled={!tagInput.trim() || isPending}
                >
                  Add
                </Button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="hover:text-destructive ml-1"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Category */}
            <div className="space-y-2">
              <Label htmlFor="category">Category (optional)</Label>
              <Input
                id="category"
                placeholder="e.g., CTA, Hashtags, Openers"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                maxLength={50}
                disabled={isPending}
              />
              <p className="text-muted-foreground text-xs">Group similar snippets together</p>
            </div>

            {/* Favorite */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="favorite"
                checked={isFavorite}
                onCheckedChange={(checked) => setIsFavorite(checked === true)}
                disabled={isPending}
              />
              <label
                htmlFor="favorite"
                className="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Mark as favorite
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave || isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditMode ? 'Update Snippet' : 'Create Snippet'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
