export type AnalysisTopic = { value: string; count: number };

export type AnalysisProfile = {
  brandId: string;
  version: number;
  createdAt: string;
  promptSetVersion?: string;
  text?: { tone?: string[] };
  topics?: AnalysisTopic[];
  visual?: { palette?: string[]; motifs?: string[]; composition?: string[] };
};

export type BrandAnalysisStatusState = 'none' | 'accepted' | 'running' | 'completed' | 'failed';

export type BrandAnalysisStatus = {
  state: BrandAnalysisStatusState;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

export type BrandAnalysisPanelProps = {
  brandId: string;
  triggerKey?: number;
};
