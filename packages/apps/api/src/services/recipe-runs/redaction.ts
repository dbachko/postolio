type RedactOptions = {
  maxStringLength?: number;
  maxDepth?: number;
};

const DEFAULT_MAX_STRING_LENGTH = 32_000;
const DEFAULT_MAX_DEPTH = 20;

const SENSITIVE_KEY_RE = /(apiKey|authorization|token|secret|password)/i;

export function redactSensitive(value: unknown, options: RedactOptions = {}): unknown {
  const maxStringLength = options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

  const walk = (v: unknown, depth: number): unknown => {
    if (depth > maxDepth) return '[TRUNCATED_DEPTH]';

    if (typeof v === 'string') {
      if (v.length <= maxStringLength) return v;
      return `${v.slice(0, maxStringLength)}…`;
    }

    if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;

    if (Array.isArray(v)) {
      return v.map((item) => walk(item, depth + 1));
    }

    if (typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(obj)) {
        if (SENSITIVE_KEY_RE.test(k)) {
          out[k] = '[REDACTED]';
          continue;
        }
        out[k] = walk(val, depth + 1);
      }
      return out;
    }

    return String(v);
  };

  return walk(value, 0);
}
