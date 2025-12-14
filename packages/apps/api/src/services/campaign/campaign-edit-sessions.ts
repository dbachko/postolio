import { CONCURRENT_EDIT_WINDOW_MS } from './campaign-constants.js';

// In-memory store for edit sessions (in production, this would be Redis or database)
const editSessions = new Map<string, { userId: string; startedAt: Date }>();

export function startEditSession(campaignId: string, userId: string, customStartTime?: Date): void {
  const startTime = customStartTime || new Date();
  editSessions.set(campaignId, { userId, startedAt: startTime });
}

export function checkConcurrentEdit(
  campaignId: string,
  userId: string
): {
  hasConflict: boolean;
  conflictUser?: string;
  warningMessage?: string;
} {
  const session = editSessions.get(campaignId);

  if (!session) {
    return { hasConflict: false };
  }

  // If it's the same user, no conflict
  if (session.userId === userId) {
    return { hasConflict: false };
  }

  // Check if the edit session is within the configured window
  const windowStart = new Date(Date.now() - CONCURRENT_EDIT_WINDOW_MS);

  if (session.startedAt > windowStart) {
    return {
      hasConflict: true,
      conflictUser: session.userId,
      warningMessage:
        'This campaign is currently being edited by another user. Please wait or refresh to see latest changes.',
    };
  }

  // Session expired, remove it
  editSessions.delete(campaignId);
  return { hasConflict: false };
}
