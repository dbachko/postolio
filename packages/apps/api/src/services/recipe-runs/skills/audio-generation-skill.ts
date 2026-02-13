import { resolveOpenAIForSkill, type SkillRuntimeContext } from './runtime.js';
import type { SkillExecutionResult } from './index.js';

export async function executeAudioGenerationSkill(
  params: SkillRuntimeContext
): Promise<SkillExecutionResult> {
  const runtime = await resolveOpenAIForSkill(params.brandId, params.skillId);
  const input = params.input && typeof params.input === 'object' ? (params.input as any) : {};

  const text =
    typeof input.text === 'string' && input.text.trim().length > 0
      ? input.text.trim()
      : typeof input.prompt === 'string' && input.prompt.trim().length > 0
        ? input.prompt.trim()
        : '';
  if (!text) {
    throw new Error('audio_gen requires input.text (or input.prompt)');
  }

  const modelInput = typeof input.model === 'string' ? input.model.trim() : '';
  const model = modelInput || runtime.defaultModel || 'gpt-4o-mini-tts';
  const voiceRaw = typeof input.voice === 'string' ? input.voice.trim() : '';
  const voice =
    voiceRaw ||
    (typeof runtime.config.defaultVoice === 'string' &&
    runtime.config.defaultVoice.trim().length > 0
      ? runtime.config.defaultVoice.trim()
      : 'alloy');
  const formatRaw = typeof input.format === 'string' ? input.format.trim() : '';
  const format =
    formatRaw ||
    (typeof runtime.config.defaultFormat === 'string' &&
    runtime.config.defaultFormat.trim().length > 0
      ? runtime.config.defaultFormat.trim()
      : 'mp3');

  const speechApi = (runtime.client as any).audio?.speech;
  if (!speechApi || typeof speechApi.create !== 'function') {
    throw new Error('audio_gen provider openai is not supported by the current SDK/runtime');
  }

  const response = await speechApi.create({
    model,
    voice,
    input: text,
    format,
  });

  if (!response || typeof response.arrayBuffer !== 'function') {
    throw new Error('audio_gen did not return binary audio data');
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  const maxBytesRaw = runtime.config.maxOutputBytes;
  const maxOutputBytes =
    typeof maxBytesRaw === 'number' && Number.isFinite(maxBytesRaw) && maxBytesRaw > 0
      ? Math.floor(maxBytesRaw)
      : 800_000;
  if (audioBuffer.length > maxOutputBytes) {
    throw new Error(`audio_gen output exceeded maxOutputBytes (${maxOutputBytes})`);
  }

  return {
    output: {
      provider: runtime.provider,
      model,
      voice,
      format,
      bytes: audioBuffer.length,
      audioBase64: audioBuffer.toString('base64'),
    },
    provider: runtime.provider,
    mode: runtime.mode,
    model,
  };
}
