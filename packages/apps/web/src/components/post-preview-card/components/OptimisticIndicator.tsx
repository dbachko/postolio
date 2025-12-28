import { Loader2 } from 'lucide-react';

interface OptimisticIndicatorProps {
  label: string | null;
}

/**
 * Overlay indicator shown during optimistic updates.
 */
export function OptimisticIndicator({ label }: OptimisticIndicatorProps) {
  if (!label) return null;

  return (
    <div className="bg-background/70 border-border text-muted-foreground pointer-events-none absolute right-2 bottom-2 flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
