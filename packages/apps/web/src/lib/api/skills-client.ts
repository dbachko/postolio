import type { HttpRequest } from '../http/http';

export type SkillModeSupported = 'managed' | 'byok' | 'both';
export type SkillMode = 'managed' | 'byok';

export type SkillInstallationSummary = {
  id: string;
  enabled: boolean;
  mode: SkillMode;
  configJson: unknown;
  hasSecret: boolean;
};

export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  modeSupported: SkillModeSupported;
  scopesJson: unknown;
  configSchemaJson: unknown;
  installation: SkillInstallationSummary | null;
};

export class SkillsClient {
  constructor(private request: HttpRequest) {}

  listSkills(brandId: string) {
    const qp = new URLSearchParams({ brandId });
    return this.request(`/api/skills?${qp.toString()}`) as Promise<{ skills: SkillSummary[] }>;
  }

  install(
    skillId: string,
    body: { brandId: string; mode: SkillMode; config?: unknown; secret?: { apiKey: string } }
  ) {
    return this.request(`/api/skills/${encodeURIComponent(skillId)}/install`, {
      method: 'POST',
      body: JSON.stringify(body),
    }) as Promise<{ installationId: string; enabled: boolean }>;
  }

  toggle(installationId: string, enabled: boolean) {
    return this.request(`/api/skills/${encodeURIComponent(installationId)}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }) as Promise<{ id: string; enabled: boolean }>;
  }
}
