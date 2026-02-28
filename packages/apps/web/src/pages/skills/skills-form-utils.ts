import {
  humanizeKey,
  type ObjectSchema,
  type SchemaProperty,
  toStringValue,
} from './skills-schema';

export function normalizeInputValueForSchema(value: unknown, schema: SchemaProperty): unknown {
  if (schema.type === 'number') {
    const raw = toStringValue(value).trim();
    if (!raw) {
      return undefined;
    }
    const numberValue = Number(raw);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }

  if (schema.type === 'boolean') {
    if (typeof value === 'boolean') {
      return value;
    }
    const raw = String(value || '')
      .trim()
      .toLowerCase();
    if (raw === 'true') {
      return true;
    }
    if (raw === 'false') {
      return false;
    }
    return undefined;
  }

  const raw = toStringValue(value);
  return raw.trim().length > 0 ? raw.trim() : undefined;
}

export function getInitialValuesForSchema(
  schema: ObjectSchema,
  sourceRaw: unknown
): Record<string, unknown> {
  const source =
    sourceRaw && typeof sourceRaw === 'object' ? (sourceRaw as Record<string, unknown>) : {};
  const values: Record<string, unknown> = {};

  for (const [key, property] of Object.entries(schema.properties)) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      values[key] = source[key];
      continue;
    }
    if (property.default !== undefined) {
      values[key] = property.default;
    }
  }

  return values;
}

export function validateRequiredFields(
  schema: ObjectSchema,
  values: Record<string, unknown>
): string[] {
  const missing: string[] = [];

  for (const key of schema.required) {
    const property = schema.properties[key] || {};
    const normalized = normalizeInputValueForSchema(values[key], property);
    if (normalized === undefined) {
      missing.push(property.title || humanizeKey(key) || key);
    }
  }

  return missing;
}

export function buildConfigPayload(
  schema: ObjectSchema,
  values: Record<string, unknown>
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const [key, property] of Object.entries(schema.properties)) {
    const normalized = normalizeInputValueForSchema(values[key], property);
    if (normalized !== undefined) {
      payload[key] = normalized;
    }
  }

  if (!schema.additionalProperties) {
    return payload;
  }

  for (const [key, value] of Object.entries(values)) {
    if (Object.prototype.hasOwnProperty.call(schema.properties, key)) {
      continue;
    }
    payload[key] = value;
  }

  return payload;
}
