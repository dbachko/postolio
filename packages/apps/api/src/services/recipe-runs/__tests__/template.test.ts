import { describe, expect, it } from 'vitest';

import { getPathValue, interpolateTemplateString, interpolateUnknown } from '../template.js';

describe('recipe run template helpers', () => {
  it('resolves dotted paths', () => {
    const ctx = { input: { brief: 'Hello' }, hooks: 'abc' } as any;
    expect(getPathValue(ctx, 'input.brief')).toBe('Hello');
    expect(getPathValue(ctx, 'hooks')).toBe('abc');
    expect(getPathValue(ctx, 'missing')).toBeUndefined();
  });

  it('blocks unsafe path segments', () => {
    const ctx = { ok: { value: 1 } } as any;
    expect(getPathValue(ctx, '__proto__')).toBeUndefined();
    expect(getPathValue(ctx, 'constructor.prototype')).toBeUndefined();
  });

  it('interpolates template strings', () => {
    const ctx = { input: { brief: 'Hello' } } as any;
    expect(interpolateTemplateString('Test {{input.brief}}', ctx)).toBe('Test Hello');
  });

  it('interpolates nested structures', () => {
    const ctx = { input: { brief: 'Hello' } } as any;
    const out = interpolateUnknown({ a: '{{input.brief}}', b: ['x', '{{input.brief}}'] }, ctx);
    expect(out).toEqual({ a: 'Hello', b: ['x', 'Hello'] });
  });

  it('preserves non-string types for full expression templates', () => {
    const ctx = { plan: { posts: [{ caption: 'A' }, { caption: 'B' }], count: 2 } } as any;

    expect(interpolateUnknown('{{plan.count}}', ctx)).toBe(2);
    expect(interpolateUnknown({ posts: '{{plan.posts}}' }, ctx)).toEqual({
      posts: [{ caption: 'A' }, { caption: 'B' }],
    });

    // Mixed strings still stringify.
    expect(interpolateUnknown('count={{plan.count}}', ctx)).toBe('count=2');
  });
});
