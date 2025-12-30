import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  fallback?: ReactNode;
  children: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error with component stack trace
    console.error('Error boundary caught error:', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });

    // Call optional error handler
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided, otherwise show default error UI
      return (
        this.props.fallback ?? (
          <div className="border-destructive/50 bg-destructive/10 rounded-lg border p-4">
            <p className="text-destructive text-sm font-medium">Something went wrong</p>
            <p className="text-destructive/80 mt-1 text-xs">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
