export const BRAND_STYLE_PROFILES_TABLE =
  process.env.BRAND_STYLE_PROFILES_TABLE || 'BrandStyleProfiles';
export const BRAND_ANALYSIS_JOBS_TABLE =
  process.env.BRAND_ANALYSIS_JOBS_TABLE || 'BrandAnalysisJobs';

export function profilePk(brandId: string): string {
  return `BRAND#${brandId}`;
}

export function profileSk(version: number): string {
  return `VERSION#${version.toString().padStart(6, '0')}`;
}

export function jobPk(jobId: string): string {
  return `JOB#${jobId}`;
}

export function jobSk(brandId: string): string {
  return `BRAND#${brandId}`;
}
