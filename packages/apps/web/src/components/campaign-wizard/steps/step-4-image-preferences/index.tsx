import { useCampaignWizard } from '@/hooks/useCampaignWizard';
import { useBrandStore } from '@/stores/brandStore';
import { SelectionCard } from '../../shared/selection-card';
import { StyleCardGroup } from '../../shared/style-card-group';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Lightbulb, Sparkles, Zap } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { brand as brandApi } from '@/lib/api';
import { getImageProviders } from '@/lib/api/image-providers';

/**
 * Step 4: Image Preferences (NEW)
 * Choose image source and visual style
 * Key simplification: Users declare image strategy upfront
 */
export function Step4ImagePreferences() {
  const { imageSource, imageProvider, style, updateField, prevStep, nextStep } =
    useCampaignWizard();
  const brand = useBrandStore((s) => s.selectedBrand);

  // Fetch brand-specific visual styles
  const { data: stylesData } = useQuery({
    queryKey: ['brandVisualStyles', brand?.id],
    queryFn: () => (brand ? brandApi.getBrandVisualStyles(brand.id) : null),
    enabled: !!brand,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Fetch available image providers
  const { data: providersData } = useQuery({
    queryKey: ['imageProviders'],
    queryFn: getImageProviders,
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
  });

  const brandStyles = stylesData?.inferredStyles || [];
  const providers = providersData?.providers || [];
  const defaultProvider = providersData?.default || null;

  const canContinue = () => {
    // If user wants AI-generated images, they must pick a provider
    if (imageSource === 'ai') {
      return !!imageProvider;
    }
    // For assets and stock, no provider selection needed
    return true;
  };

  const handleContinue = () => {
    if (canContinue()) {
      nextStep();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold">Image Preferences</h2>
        <p className="text-muted-foreground text-sm">
          Choose how you want to source images for your campaign content
        </p>
      </div>

      {/* Image Source Selection */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <h3 className="mb-2 font-medium">Image Source</h3>
            <p className="text-muted-foreground mb-4 text-sm">
              Choose where images should come from. This affects how we generate your content.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <SelectionCard
              selected={imageSource === 'ai'}
              onClick={() => updateField('imageSource', 'ai')}
              icon={<Sparkles className="h-5 w-5" />}
              title="AI Generated"
              description="Generate custom images with AI based on your brand style"
              badge="Recommended"
            />
            <SelectionCard
              selected={imageSource === 'assets'}
              onClick={() => updateField('imageSource', 'assets')}
              icon={<Zap className="h-5 w-5" />}
              title="Brand Assets"
              description="Use images from your uploaded asset library"
            />
            <SelectionCard
              selected={imageSource === 'stock'}
              onClick={() => updateField('imageSource', 'stock')}
              icon={<Lightbulb className="h-5 w-5" />}
              title="Stock Photos"
              description="Find relevant stock photos automatically"
            />
          </div>
        </CardContent>
      </Card>

      {/* AI Provider Selection (only shown if AI selected) */}
      {imageSource === 'ai' && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div>
              <h3 className="mb-2 font-medium">AI Image Provider</h3>
              <p className="text-muted-foreground mb-4 text-sm">
                Select which AI service to use for generating images
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {providers.map((provider) => (
                <SelectionCard
                  key={provider.name}
                  selected={imageProvider === provider.name}
                  onClick={() => updateField('imageProvider', provider.name)}
                  title={provider.displayName}
                  description={
                    provider.isConfigured
                      ? `Configured • ${provider.pricing.speedEstimate}`
                      : 'Not configured'
                  }
                  badge={defaultProvider === provider.name ? 'Default' : undefined}
                />
              ))}
            </div>

            {!imageProvider && (
              <Alert>
                <AlertDescription>
                  Please select an AI provider to continue. Each provider has different strengths
                  and pricing.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Style Selection */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <h3 className="mb-2 font-medium">Visual Style</h3>
            <p className="text-muted-foreground mb-4 text-sm">
              Choose the visual style for your campaign images
            </p>
          </div>

          <StyleCardGroup
            value={style || []}
            onChange={(value) => updateField('style', value)}
            brandStyles={brandStyles}
          />
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={prevStep}>
          Back
        </Button>
        <Button onClick={handleContinue} disabled={!canContinue()}>
          Continue
        </Button>
      </div>
    </div>
  );
}
