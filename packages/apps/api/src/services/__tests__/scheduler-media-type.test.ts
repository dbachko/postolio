import { describe, it, expect } from 'vitest';
import { determineMediaType } from '../scheduler-adapter.js';

describe('determineMediaType', () => {
  it('returns video when mediaType is explicitly video even if extension looks image', () => {
    expect(determineMediaType('https://cdn.test/path/photo.jpg', 'post', 'video')).toBe('video');
  });

  it('returns video when the path/extension is a video while mediaType is image (carousel child)', () => {
    expect(determineMediaType('https://cdn.test/path/clip.mp4', 'post', 'image')).toBe('video');
  });

  it('returns image when mediaType is image and the path is image', () => {
    expect(determineMediaType('https://cdn.test/path/photo.jpg', 'post', 'image')).toBe('image');
  });

  it('returns video for reel assets when the path is video', () => {
    expect(determineMediaType('https://cdn.test/path/reel.mov', 'reel', undefined)).toBe('video');
  });

  it('defaults to image when no hints and no video extension', () => {
    expect(determineMediaType('https://cdn.test/path/asset.png', 'post', undefined)).toBe('image');
  });
});
