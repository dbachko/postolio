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
}

export function StyleCardGroup({ value, onChange }: StyleCardGroupProps) {
  const builtinValues = useMemo(() => styleOptions.map((o) => o.value), []);
  const selectedValue = builtinValues.includes(value) ? value : 'custom';
  return (
    <div className="space-y-2">
      <Label>Style</Label>
      <RadioGroup
        value={selectedValue}
        onValueChange={(v) => {
          // Allow selecting custom explicitly; set to empty string to enter custom text
          if (v === 'custom') {
            onChange('');
          } else {
            onChange(v);
          }
        }}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {styleOptions.map((opt) => {
          const meta = styleMeta[opt.value] || { icon: '🎯', blurb: '' };
          const checked = selectedValue === opt.value;
          const id = `style-${opt.value}`;
          return (
            <Label key={opt.value} htmlFor={id} className="block h-full cursor-pointer">
              <Card
                className={cn(
                  'h-full transition-shadow',
                  checked ? 'shadow-md ring-2 ring-blue-500' : 'hover:shadow-sm'
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
        {/* Custom style card */}
        <Label htmlFor="style-custom" className="col-span-full block h-full cursor-pointer">
          <Card
            className={cn(
              'h-full transition-shadow',
              selectedValue === 'custom' ? 'shadow-md ring-2 ring-blue-500' : 'hover:shadow-sm'
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
