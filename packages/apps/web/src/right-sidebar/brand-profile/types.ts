export interface BrandTopic {
  value: string;
  count: number;
}

export interface BrandInferredStyle {
  emoji: string;
  title: string;
  description: string;
}

export interface BrandProfileOverlay {
  type: 'SEASONAL' | 'TRENDING' | 'CAMPAIGN';
  label?: string;
  createdAt?: string;
  expiresAt?: string;
  text?: { tone?: string[] };
  visual?: { palette?: string[] };
  topics?: BrandTopic[];
  source?: {
    effectEstimate?: number;
    method?: string;
  };
}

export interface BrandAnalysisProfile {
  brandId: string;
  version: number;
  createdAt: string;
  text?: { tone?: string[] };
  topics?: BrandTopic[];
  visual?: {
    palette?: string[];
    motifs?: string[];
    composition?: string[];
    inferredStyles?: BrandInferredStyle[];
  };
  overlays?: BrandProfileOverlay[];
  anchors?: { visual?: { palette?: string[] } };
}
