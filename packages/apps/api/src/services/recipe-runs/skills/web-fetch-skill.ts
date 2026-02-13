import { webFetch } from './web-fetch.js';
import { resolveInstalledSkillRuntime, type SkillRuntimeContext } from './runtime.js';
import type { SkillExecutionResult } from './index.js';

export async function executeWebFetchSkill(
  params: SkillRuntimeContext
): Promise<SkillExecutionResult> {
  const runtime = await resolveInstalledSkillRuntime(params.brandId, params.skillId);
  const maxBytesCandidate = runtime.config.maxBytes;
  const maxBytes = typeof maxBytesCandidate === 'number' ? maxBytesCandidate : undefined;

  const url = params.input && typeof params.input === 'object' ? (params.input as any).url : null;
  if (!url || typeof url !== 'string') {
    throw new Error('web_fetch requires input.url');
  }

  const res = await webFetch({ url }, { maxBytes });
  return {
    output: res.text,
    provider: runtime.provider,
    mode: runtime.mode,
  };
}
