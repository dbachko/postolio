import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateThumbnail, parseFrameRate, probeVideo } from './ffmpeg.js';

describe('parseFrameRate', () => {
  it('parses fractions without evaluating them', () => {
    expect(parseFrameRate('30000/1001')).toBeCloseTo(29.97, 2);
    expect(parseFrameRate('25/1')).toBe(25);
    expect(parseFrameRate('0/0')).toBe(0);
    expect(parseFrameRate('process.exit(1)')).toBe(0);
    expect(parseFrameRate(undefined)).toBe(0);
  });
});

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)('with real ffmpeg', () => {
  let dir: string;
  let video: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'video-processor-'));
    video = join(dir, 'clip.mp4');
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=2:size=320x240:rate=25',
      video,
    ]);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads metadata', async () => {
    const probe = await probeVideo(video);

    expect(probe).toMatchObject({ width: 320, height: 240, fps: 25 });
    expect(probe.duration).toBeCloseTo(2, 0);
    expect(probe.bitrate).toBeGreaterThan(0);
  });

  it('writes a thumbnail to the requested path', async () => {
    const output = join(dir, 'thumb.jpg');

    await generateThumbnail(video, output, 1);

    expect(existsSync(output)).toBe(true);
    expect((await probeVideo(output)).width).toBe(1280);
  });

  it('rejects a file without a video stream', async () => {
    const audio = join(dir, 'audio.mp3');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=1', audio]);

    await expect(probeVideo(audio)).rejects.toThrow('No video stream');
  });
});
