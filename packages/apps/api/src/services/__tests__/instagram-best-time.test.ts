import { describe, it, expect } from 'vitest';
import { InstagramBestTimeService } from '../instagram-best-time.js';

describe('InstagramBestTimeService.rankTopWindows', () => {
  const svc = new InstagramBestTimeService();

  it('ranks top windows from a simple heatmap', () => {
    // Build a heatmap with a clear peak at Wed 10:30 and Fri 19:30
    const hm = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    hm[3][10] = 1.0;
    hm[3][11] = 1.0;
    hm[5][19] = 0.9;
    hm[5][20] = 0.9;
    const res = (svc as any).rankTopWindows(hm, 'UTC', 30, 2);
    expect(res).toHaveLength(2);
    expect(res[0].score).toBeCloseTo(1.0, 3);
    expect(res[1].score).toBeCloseTo(0.9, 3);
    expect(new Date(res[0].startUTC).getUTCMinutes()).toBe(30);
  });

  it('returns multiple spaced windows per day', () => {
    // Create a heatmap where each day has two good slots (spaced apart).
    const hm = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0.1));
    for (let d = 0; d < 7; d++) {
      hm[d][3] = 1.0;
      hm[d][4] = 1.0;
      hm[d][12] = 0.9;
      hm[d][13] = 0.9;
    }

    const res = (svc as any).rankTopWindows(hm, 'UTC', 30, 14);
    expect(res).toHaveLength(14);

    const byDay = new Map<number, number[]>();
    for (const w of res) {
      const dt = new Date(w.startUTC);
      const day = dt.getUTCDay();
      const minutes = dt.getUTCHours() * 60 + dt.getUTCMinutes();
      const list = byDay.get(day) || [];
      list.push(minutes);
      byDay.set(day, list);
    }

    // Expect 2 windows per weekday and at least 1 hour apart (default gap).
    for (const times of byDay.values()) {
      expect(times).toHaveLength(2);
      const [a, b] = times.sort((x, y) => x - y);
      const diff = Math.abs(a - b);
      expect(Math.min(diff, 24 * 60 - diff)).toBeGreaterThanOrEqual(60);
    }
  });
});
