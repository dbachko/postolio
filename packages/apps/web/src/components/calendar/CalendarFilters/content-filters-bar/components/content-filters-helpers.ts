import type { ComponentType } from 'react';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import type { ContentStatus } from '@/stores/calendarFilterStore';

export const STATUS_ICON: Record<ContentStatus, ComponentType<{ className?: string }>> = {
  draft: Clock,
  scheduled: Clock,
  published: CheckCircle2,
  failed: AlertTriangle,
  skipped: AlertTriangle,
};

export function getSeriesColorById(id: string): string {
  if (id === 'none') {
    return 'hsl(var(--muted-foreground))';
  }
  let hash = 0;
  for (let index = 0; index < id.length; index++) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return `hsl(${hash % 360} 68% 48%)`;
}
