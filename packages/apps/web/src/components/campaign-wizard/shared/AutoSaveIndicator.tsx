import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useCampaignWizard } from '../../../hooks/useCampaignWizard';

export function AutoSaveIndicator() {
  const saveStatus = useCampaignWizard((s) => s.saveStatus);

  if (saveStatus === 'idle') return null;

  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      {saveStatus === 'saving' && (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Saving…</span>
        </>
      )}
      {saveStatus === 'saved' && (
        <>
          <CheckCircle2 className="h-3 w-3 text-green-600" />
          <span>Saved</span>
        </>
      )}
      {saveStatus === 'error' && (
        <>
          <AlertTriangle className="h-3 w-3 text-amber-600" />
          <span>Save failed</span>
        </>
      )}
    </div>
  );
}
