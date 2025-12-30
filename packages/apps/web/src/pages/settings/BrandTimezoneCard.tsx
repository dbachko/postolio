import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Clock, Info, Save } from 'lucide-react';
import { AsyncTimezoneCombobox } from '@/components/timezone/async-timezone-combobox';

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
          <AsyncTimezoneCombobox
            id="brand-timezone"
            value={brandTimezone}
            onValueChange={onBrandTimezoneChange}
            allowClear
            clearLabel="Use account timezone"
            leadingIcon={<Clock className="h-4 w-4" />}
            buttonClassName="w-full"
            disabled={isSaving}
          />
        </div>

        <Button onClick={onSave} disabled={isSaving} className="flex items-center gap-2">
          <Save className="h-4 w-4" />
          {isSaving ? 'Saving...' : 'Save Brand Settings'}
        </Button>
      </CardContent>
    </Card>
  );
}
