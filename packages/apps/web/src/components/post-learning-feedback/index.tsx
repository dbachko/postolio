import { Brain, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PostLearningFeedbackProps {
  isVisible: boolean;
  message: string;
  appliedToFuturePosts?: number;
  onDismiss: () => void;
  className?: string;
}

export function PostLearningFeedback({
  isVisible,
  message,
  appliedToFuturePosts,
  onDismiss,
  className = '',
}: PostLearningFeedbackProps) {
  if (!isVisible) {
    return null;
  }

  return (
    <div
      className={`animate-in slide-in-from-top bg-muted rounded-lg border p-4 duration-300 ${className}`}
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Brain className="text-foreground h-5 w-5" />
          <Sparkles className="text-foreground h-4 w-4" />
        </div>
        <div className="flex-1">
          <div className="text-foreground text-sm font-medium">{message}</div>
          {appliedToFuturePosts && (
            <div className="text-muted-foreground mt-1 text-xs">
              Improvements applied to ~{appliedToFuturePosts} future posts
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Dismiss learning notification"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
