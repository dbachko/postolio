// Instagram Best Time Recommendation
export interface BestTimeWindow {
  startLocal: string; // ISO with offset
  startUTC: string; // ISO UTC
  durationMinutes: number;
  score: number; // 0..1
  explanation?: string;
}

export interface BestTimePayload {
  brandId: string;
  platform: 'instagram';
  timezone: string;
  source: 'instagram_insights' | 'history' | 'heuristic';
  confidence: number; // 0..1
  generatedAt: string; // ISO
  ttlSeconds: number;
  heatmap: number[][]; // 7x24 normalized values
  topWindows: BestTimeWindow[];
  notes?: string[];
}

export interface BestTimeStatus {
  cacheTTL: number;
  cached: boolean;
  source?: BestTimePayload['source'];
  confidence?: number;
  generatedAt?: string;
  nextRefreshAt?: string | null;
}
