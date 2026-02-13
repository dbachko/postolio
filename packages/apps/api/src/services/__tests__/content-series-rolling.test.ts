import { describe, expect, it } from 'vitest';

import {
  normalizeSeriesGeneratorSource,
  normalizeSeriesRollingConfig,
} from '../content-series-rolling.js';

describe('content-series-rolling config normalization', () => {
  it('normalizes and bounds rolling config values', () => {
    const config = normalizeSeriesRollingConfig({
      enabled: true,
      minQueueDays: -1,
      targetQueueDays: 2,
      maxQueueDays: 1,
      batchSize: 999,
    });

    expect(config.enabled).toBe(true);
    expect(config.minQueueDays).toBe(1);
    expect(config.targetQueueDays).toBe(2);
    expect(config.maxQueueDays).toBe(2);
    expect(config.batchSize).toBe(2);
  });

  it('falls back to defaults when config is missing', () => {
    const config = normalizeSeriesRollingConfig(undefined);
    expect(config).toEqual({
      enabled: false,
      minQueueDays: 3,
      targetQueueDays: 7,
      maxQueueDays: 14,
      batchSize: 3,
    });
  });
});

describe('content-series-rolling generator normalization', () => {
  it('returns null for invalid source payloads', () => {
    expect(normalizeSeriesGeneratorSource(null)).toBeNull();
    expect(normalizeSeriesGeneratorSource({ source: 'recipe' })).toBeNull();
  });

  it('parses valid recipe source payload', () => {
    const normalized = normalizeSeriesGeneratorSource({
      source: 'recipe',
      recipeTemplateId: 'recipe-1',
      recipeTemplateVersionId: 'version-1',
      inputJson: { topic: 'launch' },
      createdFromRunId: 'run-1',
    });

    expect(normalized).toEqual({
      source: 'recipe',
      recipeTemplateId: 'recipe-1',
      recipeTemplateVersionId: 'version-1',
      inputJson: { topic: 'launch' },
      createdFromRunId: 'run-1',
    });
  });
});
