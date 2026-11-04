import { describe, expect, it } from 'vitest';
import { calculateOpenAIImageCost } from '../openai-image.js';

describe('calculateOpenAIImageCost', () => {
  it('prices text input, image input and image output tokens', () => {
    const cost = calculateOpenAIImageCost({
      input_tokens_details: { text_tokens: 1000, image_tokens: 1000 },
      output_tokens: 1000,
    });

    expect(cost).toBeCloseTo((5 + 8 + 30) / 1000, 6);
  });

  it('returns undefined when the response has no usage', () => {
    expect(calculateOpenAIImageCost(undefined)).toBeUndefined();
  });
});
