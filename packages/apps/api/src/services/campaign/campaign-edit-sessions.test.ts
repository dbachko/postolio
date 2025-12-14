import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { CONCURRENT_EDIT_WINDOW_MS } from './campaign-constants.js';
import { checkConcurrentEdit, startEditSession } from './campaign-edit-sessions.js';

describe('campaign-edit-sessions (helpers)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns no conflict when no edit session exists', () => {
    expect(checkConcurrentEdit('campaign-no-session', 'user-a')).toEqual({ hasConflict: false });
  });

  it('returns no conflict for the same user', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    startEditSession('campaign-same-user', 'user-a');
    expect(checkConcurrentEdit('campaign-same-user', 'user-a')).toEqual({ hasConflict: false });
  });

  it('detects a conflict for a different user within the edit window', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    startEditSession('campaign-conflict', 'user-a');

    const result = checkConcurrentEdit('campaign-conflict', 'user-b');
    expect(result.hasConflict).toBe(true);
    expect(result.conflictUser).toBe('user-a');
    expect(result.warningMessage).toBeDefined();
  });

  it('treats old sessions as expired', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    startEditSession(
      'campaign-expired',
      'user-a',
      new Date(Date.now() - CONCURRENT_EDIT_WINDOW_MS - 1)
    );

    expect(checkConcurrentEdit('campaign-expired', 'user-b')).toEqual({ hasConflict: false });
  });
});
