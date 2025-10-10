export interface BrandAnalysisRequestedDetail {
  brandId: string;
  requestedBy?: string;
  options?: Record<string, unknown>;
}

export interface BrandAnalysisCompletedDetail {
  brandId: string;
  profileId: string;
  profileVersion: number;
  createdAt: string;
}

export interface BrandAnalysisFailedDetail {
  brandId: string;
  jobId: string;
  errorCode?: string;
  errorMessage?: string;
}
