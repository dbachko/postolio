export type SchemaProperty = {
  type?: string;
  title?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  placeholder?: string;
  secret?: boolean;
};

export type ObjectSchema = {
  properties: Record<string, SchemaProperty>;
  required: Set<string>;
  additionalProperties: boolean;
};

export type SkillExample = {
  title: string;
  input?: unknown;
  description?: string;
};

export type ProviderSkillMeta = {
  label?: string;
  docs?: string;
  docsUrl?: string;
  examples: SkillExample[];
  secretSchema?: unknown;
  configSchema?: unknown;
  tryEnabled?: boolean;
  trySampleInput?: unknown;
};

export type SkillMeta = {
  provider?: string;
  providers: string[];
  providerDetails: Record<string, ProviderSkillMeta>;
  tags: string[];
  docs?: string;
  docsUrl?: string;
  examples: SkillExample[];
  secretSchema?: unknown;
  tryEnabled: boolean;
  trySampleInput?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function normalizeProviderId(value: unknown): string | null {
  if (!isNonEmptyString(value)) {
    return null;
  }
  return value.trim().toLowerCase();
}

export function humanizeKey(raw: string): string {
  const value = String(raw || '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!value) {
    return '';
  }
  return value.replace(/\b\w/g, (chunk) => chunk.toUpperCase());
}

export function toStringValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function extractExamplePrompt(value: unknown): string | null {
  if (typeof value === 'string') {
    const prompt = value.trim();
    return prompt.length > 0 ? prompt : null;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const promptKeys = ['prompt', 'instruction', 'task', 'query', 'url'];
  for (const key of promptKeys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  const serialized = safeStringify(value);
  return serialized.trim().length > 0 ? serialized : null;
}

export function parseObjectSchema(schemaRaw: unknown): ObjectSchema {
  const schema = asRecord(schemaRaw);
  const propertiesRaw = asRecord(schema.properties);
  const requiredRaw = Array.isArray(schema.required) ? schema.required : [];
  const required = new Set(
    requiredRaw.filter((key): key is string => typeof key === 'string' && key.trim().length > 0)
  );

  const properties: Record<string, SchemaProperty> = {};
  for (const [key, value] of Object.entries(propertiesRaw)) {
    const prop = asRecord(value);
    properties[key] = {
      type: typeof prop.type === 'string' ? prop.type : undefined,
      title: typeof prop.title === 'string' ? prop.title : undefined,
      description: typeof prop.description === 'string' ? prop.description : undefined,
      enum: Array.isArray(prop.enum) ? prop.enum : undefined,
      default: prop.default,
      placeholder: typeof prop.placeholder === 'string' ? prop.placeholder : undefined,
      secret: prop.secret === true,
    };
  }

  return {
    properties,
    required,
    additionalProperties: schema.additionalProperties !== false,
  };
}

function parseExamples(examplesRaw: unknown): SkillExample[] {
  if (!Array.isArray(examplesRaw)) {
    return [];
  }

  return examplesRaw
    .map((item) => asRecord(item))
    .filter((item) => isNonEmptyString(item.title))
    .map((item) => ({
      title: String(item.title),
      input: item.input,
      description: isNonEmptyString(item.description) ? String(item.description) : undefined,
    }));
}

function parseProviderDetails(metaRaw: Record<string, unknown>): Record<string, ProviderSkillMeta> {
  const providerDetailsRaw = asRecord(metaRaw.providerDetails);
  const providerDetails: Record<string, ProviderSkillMeta> = {};

  for (const [providerKey, detailRaw] of Object.entries(providerDetailsRaw)) {
    const providerId = normalizeProviderId(providerKey);
    if (!providerId) {
      continue;
    }

    const detail = asRecord(detailRaw);
    const detailTry = asRecord(detail.try);
    providerDetails[providerId] = {
      label: isNonEmptyString(detail.label) ? String(detail.label) : undefined,
      docs: isNonEmptyString(detail.docs) ? String(detail.docs) : undefined,
      docsUrl: isNonEmptyString(detail.docsUrl) ? String(detail.docsUrl) : undefined,
      examples: parseExamples(detail.examples),
      secretSchema: detail.secretSchema,
      configSchema: detail.configSchema,
      tryEnabled: typeof detailTry.enabled === 'boolean' ? detailTry.enabled : undefined,
      trySampleInput: detailTry.sampleInput,
    };
  }

  return providerDetails;
}

export function parseSkillMeta(scopesJson: unknown): SkillMeta {
  const meta = asRecord(scopesJson);
  const provider = normalizeProviderId(meta.provider) ?? undefined;
  const providersRaw = Array.isArray(meta.providers) ? meta.providers : [];
  const providersFromList = providersRaw
    .map((item) => normalizeProviderId(item))
    .filter((item): item is string => Boolean(item));
  const providers = Array.from(new Set([...providersFromList, ...(provider ? [provider] : [])]));

  const tags = Array.isArray(meta.tags)
    ? meta.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
    : [];
  const tryRaw = asRecord(meta.try);

  return {
    provider,
    providers,
    providerDetails: parseProviderDetails(meta),
    tags,
    docs: isNonEmptyString(meta.docs) ? String(meta.docs) : undefined,
    docsUrl: isNonEmptyString(meta.docsUrl) ? String(meta.docsUrl) : undefined,
    examples: parseExamples(meta.examples),
    secretSchema: meta.secretSchema,
    tryEnabled: tryRaw.enabled !== false,
    trySampleInput: tryRaw.sampleInput,
  };
}
