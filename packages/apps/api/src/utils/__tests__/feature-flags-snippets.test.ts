import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isSnippetsEnabledForUser } from '../feature-flags.js';

const envSnapshot = {
  FEATURE_SNIPPETS_ENABLED: process.env.FEATURE_SNIPPETS_ENABLED,
  FEATURE_SNIPPETS_ALLOWLIST_EMAILS: process.env.FEATURE_SNIPPETS_ALLOWLIST_EMAILS,
  FEATURE_SNIPPETS_ALLOWLIST_USER_IDS: process.env.FEATURE_SNIPPETS_ALLOWLIST_USER_IDS,
};

describe('isSnippetsEnabledForUser', () => {
  beforeEach(() => {
    process.env.FEATURE_SNIPPETS_ENABLED = 'false';
    process.env.FEATURE_SNIPPETS_ALLOWLIST_EMAILS = '';
    process.env.FEATURE_SNIPPETS_ALLOWLIST_USER_IDS = '';
  });

  afterEach(() => {
    process.env.FEATURE_SNIPPETS_ENABLED = envSnapshot.FEATURE_SNIPPETS_ENABLED;
    process.env.FEATURE_SNIPPETS_ALLOWLIST_EMAILS = envSnapshot.FEATURE_SNIPPETS_ALLOWLIST_EMAILS;
    process.env.FEATURE_SNIPPETS_ALLOWLIST_USER_IDS =
      envSnapshot.FEATURE_SNIPPETS_ALLOWLIST_USER_IDS;
  });

  it('returns true when enabled globally', () => {
    process.env.FEATURE_SNIPPETS_ENABLED = 'true';

    expect(isSnippetsEnabledForUser({ userId: null, email: null })).toBe(true);
    expect(isSnippetsEnabledForUser({ userId: 'user-1', email: 'user@example.com' })).toBe(true);
  });

  it('returns true for allowlisted user IDs', () => {
    process.env.FEATURE_SNIPPETS_ENABLED = 'false';
    process.env.FEATURE_SNIPPETS_ALLOWLIST_USER_IDS = 'user-1, user-2';

    expect(isSnippetsEnabledForUser({ userId: 'user-1', email: null })).toBe(true);
    expect(isSnippetsEnabledForUser({ userId: 'user-3', email: null })).toBe(false);
  });

  it('returns true for allowlisted emails (case-insensitive)', () => {
    process.env.FEATURE_SNIPPETS_ENABLED = 'false';
    process.env.FEATURE_SNIPPETS_ALLOWLIST_EMAILS = 'User@Example.com other@example.com';

    expect(isSnippetsEnabledForUser({ userId: null, email: 'user@example.com' })).toBe(true);
    expect(isSnippetsEnabledForUser({ userId: null, email: 'nope@example.com' })).toBe(false);
  });
});
