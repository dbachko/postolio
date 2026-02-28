import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { snippets as snippetsApi } from '@/lib/api';
import { useBrandStore } from '@/stores/brandStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { SnippetsDialogs } from './snippets/components/SnippetsDialogs';
import { useSnippetDialogs } from './snippets/components/use-snippet-dialogs';
import { SnippetsHelpCard, SnippetsManagerCard } from './snippets/components/SnippetsManagerCard';

export default function SnippetsPage() {
  const selectedBrand = useBrandStore((state) => state.selectedBrand);
  const queryClient = useQueryClient();
  const brandId = selectedBrand?.id;

  const snippetsQuery = useQuery({
    queryKey: ['snippets', brandId],
    queryFn: () => snippetsApi.listSnippets(brandId!),
    enabled: Boolean(brandId),
  });
  const snippetsList = snippetsQuery.data?.snippets || [];

  const toggleFavoriteMutation = useMutation({
    mutationFn: ({ snippetId, isFavorite }: { snippetId: string; isFavorite: boolean }) =>
      snippetsApi.updateSnippet(brandId!, snippetId, { isFavorite: !isFavorite }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snippets', brandId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (snippetId: string) => snippetsApi.deleteSnippet(brandId!, snippetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snippets', brandId] });
      toast.success('Snippet deleted');
    },
    onError: () => {
      toast.error('Failed to delete snippet');
    },
  });

  const dialogs = useSnippetDialogs(deleteMutation);

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
      <SnippetsManagerCard
        snippetsList={snippetsList}
        isLoading={snippetsQuery.isLoading}
        onCreate={dialogs.handleCreate}
        onToggleFavorite={(snippetId, isFavorite) =>
          toggleFavoriteMutation.mutate({ snippetId, isFavorite })
        }
        onEdit={dialogs.handleEdit}
        onDelete={dialogs.handleDelete}
      />
      <SnippetsHelpCard />
      <SnippetsDialogs
        selectedBrandId={selectedBrand.id}
        dialogOpen={dialogs.dialogOpen}
        editingSnippet={dialogs.editingSnippet}
        onOpenChange={(open) => {
          dialogs.setDialogOpen(open);
          if (!open) {
            dialogs.setEditingSnippet(null);
          }
        }}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['snippets', brandId] });
        }}
        deleteDialogOpen={dialogs.deleteDialogOpen}
        onDeleteDialogOpenChange={dialogs.setDeleteDialogOpen}
        snippetToDelete={dialogs.snippetToDelete}
        onConfirmDelete={dialogs.confirmDelete}
      />
    </div>
  );
}
