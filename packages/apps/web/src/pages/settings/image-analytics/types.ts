export interface ImageAnalyticsOverall {
  totalGenerated: number;
  totalCost: number;
  avgCostPerImage: number;
}

export interface ImageProviderStats {
  count: number;
  totalCost: number;
  avgCost: number;
  avgTime: number;
}

export interface ImageGenerationLog {
  id: string;
  provider: string;
  status: string;
  cost: number;
  generationTime: number;
  createdAt: string;
}

export interface ImageAnalyticsData {
  overall: ImageAnalyticsOverall;
  byProvider: Record<string, ImageProviderStats>;
  recentLogs: ImageGenerationLog[];
}
