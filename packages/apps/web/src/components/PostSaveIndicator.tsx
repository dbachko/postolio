import { format } from 'date-fns';
import { Loader2, Save, CheckCircle2, AlertCircle } from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

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
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case 'saved':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Save className="h-4 w-4 text-gray-400" />;
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
          : idleHint || 'Changes will be saved when you close the dialog';
    }
  };

  return (
    <div className={`flex items-center gap-2 text-sm text-gray-500 ${className}`}>
      {getIcon()}
      <span>{getText()}</span>
    </div>
  );
}
