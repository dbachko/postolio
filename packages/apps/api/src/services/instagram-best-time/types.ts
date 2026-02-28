export type Heatmap = number[][];

export interface BestTimePayload {
  brandId: string;
  platform: 'instagram';
  timezone: string;
  source: 'instagram_insights' | 'history' | 'heuristic';
  confidence: number;
  generatedAt: string;
  ttlSeconds: number;
  heatmap: Heatmap;
  topWindows: Array<{
    startLocal: string;
    startUTC: string;
    durationMinutes: number;
    score: number;
    explanation?: string;
  }>;
  notes?: string[];
}

export const DEFAULT_TTL = parseInt(process.env.BEST_TIME_TTL_SECONDS || '86400', 10);
export const FB_GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || 'v24.0';
export const DEFAULT_SLOTS_PER_DAY = parseInt(process.env.BEST_TIME_SLOTS_PER_DAY || '2', 10);
export const DEFAULT_MIN_GAP_HOURS = parseInt(process.env.BEST_TIME_MIN_GAP_HOURS || '1', 10);
export const DEFAULT_WINDOW_MINUTES = parseInt(process.env.BEST_TIME_WINDOW_MINUTES || '30', 10);
