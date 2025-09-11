import { Brain, Sparkles, X } from 'lucide-react';

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
  if (!isVisible) return null;

  return (
    <div
      className={`animate-in slide-in-from-top rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-purple-50 p-4 duration-300 ${className}`}
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-blue-600" />
          <Sparkles className="h-4 w-4 text-purple-600" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-gray-900">{message}</div>
          {appliedToFuturePosts && (
            <div className="mt-1 text-xs text-gray-600">
              Improvements applied to ~{appliedToFuturePosts} future posts
            </div>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="text-gray-400 transition-colors hover:text-gray-600"
          aria-label="Dismiss learning notification"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
