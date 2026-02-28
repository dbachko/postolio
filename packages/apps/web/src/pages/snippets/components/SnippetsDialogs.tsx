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
import type { Snippet } from '@/lib/api';
import { CreateSnippetDialog } from '@/components/caption/create-snippet-dialog';

export function SnippetsDialogs({
  selectedBrandId,
  dialogOpen,
  editingSnippet,
  onOpenChange,
  onSuccess,
  deleteDialogOpen,
  onDeleteDialogOpenChange,
  snippetToDelete,
  onConfirmDelete,
}: {
  selectedBrandId: string;
  dialogOpen: boolean;
  editingSnippet: Snippet | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  deleteDialogOpen: boolean;
  onDeleteDialogOpenChange: (open: boolean) => void;
  snippetToDelete: Snippet | null;
  onConfirmDelete: () => void;
}) {
  return (
    <>
      <CreateSnippetDialog
        open={dialogOpen}
        onOpenChange={onOpenChange}
        brandId={selectedBrandId}
        snippet={editingSnippet}
        onSuccess={onSuccess}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={onDeleteDialogOpenChange}>
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
              onClick={onConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
