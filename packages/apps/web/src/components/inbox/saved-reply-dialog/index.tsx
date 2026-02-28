import { useState, useEffect } from 'react';
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
import { Loader2 } from 'lucide-react';
import type { SavedReply } from '@/lib/api';

interface SavedReplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  savedReply?: SavedReply | null;
  onSave: (data: { title: string; body: string; isDefault: boolean }) => Promise<void>;
  isSaving: boolean;
}

function DialogCopy({ isEditing }: { isEditing: boolean }) {
  return (
    <>
      <DialogTitle>{isEditing ? 'Edit Saved Reply' : 'Create Saved Reply'}</DialogTitle>
      <DialogDescription>
        {isEditing
          ? 'Update your saved reply template.'
          : 'Create a new quick response template for your DM conversations.'}
      </DialogDescription>
    </>
  );
}

type SavedReplyFormFieldsProps = {
  title: string;
  body: string;
  isDefault: boolean;
  isSaving: boolean;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onDefaultChange: (checked: boolean) => void;
};

function SavedReplyFormFields({
  title,
  body,
  isDefault,
  isSaving,
  onTitleChange,
  onBodyChange,
  onDefaultChange,
}: SavedReplyFormFieldsProps) {
  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="title">
          Title <span className="text-destructive">*</span>
        </Label>
        <Input
          id="title"
          placeholder="e.g., Welcome Message, Product Inquiry"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          maxLength={100}
          disabled={isSaving}
          autoFocus
        />
        <p className="text-muted-foreground text-xs">
          A short name to identify this saved reply ({title.length}/100)
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="body">
          Message <span className="text-destructive">*</span>
        </Label>
        <Textarea
          id="body"
          placeholder="Type your message template here..."
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          className="min-h-[150px]"
          maxLength={1000}
          disabled={isSaving}
        />
        <p className="text-muted-foreground text-xs">
          The message that will be inserted when you select this reply ({body.length}/1000)
        </p>
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="isDefault"
          checked={isDefault}
          onCheckedChange={(checked) => onDefaultChange(checked === true)}
          disabled={isSaving}
        />
        <label
          htmlFor="isDefault"
          className="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          Mark as default reply
        </label>
      </div>
    </div>
  );
}

export function SavedReplyDialog({
  open,
  onOpenChange,
  savedReply,
  onSave,
  isSaving,
}: SavedReplyDialogProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  const isEditing = !!savedReply;

  // Reset form when dialog opens/closes or saved reply changes
  useEffect(() => {
    if (open) {
      setTitle(savedReply?.title || '');
      setBody(savedReply?.body || '');
      setIsDefault(savedReply?.isDefault || false);
    } else {
      setTitle('');
      setBody('');
      setIsDefault(false);
    }
  }, [open, savedReply]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      return;
    }

    await onSave({
      title: title.trim(),
      body: body.trim(),
      isDefault,
    });
  };

  const canSave = title.trim().length > 0 && body.trim().length > 0 && !isSaving;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogCopy isEditing={isEditing} />
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <SavedReplyFormFields
            title={title}
            body={body}
            isDefault={isDefault}
            isSaving={isSaving}
            onTitleChange={setTitle}
            onBodyChange={setBody}
            onDefaultChange={setIsDefault}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? 'Save Changes' : 'Create Reply'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
