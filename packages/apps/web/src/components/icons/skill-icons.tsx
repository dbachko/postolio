import type { ComponentPropsWithoutRef } from 'react';
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

import { cn } from '@/lib/utils';

type SkillIconSource = {
  id?: string | null;
  icon?: string | null;
  name?: string | null;
  provider?: string | null;
  scopesJson?: unknown;
};

function normalizeProvider(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function parseProvider(scopesJson: unknown): string | null {
  if (!scopesJson || typeof scopesJson !== 'object') return null;
  const provider = (scopesJson as Record<string, unknown>).provider;
  return normalizeProvider(provider);
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function iconFromKey(keyRaw: string): LucideIcon | null {
  const key = keyRaw.trim().toLowerCase();
  if (!key) return null;

  if (key === 'text_generation') return Sparkles;
  if (key === 'image_generation') return ImageIcon;
  if (key === 'video_gen') return Video;
  if (key === 'audio_gen') return AudioLines;
  if (key === 'web_fetch') return Globe;

  if (key.includes('openai')) return Bot;
  if (key.includes('video')) return Video;
  if (key.includes('audio') || key.includes('tts') || key.includes('voice')) return AudioLines;
  if (key.includes('image')) return ImageIcon;
  if (key.includes('fetch') || key.includes('web') || key.includes('http')) return Globe;
  if (key.includes('internal')) return Wrench;
  if (key.includes('replicate')) return Cpu;

  return null;
}

export function resolveSkillIcon(source: SkillIconSource): LucideIcon {
  const fromIconField = source.icon ? iconFromKey(source.icon) : null;
  if (fromIconField) return fromIconField;

  const fromId = source.id ? iconFromKey(source.id) : null;
  if (fromId) return fromId;

  const provider = normalizeProvider(source.provider) || parseProvider(source.scopesJson);
  if (provider === 'openai') return Bot;
  if (provider === 'internal') return Wrench;
  if (provider === 'replicate') return Cpu;
  if (provider) return Cpu;

  return Sparkles;
}

export function getSkillProviderLabel(source: SkillIconSource): string | null {
  const provider = normalizeProvider(source.provider) || parseProvider(source.scopesJson);
  return provider ? humanize(provider) : null;
}

type SkillIconProps = Omit<ComponentPropsWithoutRef<'svg'>, 'children'> & {
  source: SkillIconSource;
};

export function SkillIcon({ source, className, ...props }: SkillIconProps) {
  const Icon = resolveSkillIcon(source);
  return <Icon aria-hidden="true" className={cn('h-4 w-4 shrink-0', className)} {...props} />;
}
