import type { Heatmap } from './types.js';

export function getGraphError(err: unknown): {
  code?: number;
  subcode?: number;
  type?: string;
  message?: string;
  fbtraceId?: string;
} | null {
  const maybeAny = err as any;
  const graphError = maybeAny?.response?.data?.error;
  if (!graphError || typeof graphError !== 'object') {
    return null;
  }

  return {
    code: typeof graphError.code === 'number' ? graphError.code : undefined,
    subcode: typeof graphError.error_subcode === 'number' ? graphError.error_subcode : undefined,
    type: typeof graphError.type === 'string' ? graphError.type : undefined,
    message: typeof graphError.message === 'string' ? graphError.message : undefined,
    fbtraceId: typeof graphError.fbtrace_id === 'string' ? graphError.fbtrace_id : undefined,
  };
}

export function getInsightsUnavailableNote(err: unknown): string {
  const graphError = getGraphError(err);
  const msg = (graphError?.message || '').toLowerCase();

  if (
    msg.includes('followers') &&
    (msg.includes('100 followers') || (msg.includes('at least 100') && msg.includes('followers')))
  ) {
    return 'Insights unavailable: requires ≥100 followers for `online_followers`';
  }

  if (msg.includes('incompatible') && msg.includes('metric') && msg.includes('type')) {
    return 'Insights unavailable: Instagram Graph API rejected the request parameters';
  }

  if (
    graphError?.code === 10 ||
    msg.includes('permissions error') ||
    msg.includes('permission') ||
    msg.includes('requires') ||
    msg.includes('scope')
  ) {
    return 'Insights unavailable: missing `instagram_manage_insights` permission (reconnect Instagram)';
  }

  return 'Insights unavailable: Instagram Graph API error';
}

export function emptyHeatmap(): Heatmap {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
}

export function normalizeHeatmap(hm: Heatmap): Heatmap {
  let max = 0;
  for (const row of hm) {
    for (const value of row) {
      if (value > max) {
        max = value;
      }
    }
  }
  if (max <= 0) {
    return hm.map((row) => row.map(() => 0));
  }
  return hm.map((row) => row.map((value) => +(value / max).toFixed(4)));
}

export function smoothHeatmap(hm: Heatmap): Heatmap {
  const rows = 7;
  const cols = 24;
  const out = emptyHeatmap();
  for (let day = 0; day < rows; day++) {
    for (let hour = 0; hour < cols; hour++) {
      let sum = 0;
      let count = 0;
      for (let dd = -1; dd <= 1; dd++) {
        for (let hh = -1; hh <= 1; hh++) {
          const rd = (day + dd + rows) % rows;
          const ch = (hour + hh + cols) % cols;
          sum += hm[rd][ch];
          count++;
        }
      }
      out[day][hour] = sum / count;
    }
  }
  return out;
}

export function smoothHeatmapHoursOnly(hm: Heatmap): Heatmap {
  const out = emptyHeatmap();
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const prev = hm[day][(hour + 23) % 24];
      const curr = hm[day][hour];
      const next = hm[day][(hour + 1) % 24];
      out[day][hour] = (prev + 2 * curr + next) / 4;
    }
  }
  return out;
}

export function parseOnlineFollowersDayValue(
  value: Record<string, number> | number[]
): number[] | null {
  if (Array.isArray(value) && value.length >= 24) {
    return Array.from({ length: 24 }, (_, hour) => Number(value[hour] ?? 0));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, number>;
    return Array.from({ length: 24 }, (_, hour) => Number(obj[String(hour)] ?? 0));
  }
  return null;
}
