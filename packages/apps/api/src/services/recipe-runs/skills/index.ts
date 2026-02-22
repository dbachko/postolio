import { executeAudioGenerationSkill } from './audio-generation-skill.js';
import { executeImageGenerationSkill } from './image-generation-skill.js';
import type { SkillRuntimeContext } from './runtime.js';
import { executeVideoGenerationSkill } from './video-generation-skill.js';
import { executeWebFetchSkill } from './web-fetch-skill.js';

export type SkillExecutionResult = {
  output: unknown;
  provider: string;
  mode: 'managed' | 'byok';
  model?: string | null;
};

export async function executeSkillCall(params: SkillRuntimeContext): Promise<SkillExecutionResult> {
  switch (params.skillId) {
    case 'web_fetch':
      return executeWebFetchSkill(params);
    case 'image_generation':
      return executeImageGenerationSkill(params);
    case 'video_gen':
      return executeVideoGenerationSkill(params);
    case 'audio_gen':
      return executeAudioGenerationSkill(params);
    default:
      throw new Error(`Unknown skill: ${params.skillId}`);
  }
}
