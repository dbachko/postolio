const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

function isSafePathSegment(seg: string): boolean {
  if (!seg) return false;
  if (FORBIDDEN_PATH_SEGMENTS.has(seg)) return false;
  return /^[a-zA-Z0-9_$-]+$/.test(seg);
}

export function getPathValue(ctx: Record<string, unknown>, rawPath: string): unknown {
  const path = String(rawPath || '').trim();
  if (!path) return undefined;

  const parts = path
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  if (!parts.every(isSafePathSegment)) return undefined;

  let cur: unknown = ctx;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function toTemplateString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function interpolateTemplateString(template: string, ctx: Record<string, unknown>): string {
  const raw = String(template ?? '');
  if (!raw.includes('{{')) return raw;

  return raw.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expr) => {
    const value = getPathValue(ctx, expr);
    return toTemplateString(value);
  });
}

export function interpolateUnknown(value: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    // If the entire string is a single template expression, preserve the underlying type.
    // This lets recipes pass structured values between steps without JSON string parsing.
    //
    // Example:
    //   { posts: '{{plan.posts}}' } -> posts becomes an array, not a string.
    const m = value.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
    if (m) {
      return getPathValue(ctx, m[1]);
    }
    return interpolateTemplateString(value, ctx);
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolateUnknown(item, ctx));
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      out[k] = interpolateUnknown(v, ctx);
    }
    return out;
  }

  return value;
}
