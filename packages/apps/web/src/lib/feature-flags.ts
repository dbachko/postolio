import type { User } from '@/lib/api';

function parseList(value: string | undefined): string[] {
  return (value || '')
    .split(/[,\s;]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function parseBoolean(value: string | undefined, defaultValue = false): boolean {
  if (typeof value !== 'string') {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return defaultValue;
}

export function isMultiDestinationEnabled(user: User | null | undefined): boolean {
  const explicit = user?.featureFlags?.multiDestination;
  if (typeof explicit === 'boolean') {
    return explicit;
  }

  if (parseBoolean(import.meta.env.VITE_FEATURE_MULTI_DESTINATION, false)) {
    return true;
  }

  const normalizedEmail = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
  if (!normalizedEmail) {
    return false;
  }

  const allowlistedEmails = parseList(
    import.meta.env.VITE_FEATURE_MULTI_DESTINATION_ALLOWLIST_EMAILS
  );
  return allowlistedEmails.includes(normalizedEmail);
}

export function isInboxEnabled(user: User | null | undefined): boolean {
  const explicit = user?.featureFlags?.inbox;
  if (typeof explicit === 'boolean') {
    return explicit;
  }

  if (parseBoolean(import.meta.env.VITE_FEATURE_INBOX, false)) {
    return true;
  }

  const normalizedEmail = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
  if (!normalizedEmail) {
    return false;
  }

  const allowlistedEmails = parseList(import.meta.env.VITE_FEATURE_INBOX_ALLOWLIST_EMAILS);
  return allowlistedEmails.includes(normalizedEmail);
}

export function isSnippetsEnabled(user: User | null | undefined): boolean {
  const explicit = user?.featureFlags?.snippets;
  if (typeof explicit === 'boolean') {
    return explicit;
  }

  if (parseBoolean(import.meta.env.VITE_FEATURE_SNIPPETS, false)) {
    return true;
  }

  const normalizedEmail = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
  if (!normalizedEmail) {
    return false;
  }

  const allowlistedEmails = parseList(import.meta.env.VITE_FEATURE_SNIPPETS_ALLOWLIST_EMAILS);
  return allowlistedEmails.includes(normalizedEmail);
}

export function isRecipeDestinationUiEnabled(): boolean {
  return parseBoolean(import.meta.env.VITE_FEATURE_RECIPE_DESTINATIONS, false);
}
