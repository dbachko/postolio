import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, MessageSquare, Edit, Trash2, Star, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { savedReplies, type SavedReply } from '@/lib/api';
import { useBrandStore } from '@/stores/brandStore';
import { SavedReplyDialog } from '@/components/inbox/saved-reply-dialog';
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

export default function SavedReplies() {
  const selectedBrand = useBrandStore((state) => state.selectedBrand);
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingReply, setEditingReply] = useState<SavedReply | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [replyToDelete, setReplyToDelete] = useState<SavedReply | null>(null);

  // Fetch saved replies
  const { data: savedRepliesData, isLoading } = useQuery({
    queryKey: ['saved-replies', selectedBrand?.id],
    queryFn: () => savedReplies.listSavedReplies(selectedBrand!.id),
    enabled: !!selectedBrand,
  });

  const replies = savedRepliesData?.savedReplies || [];

  // Create saved reply mutation
  const createMutation = useMutation({
    mutationFn: (data: { title: string; body: string; isDefault: boolean }) =>
      savedReplies.createSavedReply(selectedBrand!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-replies', selectedBrand?.id] });
      toast.success('Saved reply created');
      setDialogOpen(false);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create saved reply');
    },
  });

  // Update saved reply mutation
  const updateMutation = useMutation({
    mutationFn: (data: { title: string; body: string; isDefault: boolean }) =>
      savedReplies.updateSavedReply(selectedBrand!.id, editingReply!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-replies', selectedBrand?.id] });
      toast.success('Saved reply updated');
      setDialogOpen(false);
      setEditingReply(null);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update saved reply');
    },
  });

  // Delete saved reply mutation
  const deleteMutation = useMutation({
    mutationFn: (replyId: string) => savedReplies.deleteSavedReply(selectedBrand!.id, replyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-replies', selectedBrand?.id] });
      toast.success('Saved reply deleted');
      setDeleteDialogOpen(false);
      setReplyToDelete(null);
    },
    onError: () => {
      toast.error('Failed to delete saved reply');
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

  const handleSave = async (data: { title: string; body: string; isDefault: boolean }) => {
    if (editingReply) {
      await updateMutation.mutateAsync(data);
    } else {
      await createMutation.mutateAsync(data);
    }
  };

  const confirmDelete = async () => {
    if (replyToDelete) {
      await deleteMutation.mutateAsync(replyToDelete.id);
    }
  };

  if (!selectedBrand) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Saved Replies</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground flex items-center justify-center p-8 text-center">
            Please select a brand to manage saved replies
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
            <CardTitle>Saved Replies</CardTitle>
            <CardDescription className="mt-2">
              Create quick response templates for common DM conversations
            </CardDescription>
          </div>
          <Button onClick={handleCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New Reply
          </Button>
        </CardHeader>
        <CardContent>
          {(() => {
            if (isLoading) {
              return (
                <div className="text-muted-foreground flex items-center justify-center p-12">
                  <div className="text-center">
                    <MessageSquare className="text-muted-foreground mx-auto mb-3 h-12 w-12 animate-pulse" />
                    <p className="text-sm">Loading saved replies...</p>
                  </div>
                </div>
              );
            }

            if (replies.length === 0) {
              return (
                <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center">
                  <MessageSquare className="text-muted-foreground mb-4 h-12 w-12" />
                  <h3 className="mb-2 text-lg font-semibold">No saved replies yet</h3>
                  <p className="text-muted-foreground mb-4 max-w-sm text-sm">
                    Create your first saved reply to quickly respond to common DM inquiries
                  </p>
                  <Button onClick={handleCreate}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Your First Reply
                  </Button>
                </div>
              );
            }

            return (
              <div className="space-y-3">
                {replies.map((reply) => (
                  <Card key={reply.id} className="transition-shadow hover:shadow-md">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{reply.title}</h3>
                            {reply.isDefault && (
                              <Badge variant="secondary" className="gap-1">
                                <Star className="h-3 w-3" />
                                Default
                              </Badge>
                            )}
                          </div>
                          <p className="text-muted-foreground line-clamp-3 text-sm whitespace-pre-wrap">
                            {reply.body}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            Created {new Date(reply.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="icon" onClick={() => handleEdit(reply)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button variant="outline" size="icon" onClick={() => handleDelete(reply)}>
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
            How to Use Saved Replies
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex gap-3">
            <div className="bg-primary/10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
              1
            </div>
            <p className="text-muted-foreground">
              Create saved replies for common questions or greetings you frequently send
            </p>
          </div>
          <div className="flex gap-3">
            <div className="bg-primary/10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
              2
            </div>
            <p className="text-muted-foreground">
              In the DM inbox, click the <MessageSquare className="inline h-3 w-3" /> icon next to
              the send button
            </p>
          </div>
          <div className="flex gap-3">
            <div className="bg-primary/10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
              3
            </div>
            <p className="text-muted-foreground">
              Select a saved reply to instantly populate your message - edit if needed and send!
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <SavedReplyDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingReply(null);
        }}
        savedReply={editingReply}
        onSave={handleSave}
        isSaving={createMutation.isPending || updateMutation.isPending}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Saved Reply</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{replyToDelete?.title}"? This action cannot be
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
