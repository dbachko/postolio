import { format } from 'date-fns';
import { Loader2, Save, CheckCircle2, AlertCircle } from 'lucide-react';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface PostSaveIndicatorProps {
  status: SaveStatus;
  lastSaved?: Date | null;
  className?: string;
  showAILearningMessage?: boolean;
  // Optional hint shown when idle and nothing saved yet
  idleHint?: string;
}

export function PostSaveIndicator({
  status,
  lastSaved,
  className = '',
  showAILearningMessage = false,
  idleHint,
}: PostSaveIndicatorProps) {
  const getIcon = () => {
    switch (status) {
      case 'saving':
        return <Loader2 className="text-foreground h-4 w-4 animate-spin" />;
      case 'saved':
        return <CheckCircle2 className="text-foreground h-4 w-4" />;
      case 'error':
        return <AlertCircle className="text-destructive h-4 w-4" />;
      default:
        return <Save className="text-muted-foreground h-4 w-4" />;
    }
  };

  const getText = () => {
    // Show AI learning message when specified, regardless of save status
    if (showAILearningMessage && status !== 'saving' && status !== 'error') {
      return 'AI is learning from your edits and improving future content...';
    }

    switch (status) {
      case 'saving':
        return 'Saving...';
      case 'saved':
        return 'Saved';
      case 'error':
        return 'Failed to save';
      default:
        return lastSaved
          ? `Last saved: ${format(lastSaved, 'HH:mm:ss')}`
          : idleHint || 'No changes yet';
    }
  };

  return (
    <div className={`text-muted-foreground flex items-center gap-2 text-sm ${className}`}>
      {getIcon()}
      <span>{getText()}</span>
    </div>
  );
}
