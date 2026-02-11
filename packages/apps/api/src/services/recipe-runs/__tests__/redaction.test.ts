import { describe, expect, it } from 'vitest';

import { redactSensitive } from '../redaction.js';

describe('recipe run redaction', () => {
  it('redacts sensitive keys recursively', () => {
    const out = redactSensitive({
      apiKey: 'sk-test',
      nested: {
        token: 't',
        ok: 'z',
      },
    }) as any;

    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.nested.token).toBe('[REDACTED]');
    expect(out.nested.ok).toBe('z');
  });

  it('truncates long strings', () => {
    const long = 'a'.repeat(1000);
    const out = redactSensitive({ ok: long }, { maxStringLength: 10 }) as any;
    expect(out.ok).toBe('aaaaaaaaaa…');
  });
});
