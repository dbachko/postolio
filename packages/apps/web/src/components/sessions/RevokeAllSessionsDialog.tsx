import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface RevokeAllSessionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
  isLoading?: boolean;
}

export function RevokeAllSessionsDialog({
  open,
  onOpenChange,
  onConfirm,
  isLoading = false,
}: RevokeAllSessionsDialogProps) {
  const handleConfirm = async () => {
    await onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="text-foreground h-5 w-5" />
            Log out of all other devices
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to revoke all other sessions? This will log out all devices except
            this one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-4">
          <p className="text-muted-foreground text-sm">
            Use this if you suspect unauthorized access or lost a device. You will remain signed in
            on this device.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? 'Revoking...' : 'Log out others'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
