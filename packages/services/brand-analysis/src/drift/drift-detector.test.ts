import { describe, it, expect } from 'vitest';
import { jaccard, detectDrift } from './drift-detector';

describe('drift-detector', () => {
  it('computes jaccard', () => {
    expect(jaccard(['a', 'b'], ['b', 'c'])).toBeGreaterThan(0);
  });

  it('detects palette drift', () => {
    const findings = detectDrift(
      { visual: { palette: ['#000', '#111'] }, text: { tone: ['bold'] } },
      { visual: { palette: ['#fff'] }, text: { tone: ['bold', 'warm'] } }
    );
    expect(findings.length).toBeGreaterThan(0);
  });
});
