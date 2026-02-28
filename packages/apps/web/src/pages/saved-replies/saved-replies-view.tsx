import { AlertCircle, Edit, MessageSquare, Plus, Star, Trash2 } from 'lucide-react';

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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { SavedReply } from '@/lib/api';

import type { SavedReplyPayload } from './types';

export function SavedRepliesEmptyBrandView() {
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

function RepliesLoadingState() {
  return (
    <div className="text-muted-foreground flex items-center justify-center p-12">
      <div className="text-center">
        <MessageSquare className="text-muted-foreground mx-auto mb-3 h-12 w-12 animate-pulse" />
        <p className="text-sm">Loading saved replies...</p>
      </div>
    </div>
  );
}

function RepliesEmptyState(props: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center">
      <MessageSquare className="text-muted-foreground mb-4 h-12 w-12" />
      <h3 className="mb-2 text-lg font-semibold">No saved replies yet</h3>
      <p className="text-muted-foreground mb-4 max-w-sm text-sm">
        Create your first saved reply to quickly respond to common DM inquiries
      </p>
      <Button onClick={props.onCreate}>
        <Plus className="mr-2 h-4 w-4" />
        Create Your First Reply
      </Button>
    </div>
  );
}

function ReplyCard(props: {
  reply: SavedReply;
  onEdit: (reply: SavedReply) => void;
  onDelete: (reply: SavedReply) => void;
}) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{props.reply.title}</h3>
              {props.reply.isDefault ? (
                <Badge variant="secondary" className="gap-1">
                  <Star className="h-3 w-3" />
                  Default
                </Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground line-clamp-3 text-sm whitespace-pre-wrap">
              {props.reply.body}
            </p>
            <p className="text-muted-foreground text-xs">
              Created {new Date(props.reply.createdAt).toLocaleDateString()}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={() => props.onEdit(props.reply)}>
              <Edit className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => props.onDelete(props.reply)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RepliesContent(props: {
  replies: SavedReply[];
  isLoading: boolean;
  onCreate: () => void;
  onEdit: (reply: SavedReply) => void;
  onDelete: (reply: SavedReply) => void;
}) {
  if (props.isLoading) {
    return <RepliesLoadingState />;
  }

  if (props.replies.length === 0) {
    return <RepliesEmptyState onCreate={props.onCreate} />;
  }

  return (
    <div className="space-y-3">
      {props.replies.map((reply) => (
        <ReplyCard key={reply.id} reply={reply} onEdit={props.onEdit} onDelete={props.onDelete} />
      ))}
    </div>
  );
}

function SavedRepliesInfoCard() {
  return (
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
            In the DM inbox, click the <MessageSquare className="inline h-3 w-3" /> icon next to the
            send button
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
  );
}

interface SavedRepliesViewProps {
  replies: SavedReply[];
  isLoading: boolean;
  dialogOpen: boolean;
  editingReply: SavedReply | null;
  deleteDialogOpen: boolean;
  replyToDelete: SavedReply | null;
  isSaving: boolean;
  onCreate: () => void;
  onEdit: (reply: SavedReply) => void;
  onDelete: (reply: SavedReply) => void;
  onDialogOpenChange: (open: boolean) => void;
  onDeleteDialogOpenChange: (open: boolean) => void;
  onClearEditingReply: () => void;
  onSave: (payload: SavedReplyPayload) => Promise<void>;
  onConfirmDelete: () => Promise<void>;
}

export function SavedRepliesView(props: SavedRepliesViewProps) {
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
          <Button onClick={props.onCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New Reply
          </Button>
        </CardHeader>
        <CardContent>
          <RepliesContent
            replies={props.replies}
            isLoading={props.isLoading}
            onCreate={props.onCreate}
            onEdit={props.onEdit}
            onDelete={props.onDelete}
          />
        </CardContent>
      </Card>

      <SavedRepliesInfoCard />

      <SavedReplyDialog
        open={props.dialogOpen}
        onOpenChange={(open) => {
          props.onDialogOpenChange(open);
          if (!open) {
            props.onClearEditingReply();
          }
        }}
        savedReply={props.editingReply}
        onSave={props.onSave}
        isSaving={props.isSaving}
      />

      <AlertDialog open={props.deleteDialogOpen} onOpenChange={props.onDeleteDialogOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Saved Reply</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{props.replyToDelete?.title}"? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void props.onConfirmDelete();
              }}
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
