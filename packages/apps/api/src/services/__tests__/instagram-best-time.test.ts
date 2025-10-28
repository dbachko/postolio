import { describe, it, expect } from 'vitest';
import { InstagramBestTimeService } from '../instagram-best-time.js';

describe('InstagramBestTimeService.rankTopWindows', () => {
  const svc = new InstagramBestTimeService();

  it('ranks top windows from a simple heatmap', () => {
    // Build a heatmap with a clear peak at Wed 10:00 and Fri 19:00
    const hm = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    hm[3][10] = 1.0; // Wednesday 10:00
    hm[5][19] = 0.9; // Friday 19:00
    const res = (svc as any).rankTopWindows(hm, 'UTC', 60, 2);
    expect(res).toHaveLength(2);
    expect(res[0].score).toBeCloseTo(1.0, 3);
    expect(res[1].score).toBeCloseTo(0.9, 3);
  });
});
