import { describe, expect, it } from 'vitest';
import { registerSchema } from './auth.js';

const base = { email: 'user@example.com', password: 'Correct-Horse-9-Battery!' };

describe('registerSchema name', () => {
  it.each(['', '   '])('treats blank name %j as absent', (name) => {
    expect(registerSchema.parse({ ...base, name }).name).toBeUndefined();
  });

  it('keeps and trims a real name', () => {
    expect(registerSchema.parse({ ...base, name: '  Ada  ' }).name).toBe('Ada');
  });

  it('still rejects an overlong name', () => {
    expect(registerSchema.safeParse({ ...base, name: 'x'.repeat(101) }).success).toBe(false);
  });
});
