export const DEFAULT_SAMPLE_SIZE = 20;
export const MAX_SAMPLE_SIZE = 50;

export interface SamplingConfig {
  size: number;
  max: number;
}

export const samplingConfig: SamplingConfig = {
  size: Number(process.env.BRAND_ANALYSIS_MAX_POSTS || DEFAULT_SAMPLE_SIZE),
  max: Number(process.env.BRAND_ANALYSIS_MAX_POSTS_EXPAND || MAX_SAMPLE_SIZE),
};
