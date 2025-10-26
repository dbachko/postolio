import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useCampaignWizard } from '../../../hooks/useCampaignWizard';

export function AutoSaveIndicator() {
  const saveStatus = useCampaignWizard((s) => s.saveStatus);

  if (saveStatus === 'idle') return null;

  return (
    <div className="text-muted-foreground flex items-center gap-2 text-xs">
      {saveStatus === 'saving' && (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Saving…</span>
        </>
      )}
      {saveStatus === 'saved' && (
        <>
          <CheckCircle2 className="text-foreground h-3 w-3" />
          <span>Saved</span>
        </>
      )}
      {saveStatus === 'error' && (
        <>
          <AlertTriangle className="text-foreground h-3 w-3" />
          <span>Save failed</span>
        </>
      )}
    </div>
  );
}
