import { Brain, Sparkles, X } from "lucide-react";

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
  className = "",
}: PostLearningFeedbackProps) {
  if (!isVisible) return null;

  return (
    <div
      className={`bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-4 animate-in slide-in-from-top duration-300 ${className}`}
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-blue-600" />
          <Sparkles className="w-4 h-4 text-purple-600" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-gray-900">{message}</div>
          {appliedToFuturePosts && (
            <div className="text-xs text-gray-600 mt-1">
              Improvements applied to ~{appliedToFuturePosts} future posts
            </div>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Dismiss learning notification"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
