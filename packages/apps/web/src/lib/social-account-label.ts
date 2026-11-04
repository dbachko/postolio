export function formatSocialAccountHandle(
  platform: string | null | undefined,
  username: string | null | undefined
): string | null {
  const raw = typeof username === 'string' ? username.trim() : '';
  if (!raw) {
    return null;
  }

  const normalized = raw.replace(/^@+/, '');
  const p = typeof platform === 'string' ? platform.trim().toLowerCase() : '';

  // Display Instagram handles without the @ prefix.
  if (p === 'instagram') {
    return normalized;
  }

  return `@${normalized}`;
}

export function formatSocialAccountLabel(params: {
  platform: string | null | undefined;
  username: string | null | undefined;
  displayName?: string | null | undefined;
}): string {
  const handle = formatSocialAccountHandle(params.platform, params.username);
  if (handle) {
    return handle;
  }
  const dn = typeof params.displayName === 'string' ? params.displayName.trim() : '';
  if (dn) {
    return dn;
  }
  const p = typeof params.platform === 'string' ? params.platform.trim() : '';
  return p || 'Unknown';
}
