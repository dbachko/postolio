import { describe, expect, it } from 'vitest';

import { evalWhen } from '../when.js';

describe('recipe run when evaluator', () => {
  it('handles null comparisons and wrappers', () => {
    const ctx = { input: { url: 'https://example.com' } } as any;
    expect(evalWhen('input.url != null', ctx)).toBe(true);
    expect(evalWhen('{{input.url != null}}', ctx)).toBe(true);
    expect(evalWhen('input.missing == null', ctx)).toBe(true);
  });

  it('handles truthy checks and negation', () => {
    const ctx = { input: { empty: '', present: 'x' } } as any;
    expect(evalWhen('input.empty', ctx)).toBe(false);
    expect(evalWhen('!input.empty', ctx)).toBe(true);
    expect(evalWhen('input.present', ctx)).toBe(true);
  });

  it('handles && and ||', () => {
    const ctx = { input: { url: 'https://example.com', empty: '' } } as any;
    expect(evalWhen('input.url && !input.empty', ctx)).toBe(true);
    expect(evalWhen('input.missing || input.url', ctx)).toBe(true);
  });
});
