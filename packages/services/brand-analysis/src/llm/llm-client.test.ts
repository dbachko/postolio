import { describe, it, expect } from 'vitest';
import { invokeLLM, __setTestResponder, LlmValidationError } from './llm-client';

describe('invokeLLM', () => {
  it('retries once on LlmValidationError then succeeds', async () => {
    let called = 0;
    __setTestResponder(async () => {
      called++;
      if (called === 1) {
        throw new LlmValidationError('fail once');
      }
      return { ok: true } as unknown;
    });
    const res = await invokeLLM({ model: 'test', prompt: 'p' });
    expect((res as Record<string, unknown>).ok).toBe(true);
    __setTestResponder(null);
  });
});
