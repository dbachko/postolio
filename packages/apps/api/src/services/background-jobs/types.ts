export enum JobType {
  TOKEN_CLEANUP = 'token-cleanup',
  TOKEN_MIGRATION = 'token-migration',
  TOKEN_INTEGRITY_CHECK = 'token-integrity-check',
  AUDIT_LOG_CLEANUP = 'audit-log-cleanup',
  PUBLISHING_QUEUE_WINDOW_MAINTENANCE = 'publishing-queue-window-maintenance',
  NOTIFICATION_RETENTION = 'notification-retention',
  INBOX_COMMENTS_INGEST = 'inbox-comments-ingest',
  INBOX_COMMENTS_BACKFILL = 'inbox-comments-backfill',
  INBOX_DMS_INGEST = 'inbox-dms-ingest',
  RECIPE_RUN_EXECUTE = 'recipe-run-execute',
}

export interface JobData {
  type: JobType;
  metadata?: Record<string, unknown>;
}

export interface CleanupResult {
  deletedCount: number;
  duration: number;
  errors?: string[];
}
