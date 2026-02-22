export interface UserFeatureFlags {
  multiDestination: boolean;
  inbox: boolean;
  snippets: boolean;
}

type UserIdentity = {
  userId?: string | null;
  email?: string | null;
};

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

function parseList(value: string | undefined): string[] {
  return (value || '')
    .split(/[,\s;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseLowercaseList(value: string | undefined): string[] {
  return parseList(value).map((entry) => entry.toLowerCase());
}

export function isMultiDestinationEnabledForUser(identity: UserIdentity): boolean {
  if (parseBoolean(process.env.FEATURE_MULTI_DESTINATION_ENABLED, false)) {
    return true;
  }

  const userId = typeof identity.userId === 'string' ? identity.userId.trim() : '';
  const email = typeof identity.email === 'string' ? identity.email.trim().toLowerCase() : '';

  if (userId) {
    const allowlistedUserIds = parseList(process.env.FEATURE_MULTI_DESTINATION_ALLOWLIST_USER_IDS);
    if (allowlistedUserIds.includes(userId)) {
      return true;
    }
  }

  if (email) {
    const allowlistedEmails = parseLowercaseList(
      process.env.FEATURE_MULTI_DESTINATION_ALLOWLIST_EMAILS
    );
    if (allowlistedEmails.includes(email)) {
      return true;
    }
  }

  return false;
}

export function isInboxEnabledForUser(identity: UserIdentity): boolean {
  if (parseBoolean(process.env.FEATURE_INBOX_ENABLED, false)) {
    return true;
  }

  const userId = typeof identity.userId === 'string' ? identity.userId.trim() : '';
  const email = typeof identity.email === 'string' ? identity.email.trim().toLowerCase() : '';

  if (userId) {
    const allowlistedUserIds = parseList(process.env.FEATURE_INBOX_ALLOWLIST_USER_IDS);
    if (allowlistedUserIds.includes(userId)) {
      return true;
    }
  }

  if (email) {
    const allowlistedEmails = parseLowercaseList(process.env.FEATURE_INBOX_ALLOWLIST_EMAILS);
    if (allowlistedEmails.includes(email)) {
      return true;
    }
  }

  return false;
}

export function isSnippetsEnabledForUser(identity: UserIdentity): boolean {
  if (parseBoolean(process.env.FEATURE_SNIPPETS_ENABLED, false)) {
    return true;
  }

  const userId = typeof identity.userId === 'string' ? identity.userId.trim() : '';
  const email = typeof identity.email === 'string' ? identity.email.trim().toLowerCase() : '';

  if (userId) {
    const allowlistedUserIds = parseList(process.env.FEATURE_SNIPPETS_ALLOWLIST_USER_IDS);
    if (allowlistedUserIds.includes(userId)) {
      return true;
    }
  }

  if (email) {
    const allowlistedEmails = parseLowercaseList(process.env.FEATURE_SNIPPETS_ALLOWLIST_EMAILS);
    if (allowlistedEmails.includes(email)) {
      return true;
    }
  }

  return false;
}

export function getUserFeatureFlags(identity: UserIdentity): UserFeatureFlags {
  return {
    multiDestination: isMultiDestinationEnabledForUser(identity),
    inbox: isInboxEnabledForUser(identity),
    snippets: isSnippetsEnabledForUser(identity),
  };
}
