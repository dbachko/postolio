import { useMemo } from 'react';
import { Label } from '../../ui/label';
import { Card, CardContent } from '../../ui/card';
import { RadioGroup, RadioGroupItem } from '../../ui/radio-group';
import { cn } from '@/lib/utils';
import { Input } from '../../ui/input';
import { styleOptions, styleMeta } from '../../../constants/campaign';

interface StyleCardGroupProps {
  value: string;
  onChange: (value: string) => void;
  brandStyles?: Array<{ emoji: string; title: string; description: string }>;
}

export function StyleCardGroup({ value, onChange, brandStyles = [] }: StyleCardGroupProps) {
  // Combine brand-specific styles with universal fallback styles
  const allStyles = useMemo(() => {
    const brandStyleOptions =
      brandStyles.length > 0
        ? brandStyles.map((style, idx) => ({
            value: `brand-${idx}`,
            label: style.title,
            emoji: style.emoji,
            fullDescription: style.description,
            isBrandStyle: true,
          }))
        : [];

    const universalStyleOptions = styleOptions.map((opt) => ({
      ...opt,
      isBrandStyle: false,
    }));

    return [...brandStyleOptions, ...universalStyleOptions];
  }, [brandStyles]);

  const builtinValues = useMemo(() => allStyles.map((o) => o.value), [allStyles]);
  const selectedValue = builtinValues.includes(value) ? value : 'custom';
  const brandStyleOptions = allStyles.filter((s) => 'isBrandStyle' in s && s.isBrandStyle);
  const universalStyleOptions = allStyles.filter((s) => !('isBrandStyle' in s) || !s.isBrandStyle);

  return (
    <div className="space-y-4">
      <Label>Style</Label>
      <RadioGroup
        value={selectedValue}
        onValueChange={(v) => {
          // Allow selecting custom explicitly; set to empty string to enter custom text
          if (v === 'custom') {
            onChange('');
          } else {
            // For brand styles, save the full DALL-E-optimized description
            const selectedStyle = allStyles.find((s) => s.value === v);
            if (
              selectedStyle &&
              'fullDescription' in selectedStyle &&
              typeof selectedStyle.fullDescription === 'string'
            ) {
              onChange(selectedStyle.fullDescription);
            } else {
              onChange(v);
            }
          }
        }}
        className="space-y-4"
      >
        {/* Brand-specific styles section */}
        {brandStyleOptions.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span>✨</span>
              <span>Your Brand Styles</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {brandStyleOptions.map((opt) => {
                const emoji = 'emoji' in opt && typeof opt.emoji === 'string' ? opt.emoji : '✨';
                const description =
                  'fullDescription' in opt && typeof opt.fullDescription === 'string'
                    ? opt.fullDescription
                    : '';
                const checked = selectedValue === opt.value;
                const id = `style-${opt.value}`;
                return (
                  <Label key={opt.value} htmlFor={id} className="block h-full cursor-pointer">
                    <Card
                      className={cn(
                        'border-primary/50 h-full transition-shadow',
                        checked ? 'ring-ring shadow-md ring-2' : 'hover:shadow-sm'
                      )}
                    >
                      <CardContent className="flex min-h-24 items-start gap-3 p-4">
                        <RadioGroupItem id={id} value={opt.value} className="mt-1" />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-lg" aria-hidden>
                              {emoji}
                            </span>
                            <span className="font-medium">{opt.label}</span>
                          </div>
                          {description && (
                            <p className="text-muted-foreground mt-1 text-sm">{description}</p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </Label>
                );
              })}
            </div>
          </div>
        )}

        {/* Universal styles section */}
        {universalStyleOptions.length > 0 && (
          <div className="space-y-3">
            {brandStyleOptions.length > 0 && (
              <div className="flex items-center gap-2 text-sm font-medium">
                <span>🎨</span>
                <span>Universal Styles</span>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {universalStyleOptions.map((opt) => {
                const meta = styleMeta[opt.value] || { icon: '🎯', blurb: '' };
                const checked = selectedValue === opt.value;
                const id = `style-${opt.value}`;
                return (
                  <Label key={opt.value} htmlFor={id} className="block h-full cursor-pointer">
                    <Card
                      className={cn(
                        'h-full transition-shadow',
                        checked ? 'ring-ring shadow-md ring-2' : 'hover:shadow-sm'
                      )}
                    >
                      <CardContent className="flex min-h-24 items-start gap-3 p-4">
                        <RadioGroupItem id={id} value={opt.value} className="mt-1" />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-lg" aria-hidden>
                              {meta.icon}
                            </span>
                            <span className="font-medium">{opt.label}</span>
                          </div>
                          {meta.blurb && (
                            <p className="text-muted-foreground mt-1 text-sm">{meta.blurb}</p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </Label>
                );
              })}
            </div>
          </div>
        )}
        {/* Custom style card */}
        <Label htmlFor="style-custom" className="col-span-full block h-full cursor-pointer">
          <Card
            className={cn(
              'h-full transition-shadow',
              selectedValue === 'custom' ? 'ring-ring shadow-md ring-2' : 'hover:shadow-sm'
            )}
          >
            <CardContent className="flex min-h-24 items-start gap-3 p-4">
              <RadioGroupItem id="style-custom" value="custom" className="mt-1" />
              <div className="flex-1">
                <div className="mb-1 font-medium">Custom style</div>
                <Input
                  type="text"
                  placeholder="Describe your style…"
                  value={selectedValue === 'custom' ? value : ''}
                  onChange={(e) => onChange(e.target.value)}
                  onFocus={() => {
                    // Ensure radio shows as selected when focusing input
                    if (selectedValue !== 'custom') onChange('');
                  }}
                />
                <p className="text-muted-foreground mt-1 text-xs">
                  e.g., Scandinavian minimal, playful pastel, editorial
                </p>
              </div>
            </CardContent>
          </Card>
        </Label>
      </RadioGroup>
    </div>
  );
}
