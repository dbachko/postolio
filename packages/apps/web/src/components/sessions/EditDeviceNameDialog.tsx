import React, { useState, useEffect } from 'react';
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

interface EditDeviceNameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  onConfirm: (newName: string) => Promise<void>;
  isLoading?: boolean;
}

export function EditDeviceNameDialog({
  open,
  onOpenChange,
  currentName,
  onConfirm,
  isLoading = false,
}: EditDeviceNameDialogProps) {
  const [deviceName, setDeviceName] = useState(currentName);

  // Update local state when currentName changes
  useEffect(() => {
    setDeviceName(currentName);
  }, [currentName]);

  const handleConfirm = async () => {
    if (deviceName.trim() && deviceName !== currentName) {
      await onConfirm(deviceName.trim());
      onOpenChange(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && deviceName.trim()) {
      handleConfirm();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Device Name</DialogTitle>
          <DialogDescription>
            Give this device a memorable name to help you identify it later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="deviceName">Device Name</Label>
            <Input
              id="deviceName"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g., Work Laptop, Home PC, iPhone"
              maxLength={100}
              autoFocus
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading || !deviceName.trim() || deviceName === currentName}
          >
            {isLoading ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
