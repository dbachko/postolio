import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Clock, Info, Save } from 'lucide-react';
import { COMMON_TIMEZONES } from '../../lib/timezone';

interface BrandTimezoneCardProps {
  brandName: string;
  brandTimezone: string | null;
  isSaving: boolean;
  onBrandTimezoneChange: (value: string | null) => void;
  onSave: () => void;
}

export default function BrandTimezoneCard({
  brandName,
  brandTimezone,
  isSaving,
  onBrandTimezoneChange,
  onSave,
}: BrandTimezoneCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Brand Posting Timezone
        </CardTitle>
        <CardDescription>
          Override timezone for posting content for <span className="font-medium">{brandName}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Set a specific timezone for this brand&apos;s posting schedule. Leave empty to use your
            account timezone.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <Label htmlFor="brand-timezone">Brand timezone (optional)</Label>
          <Select
            value={brandTimezone || 'default'}
            onValueChange={(value) => onBrandTimezoneChange(value === 'default' ? null : value)}
          >
            <SelectTrigger id="brand-timezone" className="w-full">
              <SelectValue>
                {brandTimezone
                  ? COMMON_TIMEZONES.find((tz) => tz.value === brandTimezone)?.label ||
                    brandTimezone
                  : 'Use account timezone'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-72 overflow-y-auto">
              <SelectItem value="default">Use account timezone</SelectItem>
              {Object.entries(
                COMMON_TIMEZONES.reduce(
                  (groups, tz) => {
                    const group = tz.group || 'Other';
                    if (!groups[group]) groups[group] = [];
                    groups[group].push(tz);
                    return groups;
                  },
                  {} as Record<string, typeof COMMON_TIMEZONES>
                )
              ).map(([group, timezones]) => (
                <SelectGroup key={group}>
                  <SelectLabel>{group}</SelectLabel>
                  {timezones
                    .filter((tz) => tz.value !== 'auto')
                    .map((tz) => (
                      <SelectItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </SelectItem>
                    ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button onClick={onSave} disabled={isSaving} className="flex items-center gap-2">
          <Save className="h-4 w-4" />
          {isSaving ? 'Saving...' : 'Save Brand Settings'}
        </Button>
      </CardContent>
    </Card>
  );
}
