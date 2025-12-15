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

  it('returns multiple spaced windows per day', () => {
    // Create a heatmap where each day has two good slots (spaced apart).
    const hm = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0.1));
    for (let d = 0; d < 7; d++) {
      hm[d][3] = 1.0;
      hm[d][12] = 0.9;
    }

    const res = (svc as any).rankTopWindows(hm, 'UTC', 60, 14);
    expect(res).toHaveLength(14);

    const byDay = new Map<number, number[]>();
    for (const w of res) {
      const dt = new Date(w.startUTC);
      const day = dt.getUTCDay();
      const hour = dt.getUTCHours();
      const list = byDay.get(day) || [];
      list.push(hour);
      byDay.set(day, list);
    }

    // Expect 2 windows per weekday and at least 1 hour apart (default gap).
    for (const hours of byDay.values()) {
      expect(hours).toHaveLength(2);
      const [a, b] = hours.sort((x, y) => x - y);
      expect(Math.min(Math.abs(a - b), 24 - Math.abs(a - b))).toBeGreaterThanOrEqual(1);
    }
  });
});
