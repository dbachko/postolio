import {
  AudioLines,
  Bot,
  Cpu,
  Globe,
  Image as ImageIcon,
  Sparkles,
  Video,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export type SkillIconSource = {
  id?: string | null;
  icon?: string | null;
  name?: string | null;
  provider?: string | null;
  scopesJson?: unknown;
};

function normalizeProvider(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function parseProvider(scopesJson: unknown): string | null {
  if (!scopesJson || typeof scopesJson !== 'object') {
    return null;
  }
  const provider = (scopesJson as Record<string, unknown>).provider;
  return normalizeProvider(provider);
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function iconFromKey(keyRaw: string): LucideIcon | null {
  const key = keyRaw.trim().toLowerCase();
  if (!key) {
    return null;
  }

  const exactIconMap: Record<string, LucideIcon> = {
    text_generation: Sparkles,
    image_generation: ImageIcon,
    video_gen: Video,
    audio_gen: AudioLines,
    web_fetch: Globe,
  };
  const exactIcon = exactIconMap[key];
  if (exactIcon) {
    return exactIcon;
  }

  const partialMatchers: Array<{ terms: string[]; icon: LucideIcon }> = [
    { terms: ['openai'], icon: Bot },
    { terms: ['video'], icon: Video },
    { terms: ['audio', 'tts', 'voice'], icon: AudioLines },
    { terms: ['image'], icon: ImageIcon },
    { terms: ['fetch', 'web', 'http'], icon: Globe },
    { terms: ['internal'], icon: Wrench },
    { terms: ['replicate'], icon: Cpu },
  ];
  for (const matcher of partialMatchers) {
    if (matcher.terms.some((term) => key.includes(term))) {
      return matcher.icon;
    }
  }

  return null;
}

export function resolveSkillIcon(source: SkillIconSource): LucideIcon {
  const fromIconField = source.icon ? iconFromKey(source.icon) : null;
  if (fromIconField) {
    return fromIconField;
  }

  const fromId = source.id ? iconFromKey(source.id) : null;
  if (fromId) {
    return fromId;
  }

  const provider = normalizeProvider(source.provider) || parseProvider(source.scopesJson);
  if (provider === 'openai') {
    return Bot;
  }
  if (provider === 'internal') {
    return Wrench;
  }
  if (provider === 'replicate') {
    return Cpu;
  }
  if (provider) {
    return Cpu;
  }

  return Sparkles;
}

export function getSkillProviderLabel(source: SkillIconSource): string | null {
  const provider = normalizeProvider(source.provider) || parseProvider(source.scopesJson);
  return provider ? humanize(provider) : null;
}
