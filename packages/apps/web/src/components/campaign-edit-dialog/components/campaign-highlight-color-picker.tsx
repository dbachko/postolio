import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

type CampaignHighlightColorPickerProps = {
  campaignName: string;
  palette: string[];
  color: string;
  disabled: boolean;
  onColorChange: (color: string) => void;
};

export function CampaignHighlightColorPicker({
  campaignName,
  palette,
  color,
  disabled,
  onColorChange,
}: CampaignHighlightColorPickerProps) {
  return (
    <div className="mt-3 grid gap-1 pb-4">
      <Label className="text-muted-foreground text-xs">Calendar highlight color</Label>
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex min-w-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
          style={{
            backgroundColor: color,
            borderColor: 'color-mix(in srgb, var(--border) 55%, transparent)',
            color: 'hsl(var(--foreground))',
            opacity: 0.9,
          }}
        >
          <span className="block max-w-[100px] truncate">{campaignName || 'Preview'}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {palette.map((hex) => {
            const selected = hex === color;
            return (
              <Button
                key={hex}
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  if (disabled) return;
                  onColorChange(hex);
                }}
                disabled={disabled}
                className={[
                  'h-6 w-6 rounded-full border p-0 transition-shadow hover:bg-transparent disabled:cursor-not-allowed disabled:opacity-50',
                  selected ? 'ring-ring shadow-sm ring-2' : 'hover:shadow-sm',
                ].join(' ')}
                style={{
                  backgroundColor: hex,
                  borderColor: 'color-mix(in srgb, var(--border) 65%, transparent)',
                }}
                aria-label={`Set calendar highlight color to ${hex}`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
