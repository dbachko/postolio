import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { SocialAccountQueueSettingsPanel } from './components/queue-settings-panel';
import type { SocialAccountQueueSettingsDialogProps } from './types';

export function SocialAccountQueueSettingsDialog({
  open,
  onOpenChange,
  account,
  allAccounts,
}: SocialAccountQueueSettingsDialogProps) {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Publishing Schedule</DialogTitle>
          <DialogDescription>Configure weekly time slots per queue.</DialogDescription>
        </DialogHeader>
        <SocialAccountQueueSettingsPanel
          account={account}
          allAccounts={allAccounts}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
