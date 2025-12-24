import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, ClipboardList, Edit, Trash2, Star, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { snippets as snippetsApi, type Snippet } from '@/lib/api';
import { useBrandStore } from '@/stores/brandStore';
import { CreateSnippetDialog } from '@/components/caption/CreateSnippetDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function SnippetsPage() {
  const selectedBrand = useBrandStore((state) => state.selectedBrand);
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [snippetToDelete, setSnippetToDelete] = useState<Snippet | null>(null);

  // Fetch snippets
  const { data, isLoading } = useQuery({
    queryKey: ['snippets', selectedBrand?.id],
    queryFn: () => snippetsApi.listSnippets(selectedBrand!.id),
    enabled: !!selectedBrand,
  });

  const snippetsList = data?.snippets || [];

  // Toggle favorite mutation
  const toggleFavoriteMutation = useMutation({
    mutationFn: ({ snippetId, isFavorite }: { snippetId: string; isFavorite: boolean }) =>
      snippetsApi.updateSnippet(selectedBrand!.id, snippetId, { isFavorite: !isFavorite }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snippets', selectedBrand?.id] });
    },
  });

  // Delete snippet mutation
  const deleteMutation = useMutation({
    mutationFn: (snippetId: string) => snippetsApi.deleteSnippet(selectedBrand!.id, snippetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snippets', selectedBrand?.id] });
      toast.success('Snippet deleted');
      setDeleteDialogOpen(false);
      setSnippetToDelete(null);
    },
    onError: () => {
      toast.error('Failed to delete snippet');
    },
  });

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
    }
  };

  if (!selectedBrand) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Snippets</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground flex items-center justify-center p-8 text-center">
            Please select a brand to manage snippets
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle>Snippets</CardTitle>
            <CardDescription className="mt-2">
              Create reusable text snippets for your social media captions
            </CardDescription>
          </div>
          <Button onClick={handleCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New Snippet
          </Button>
        </CardHeader>
        <CardContent>
          {(() => {
            if (isLoading) {
              return (
                <div className="text-muted-foreground flex items-center justify-center p-12">
                  <div className="text-center">
                    <ClipboardList className="text-muted-foreground mx-auto mb-3 h-12 w-12 animate-pulse" />
                    <p className="text-sm">Loading snippets...</p>
                  </div>
                </div>
              );
            }

            if (snippetsList.length === 0) {
              return (
                <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center">
                  <ClipboardList className="text-muted-foreground mb-4 h-12 w-12" />
                  <h3 className="mb-2 text-lg font-semibold">No snippets yet</h3>
                  <p className="text-muted-foreground mb-4 max-w-sm text-sm">
                    Create your first snippet to quickly insert common text into your captions
                  </p>
                  <Button onClick={handleCreate}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Your First Snippet
                  </Button>
                </div>
              );
            }

            return (
              <div className="space-y-3">
                {snippetsList.map((snippet) => (
                  <Card key={snippet.id} className="transition-shadow hover:shadow-md">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{snippet.title}</h3>
                            {snippet.isFavorite && (
                              <Badge variant="secondary" className="gap-1">
                                <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                                Favorite
                              </Badge>
                            )}
                            {snippet.category && (
                              <Badge variant="outline" className="text-xs">
                                {snippet.category}
                              </Badge>
                            )}
                          </div>
                          <p className="text-muted-foreground line-clamp-3 text-sm whitespace-pre-wrap">
                            {snippet.content}
                          </p>
                          {snippet.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {snippet.tags.map((tag) => (
                                <Badge key={tag} variant="secondary" className="text-xs">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          )}
                          <div className="text-muted-foreground flex items-center gap-4 text-xs">
                            <span>Used {snippet.usageCount} times</span>
                            {snippet.lastUsedAt && (
                              <span>
                                Last used {new Date(snippet.lastUsedAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              toggleFavoriteMutation.mutate({
                                snippetId: snippet.id,
                                isFavorite: snippet.isFavorite,
                              })
                            }
                            title={
                              snippet.isFavorite ? 'Remove from favorites' : 'Add to favorites'
                            }
                          >
                            <Star
                              className={`h-4 w-4 ${snippet.isFavorite ? 'fill-yellow-400 text-yellow-400' : ''}`}
                            />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => handleEdit(snippet)}
                            title="Edit snippet"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => handleDelete(snippet)}
                            title="Delete snippet"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertCircle className="h-5 w-5" />
            How to Use Snippets
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex gap-3">
            <div className="bg-primary/10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
              1
            </div>
            <p className="text-muted-foreground">
              Create snippets for text you frequently use: CTAs, hashtag groups, product
              descriptions, etc.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="bg-primary/10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
              2
            </div>
            <p className="text-muted-foreground">
              When writing captions, press{' '}
              <kbd className="bg-muted rounded border px-1 py-0.5 text-xs">⌘;</kbd> or{' '}
              <kbd className="bg-muted rounded border px-1 py-0.5 text-xs">Ctrl+;</kbd>, or click
              the <ClipboardList className="inline h-3 w-3" /> icon
            </p>
          </div>
          <div className="flex gap-3">
            <div className="bg-primary/10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
              3
            </div>
            <p className="text-muted-foreground">
              Search or filter by tags to find the perfect snippet, then click to insert it
              instantly
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <CreateSnippetDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingSnippet(null);
        }}
        brandId={selectedBrand.id}
        snippet={editingSnippet}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['snippets', selectedBrand?.id] });
        }}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Snippet</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{snippetToDelete?.title}"? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
