import { describe, it, expect } from 'vitest';
import { deriveScheduleMediaType } from '../scheduler-adapter.js';

describe('deriveScheduleMediaType', () => {
  it('returns video for reels', () => {
    expect(deriveScheduleMediaType('reel', [])).toBe('video');
  });

  it('returns video for a single video asset', () => {
    expect(deriveScheduleMediaType('post', [{ type: 'video' }])).toBe('video');
  });

  it('returns image for image posts by default', () => {
    expect(deriveScheduleMediaType('post', [{ type: 'image' }])).toBe('image');
  });

  it('returns image for carousels of images', () => {
    expect(deriveScheduleMediaType('post', [{ type: 'image' }, { type: 'image' }])).toBe('image');
  });

  it('defaults to image when no assets', () => {
    expect(deriveScheduleMediaType('post', [])).toBe('image');
  });
});
