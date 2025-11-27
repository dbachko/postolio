/**
 * Utility functions for handling content status display with processing states
 */

interface GenerationParams {
  processing?: {
    active: boolean;
    operation: 'scheduling';
    startedAt: string;
    operationId?: string;
  };
  scheduleId?: string;
  awsScheduleCreated?: boolean;
  [key: string]: unknown;
}

interface Content {
  id: string;
  status: 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped';
  generationParams?: GenerationParams | null;
  schedulingError?: string | null;
  scheduledAt?: Date | string | null;
}

interface DisplayStatus {
  status: 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped' | 'processing';
  label: string;
  showSpinner: boolean;
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info';
  description?: string;
}

/**
 * Get the display status for content, accounting for processing states
 */
export function getContentDisplayStatus(content: Content): DisplayStatus {
  const processing = content.generationParams?.processing;

  // Check if content is currently being processed
  if (processing?.active) {
    return {
      status: 'processing',
      label: 'Scheduling...',
      showSpinner: true,
      variant: 'info',
      description: 'Content is being scheduled for publishing',
    };
  }

  // Handle normal statuses
  switch (content.status) {
    case 'draft':
      return {
        status: 'draft',
        label: 'Draft',
        showSpinner: false,
        variant: 'outline',
        description: content.schedulingError
          ? `Scheduling failed: ${content.schedulingError}`
          : 'Content is saved as draft',
      };

    case 'scheduled':
      return {
        status: 'scheduled',
        label: 'Scheduled',
        showSpinner: false,
        variant: 'info',
        description: content.scheduledAt
          ? `Scheduled for ${formatScheduledTime(content.scheduledAt)}`
          : 'Content is scheduled for publishing',
      };

    case 'published':
      return {
        status: 'published',
        label: 'Published',
        showSpinner: false,
        variant: 'success',
        description: 'Content has been successfully published',
      };

    case 'failed':
      return {
        status: 'failed',
        label: 'Failed',
        showSpinner: false,
        variant: 'destructive',
        description: content.schedulingError || 'Publishing failed',
      };

    case 'skipped':
      return {
        status: 'skipped',
        label: 'Skipped',
        showSpinner: false,
        variant: 'outline',
        description: 'Content was skipped during campaign pause',
      };

    default:
      return {
        status: 'draft',
        label: 'Unknown',
        showSpinner: false,
        variant: 'outline',
      };
  }
}

/**
 * Check if content can be scheduled (not already processing or scheduled)
 */
export function canScheduleContent(content: Content): boolean {
  const processing = content.generationParams?.processing;

  // Can't schedule if already processing
  if (processing?.active) {
    return false;
  }

  // Allow scheduling/rescheduling from draft, scheduled, failed, or skipped
  return (
    content.status === 'draft' ||
    content.status === 'scheduled' ||
    content.status === 'failed' ||
    content.status === 'skipped'
  );
}

/**
 * Check if content is currently being processed
 */
export function isContentProcessing(content: Content): boolean {
  return Boolean(content.generationParams?.processing?.active);
}

/**
 * Get user-friendly error message for scheduling failures
 */
export function getSchedulingErrorMessage(content: Content): string | null {
  if (!content.schedulingError) {
    return null;
  }

  // Provide user-friendly error messages for common failures
  const error = content.schedulingError.toLowerCase();

  if (error.includes('unavailable') || error.includes('network')) {
    return 'Scheduling service is temporarily unavailable. Please try again later.';
  }

  if (error.includes('quota') || error.includes('rate limit')) {
    return 'API rate limit reached. Please try again in a few minutes.';
  }

  if (error.includes('invalid') || error.includes('time')) {
    return 'Invalid scheduling time. Please select a future date and time.';
  }

  if (error.includes('permission') || error.includes('unauthorized')) {
    return 'Instagram authorization expired. Please reconnect your account.';
  }

  // Return original error if no user-friendly version available
  return content.schedulingError;
}

/**
 * Format scheduled time for display
 */
function formatScheduledTime(scheduledAt: Date | string): string {
  const date = new Date(scheduledAt);
  return date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
