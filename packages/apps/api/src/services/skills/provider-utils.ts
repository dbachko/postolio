function normalizeProvider(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function getSupportedProviders(scopesJson: unknown): string[] {
  const scopes = asRecord(scopesJson);
  const providersRaw = Array.isArray(scopes.providers) ? scopes.providers : null;
  const providers = providersRaw
    ? providersRaw
        .map((item) => normalizeProvider(item))
        .filter((item): item is string => Boolean(item))
    : [];
  if (providers.length > 0) return Array.from(new Set(providers));

  const fallbackProvider = normalizeProvider(scopes.provider);
  return fallbackProvider ? [fallbackProvider] : [];
}

function getSelectedProvider(args: { configJson: unknown; scopesJson: unknown }): string | null {
  const config = asRecord(args.configJson);
  const selected = normalizeProvider(config.provider);
  if (selected) return selected;

  const supported = getSupportedProviders(args.scopesJson);
  return supported[0] || null;
}

export { asRecord, getSelectedProvider, getSupportedProviders, normalizeProvider };
