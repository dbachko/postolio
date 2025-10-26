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

interface RevokeSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionDeviceName: string;
  onConfirm: () => Promise<void>;
  isLoading?: boolean;
}

export function RevokeSessionDialog({
  open,
  onOpenChange,
  sessionDeviceName,
  onConfirm,
  isLoading = false,
}: RevokeSessionDialogProps) {
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
            Revoke Session
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to revoke the session for <strong>{sessionDeviceName}</strong>?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-4">
          <p className="text-muted-foreground text-sm">
            This will immediately log out this device. If you're currently using that device, you'll
            need to log in again.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? 'Revoking...' : 'Revoke Session'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
