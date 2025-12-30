import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import type { PostEditorState } from '../../../hooks/use-post-editor';

export function EditDestinationsHelpDialog({ state }: { state: PostEditorState }) {
  return (
    <Dialog
      open={state.destinations.editDestinationsHelpOpen}
      onOpenChange={state.destinations.setEditDestinationsHelpOpen}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Destinations</DialogTitle>
          <DialogDescription>
            Multi-destination posts let you keep one shared template while customizing each
            destination.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <div className="text-foreground font-medium">Template vs destination</div>
            <p className="text-muted-foreground">
              Use the template tab to edit the shared baseline. Switch destinations to fine-tune
              per-platform details.
            </p>
          </div>
          <div className="space-y-1">
            <div className="text-foreground font-medium">Add destinations</div>
            <p className="text-muted-foreground">
              Use the <span className="text-foreground font-medium">+</span> button to add another
              connected social account to this group.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
