import { useMemo } from 'react';
import { Label } from '../../ui/label';
import { Card, CardContent } from '../../ui/card';
import { cn } from '@/lib/utils';
import { Input } from '../../ui/input';
import { Checkbox } from '../../ui/checkbox';
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

  const brandStyleOptions = allStyles.filter((s) => 'isBrandStyle' in s && s.isBrandStyle);
  const universalStyleOptions = allStyles.filter((s) => !('isBrandStyle' in s) || !s.isBrandStyle);

  const splitTokens = (input: string | undefined | null): string[] => {
    if (!input) return [];
    return input
      .split(/[;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  };

  const tokens = splitTokens(value);

  const isOptSelected = (opt: any): boolean => {
    const candidates = [opt.value, opt.label];
    if ('fullDescription' in opt && typeof opt.fullDescription === 'string') {
      candidates.push(opt.fullDescription);
    }
    const labels = candidates.filter(Boolean);
    return tokens.some((t) => labels.includes(t));
  };

  const toggleOption = (opt: any) => {
    const selected = isOptSelected(opt);
    const next = tokens.slice();
    // Remove any existing representations of this option
    const toRemove = [opt.value, opt.label];
    if ('fullDescription' in opt && typeof opt.fullDescription === 'string') {
      toRemove.push(opt.fullDescription);
    }
    const filtered = next.filter((t) => !toRemove.includes(t));
    if (!selected) {
      // Prefer descriptive text for brand styles; stable value for universal
      const toAdd =
        opt.isBrandStyle && typeof opt.fullDescription === 'string'
          ? opt.fullDescription
          : opt.value;
      filtered.push(toAdd);
    }
    onChange(filtered.join('; '));
  };

  const recognizedSet = new Set<string>();
  for (const opt of allStyles) {
    recognizedSet.add(opt.value);
    recognizedSet.add(opt.label);
    if ('fullDescription' in opt && typeof opt.fullDescription === 'string')
      recognizedSet.add(opt.fullDescription);
  }
  const customText = tokens.filter((t) => !recognizedSet.has(t)).join('; ');
  const onCustomChange = (text: string) => {
    const recognized = tokens.filter((t) => recognizedSet.has(t));
    const extras = splitTokens(text);
    onChange([...recognized, ...extras].join('; '));
  };

  return (
    <div className="space-y-4">
      <Label>Style</Label>
      <div className="space-y-4">
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
                const checked = isOptSelected(opt);
                return (
                  <div
                    key={opt.value}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleOption(opt)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleOption(opt);
                      }
                    }}
                    className="block h-full cursor-pointer"
                  >
                    <Card
                      className={cn(
                        'border-primary/50 h-full transition-shadow',
                        checked ? 'ring-ring shadow-md ring-2' : 'hover:shadow-sm'
                      )}
                    >
                      <CardContent className="flex min-h-24 items-start gap-3 p-4">
                        <Checkbox checked={checked} className="mt-1" aria-hidden />
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
                  </div>
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
                const checked = isOptSelected(opt);
                return (
                  <div
                    key={opt.value}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleOption(opt)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleOption(opt);
                      }
                    }}
                    className="block h-full cursor-pointer"
                  >
                    <Card
                      className={cn(
                        'h-full transition-shadow',
                        checked ? 'ring-ring shadow-md ring-2' : 'hover:shadow-sm'
                      )}
                    >
                      <CardContent className="flex min-h-24 items-start gap-3 p-4">
                        <Checkbox checked={checked} className="mt-1" aria-hidden />
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
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* Custom style input (appends to selected cards) */}
        <Card className={cn('h-full transition-shadow hover:shadow-sm')}>
          <CardContent className="flex min-h-24 items-start gap-3 p-4">
            <div className="flex-1">
              <div className="mb-1 font-medium">Additional custom style</div>
              <Input
                type="text"
                placeholder="Describe extra style…"
                value={customText}
                onChange={(e) => onCustomChange(e.target.value)}
              />
              <p className="text-muted-foreground mt-1 text-xs">
                You can combine multiple styles; we’ll use them together.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
