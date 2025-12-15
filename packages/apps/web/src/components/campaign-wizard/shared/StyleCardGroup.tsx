import { useEffect, useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { styleOptions, styleMeta } from '@/constants/campaign';

interface StyleCardGroupProps {
  value: string[];
  onChange: (value: string[]) => void;
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

  const recognizedSet = useMemo(() => {
    const set = new Set<string>();
    for (const opt of allStyles) {
      set.add(opt.value);
      set.add(opt.label);
      if ('fullDescription' in opt && typeof opt.fullDescription === 'string') {
        set.add(opt.fullDescription);
      }
    }
    return set;
  }, [allStyles]);

  const normalizedValue = useMemo(() => {
    const trimmed = (value || []).map((v) => v.trim()).filter((v) => v.length > 0);
    const recognized = trimmed.filter((v) => recognizedSet.has(v));
    const custom = trimmed.filter((v) => !recognizedSet.has(v)).join('; ');
    return { recognized, custom };
  }, [recognizedSet, value]);

  const [customDraft, setCustomDraft] = useState(normalizedValue.custom);
  const [isEditingCustom, setIsEditingCustom] = useState(false);

  useEffect(() => {
    if (isEditingCustom) return;
    setCustomDraft(normalizedValue.custom);
  }, [isEditingCustom, normalizedValue.custom]);

  const isOptSelected = (opt: any): boolean => {
    const canonical =
      opt.isBrandStyle && typeof opt.fullDescription === 'string' ? opt.fullDescription : opt.value;
    return normalizedValue.recognized.includes(canonical);
  };

  const emitNext = (recognized: string[], custom: string): { emittedCustom: string } => {
    const nextCustom = custom.trim();
    const isCustomRecognized = nextCustom.length > 0 && recognizedSet.has(nextCustom);
    const finalCustom = isCustomRecognized ? '' : nextCustom;
    const uniqueRecognized = Array.from(new Set(recognized));
    const next = finalCustom.length > 0 ? [...uniqueRecognized, finalCustom] : uniqueRecognized;
    onChange(next);
    return { emittedCustom: finalCustom };
  };

  const toggleOption = (opt: any) => {
    const canonical =
      opt.isBrandStyle && typeof opt.fullDescription === 'string' ? opt.fullDescription : opt.value;
    const selected = normalizedValue.recognized.includes(canonical);
    const nextRecognized = selected
      ? normalizedValue.recognized.filter((v) => v !== canonical)
      : [...normalizedValue.recognized, canonical];
    emitNext(nextRecognized, customDraft);
  };

  const onCustomChange = (text: string) => {
    const { emittedCustom } = emitNext(normalizedValue.recognized, text);
    if (!emittedCustom) {
      setCustomDraft('');
      return;
    }
    setCustomDraft(text);
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
                value={customDraft}
                onFocus={() => setIsEditingCustom(true)}
                onBlur={() => {
                  setIsEditingCustom(false);
                  const { emittedCustom } = emitNext(normalizedValue.recognized, customDraft);
                  setCustomDraft(emittedCustom);
                }}
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
