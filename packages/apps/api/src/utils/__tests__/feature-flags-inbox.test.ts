import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isInboxEnabledForUser } from '../feature-flags.js';

const envSnapshot = {
  FEATURE_INBOX_ENABLED: process.env.FEATURE_INBOX_ENABLED,
  FEATURE_INBOX_ALLOWLIST_EMAILS: process.env.FEATURE_INBOX_ALLOWLIST_EMAILS,
  FEATURE_INBOX_ALLOWLIST_USER_IDS: process.env.FEATURE_INBOX_ALLOWLIST_USER_IDS,
};

describe('isInboxEnabledForUser', () => {
  beforeEach(() => {
    process.env.FEATURE_INBOX_ENABLED = 'false';
    process.env.FEATURE_INBOX_ALLOWLIST_EMAILS = '';
    process.env.FEATURE_INBOX_ALLOWLIST_USER_IDS = '';
  });

  afterEach(() => {
    process.env.FEATURE_INBOX_ENABLED = envSnapshot.FEATURE_INBOX_ENABLED;
    process.env.FEATURE_INBOX_ALLOWLIST_EMAILS = envSnapshot.FEATURE_INBOX_ALLOWLIST_EMAILS;
    process.env.FEATURE_INBOX_ALLOWLIST_USER_IDS = envSnapshot.FEATURE_INBOX_ALLOWLIST_USER_IDS;
  });

  it('returns true when enabled globally', () => {
    process.env.FEATURE_INBOX_ENABLED = 'true';

    expect(isInboxEnabledForUser({ userId: null, email: null })).toBe(true);
    expect(isInboxEnabledForUser({ userId: 'user-1', email: 'user@example.com' })).toBe(true);
  });

  it('returns true for allowlisted user IDs', () => {
    process.env.FEATURE_INBOX_ENABLED = 'false';
    process.env.FEATURE_INBOX_ALLOWLIST_USER_IDS = 'user-1, user-2';

    expect(isInboxEnabledForUser({ userId: 'user-1', email: null })).toBe(true);
    expect(isInboxEnabledForUser({ userId: 'user-3', email: null })).toBe(false);
  });

  it('returns true for allowlisted emails (case-insensitive)', () => {
    process.env.FEATURE_INBOX_ENABLED = 'false';
    process.env.FEATURE_INBOX_ALLOWLIST_EMAILS = 'User@Example.com other@example.com';

    expect(isInboxEnabledForUser({ userId: null, email: 'user@example.com' })).toBe(true);
    expect(isInboxEnabledForUser({ userId: null, email: 'nope@example.com' })).toBe(false);
  });
});
