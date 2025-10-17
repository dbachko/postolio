import { Label } from '../../ui/label';
import { Card, CardContent } from '../../ui/card';
import { RadioGroup, RadioGroupItem } from '../../ui/radio-group';
import { cn } from '@/lib/utils';
import { styleOptions, styleMeta } from '../../../constants/campaign';

interface StyleCardGroupProps {
  value: string;
  onChange: (value: string) => void;
}

export function StyleCardGroup({ value, onChange }: StyleCardGroupProps) {
  return (
    <div className="space-y-2">
      <Label>Style</Label>
      <RadioGroup
        value={value}
        onValueChange={onChange}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {styleOptions.map((opt) => {
          const meta = styleMeta[opt.value] || { icon: '🎯', blurb: '' };
          const checked = value === opt.value;
          const id = `style-${opt.value}`;
          return (
            <Label key={opt.value} htmlFor={id} className="cursor-pointer">
              <Card
                className={cn(
                  'transition-shadow',
                  checked ? 'shadow-md ring-2 ring-blue-500' : 'hover:shadow-sm'
                )}
              >
                <CardContent className="flex items-start gap-3 p-4">
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
      </RadioGroup>
    </div>
  );
}
