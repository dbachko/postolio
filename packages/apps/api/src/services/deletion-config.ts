/**
 * Central configuration for account/data deletion recovery window.
 *
 * By default we use a 30-day recovery period, but this can be overridden
 * via the DATA_DELETION_RECOVERY_MINUTES environment variable.
 *
 * Example (for local testing with a 1-minute window):
 *   DATA_DELETION_RECOVERY_MINUTES=1
 */

const DEFAULT_RECOVERY_MINUTES = 30 * 24 * 60; // 30 days

function parseRecoveryMinutesFromEnv(): number | null {
  const raw = process.env.DATA_DELETION_RECOVERY_MINUTES;
  if (!raw) {
    return null;
  }
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) {
    return null;
  }
  return num;
}

const envMinutes = parseRecoveryMinutesFromEnv();

export const DELETION_RECOVERY_DELAY_MINUTES: number =
  envMinutes !== null ? envMinutes : DEFAULT_RECOVERY_MINUTES;

export const DELETION_RECOVERY_DELAY_MS: number = DELETION_RECOVERY_DELAY_MINUTES * 60 * 1000;
