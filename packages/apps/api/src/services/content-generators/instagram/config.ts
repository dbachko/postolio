type SamplingConfig = {
  captionTemperature: number;
  presencePenalty: number;
  frequencyPenalty: number;
  topP: number;
};

function parseEnvFloat(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getInstagramSamplingConfig(): SamplingConfig {
  const captionTemperature = parseEnvFloat(process.env.LLM_CAPTION_TEMPERATURE) ?? 0.95;
  const presencePenalty = parseEnvFloat(process.env.LLM_PRESENCE_PENALTY) ?? 0.6;
  const frequencyPenalty = parseEnvFloat(process.env.LLM_FREQUENCY_PENALTY) ?? 0.5;
  const topP = parseEnvFloat(process.env.LLM_TOP_P) ?? 0.9;

  const config: SamplingConfig = {
    captionTemperature,
    presencePenalty,
    frequencyPenalty,
    topP,
  };

  return config;
}
