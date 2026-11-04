import { describe, expect, it } from 'vitest';
import { isPublicPath } from './public-paths';

describe('isPublicPath', () => {
  it.each([
    '/login',
    '/register',
    '/auth/magic-link',
    '/auth/verify-email',
    '/password/reset',
    '/privacy-policy',
    '/terms-of-service',
    '/pricing',
    '/legal/data-deletion',
    '/account/recover',
  ])('treats %s as public', (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each(['/dashboard', '/posts/create', '/settings/account', '/account', '/loginx', '/'])(
    'treats %s as protected',
    (path) => {
      expect(isPublicPath(path)).toBe(false);
    }
  );
});
