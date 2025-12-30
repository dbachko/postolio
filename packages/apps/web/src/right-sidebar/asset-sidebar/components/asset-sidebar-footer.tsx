import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

type AssetSidebarFooterProps = {
  hasChanges: boolean;
  saving: boolean;
  onReset: () => void;
  onSave: () => void;
};

export function AssetSidebarFooter({
  hasChanges,
  saving,
  onReset,
  onSave,
}: AssetSidebarFooterProps) {
  return (
    <div className="bg-card/50 border-t px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm">
          {hasChanges ? 'You have unsaved changes.' : 'Make edits and click save when ready.'}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onReset} disabled={!hasChanges || saving}>
            Reset
          </Button>
          <Button onClick={onSave} disabled={!hasChanges || saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
