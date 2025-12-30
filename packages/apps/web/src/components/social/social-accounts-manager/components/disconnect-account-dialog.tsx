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

type DisconnectAccountDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  hasTarget: boolean;
  onKeepImportedPosts: () => void;
  onRemoveImportedPosts: () => void;
};

export function DisconnectAccountDialog({
  open,
  onOpenChange,
  isPending,
  hasTarget,
  onKeepImportedPosts,
  onRemoveImportedPosts,
}: DisconnectAccountDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect social account?</AlertDialogTitle>
          <AlertDialogDescription>
            This will stop publishing and syncing for this account. Choose whether to keep or remove
            posts that were imported from it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={isPending || !hasTarget} onClick={onKeepImportedPosts}>
            Keep imported posts
          </AlertDialogAction>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={isPending || !hasTarget}
            onClick={onRemoveImportedPosts}
          >
            Remove imported posts
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
