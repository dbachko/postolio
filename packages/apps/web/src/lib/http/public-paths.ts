const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/register',
  '/auth/',
  '/password/',
  '/privacy-policy',
  '/terms-of-service',
  '/pricing',
  '/legal/',
  '/account/recover',
];

/** Pages a signed-out visitor may stay on; everything else is behind ProtectedRoute. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) =>
      pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)
  );
}
