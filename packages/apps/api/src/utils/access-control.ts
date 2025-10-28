export type SignupMode = 'open' | 'closed' | 'allowlist' | 'invite_only';

export function getSignupMode(): SignupMode {
  const v = (process.env.AUTH_SIGNUPS_MODE || 'open').toLowerCase();
  if (v === 'closed' || v === 'allowlist' || v === 'invite_only') return v as SignupMode;
  return 'open';
}

function parseCsv(env?: string): string[] {
  return (env || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailAllowlisted(email: string): boolean {
  const list = parseCsv(process.env.AUTH_ALLOWLIST_EMAILS);
  const e = email.toLowerCase();
  return list.includes(e);
}

export function signupsAllowedForEmail(
  email: string
): { allowed: true } | { allowed: false; code: string; message: string; waitlistUrl?: string } {
  const mode = getSignupMode();
  const waitlistUrl = process.env.WAITLIST_URL || process.env.WAITLIST_SIGNUP_URL;
  if (mode === 'open') return { allowed: true };
  if (mode === 'closed') {
    return {
      allowed: false,
      code: 'SIGNUPS_DISABLED',
      message:
        'Signups are currently closed. Join the waitlist to request early access.' +
        (waitlistUrl ? ` ${waitlistUrl}` : ''),
      waitlistUrl,
    };
  }
  if (mode === 'allowlist') {
    if (isEmailAllowlisted(email)) return { allowed: true };
    return {
      allowed: false,
      code: 'NOT_INVITED',
      message:
        'This email is not yet allowlisted. Request an invite to join the waitlist.' +
        (waitlistUrl ? ` ${waitlistUrl}` : ''),
      waitlistUrl,
    };
  }
  if (mode === 'invite_only') {
    return {
      allowed: false,
      code: 'INVITE_REQUIRED',
      message:
        'Registration requires an invite. Use your invite link or request access.' +
        (waitlistUrl ? ` ${waitlistUrl}` : ''),
      waitlistUrl,
    };
  }
  return { allowed: true };
}
