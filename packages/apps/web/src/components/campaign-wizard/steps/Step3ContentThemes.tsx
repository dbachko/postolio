import { useCampaignWizard } from '../../../hooks/useCampaignWizard';
import { ThemeChipInput } from '../shared/ThemeChipInput';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Step 3: Content Themes
 * Dedicated step for selecting campaign themes
 * Extracted from Step 2 for better focus and clarity
 */
export function Step3ContentThemes() {
  const { themes, updateField, prevStep, nextStep } = useCampaignWizard();

  const canContinue = themes.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Content Themes</h2>
        <p className="text-muted-foreground text-sm">
          Choose topics and themes that will guide your campaign content
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Campaign Themes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-muted-foreground mb-4 text-sm">
            Themes determine what topics your content will cover. Select at least one theme to
            continue.
          </p>
          <ThemeChipInput themes={themes} onChange={(t) => updateField('themes', t)} />
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={prevStep}>
          Back
        </Button>
        <Button onClick={nextStep} disabled={!canContinue}>
          Continue
        </Button>
      </div>
    </div>
  );
}
