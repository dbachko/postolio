import { useCampaignWizard } from '../../../hooks/useCampaignWizard';
import { useBrandStore } from '../../../stores/brandStore';
import { SelectionCard } from '../shared/SelectionCard';
import { StyleCardGroup } from '../shared/StyleCardGroup';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Lightbulb, Sparkles, Zap } from 'lucide-react';
import type { ImageSource } from '@/types/campaign-wizard';
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
  const defaultProvider = providersData?.default;

  const canContinue = !!imageSource;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Image Preferences</h2>
        <p className="text-muted-foreground text-sm">
          Choose how images will be created for your campaign
        </p>
      </div>

      {/* Image Source Selection */}
      <div className="space-y-4">
        <h3 className="font-medium">How will you provide images?</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <SelectionCard
            icon="🎨"
            title="AI Generated"
            description="Create images with AI (Gemini/DALL-E)"
            selected={imageSource === 'ai'}
            onClick={() => updateField('imageSource', 'ai' satisfies ImageSource)}
          />
          <SelectionCard
            icon="📁"
            title="My Assets"
            description="Use uploaded images from your library"
            selected={imageSource === 'assets'}
            onClick={() => updateField('imageSource', 'assets' satisfies ImageSource)}
          />
          <SelectionCard
            icon="🔀"
            title="Mix Both"
            description="Use both AI and your assets"
            selected={imageSource === 'mix'}
            onClick={() => updateField('imageSource', 'mix' satisfies ImageSource)}
          />
        </div>
      </div>

      {/* Conditional: Image Provider Selection (if AI or Mix) */}
      {(imageSource === 'ai' || imageSource === 'mix') && providers.length > 0 && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div>
              <h3 className="mb-2 font-medium">AI Image Provider</h3>
              <p className="text-muted-foreground mb-4 text-sm">
                Choose which AI service generates your images
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {providers.map((provider) => {
                const isSelected = imageProvider === provider.name;
                const isDefault = provider.name === defaultProvider;
                const Icon = provider.name.includes('gemini') ? Sparkles : Zap;

                return (
                  <Button
                    key={provider.name}
                    type="button"
                    variant="outline"
                    onClick={() => updateField('imageProvider', provider.name)}
                    className={`hover:border-primary/50 relative h-auto items-start justify-start rounded-lg border-2 p-4 text-left whitespace-normal shadow-none transition-all ${
                      isSelected ? 'border-primary bg-primary/5' : 'border-border bg-background'
                    }`}
                  >
                    <div className="mb-2 flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className="text-primary h-5 w-5" />
                        <h4 className="font-semibold">{provider.displayName}</h4>
                      </div>
                      {isDefault && !imageProvider && (
                        <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
                          Default
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground mb-2 text-sm">
                      {provider.pricing.speedEstimate} generation
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {provider.pricing.features.slice(0, 2).map((feature: string) => (
                        <span key={feature} className="bg-muted rounded-md px-2 py-0.5 text-xs">
                          {feature}
                        </span>
                      ))}
                    </div>
                  </Button>
                );
              })}
            </div>
            <Alert>
              <Lightbulb className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Using default? We recommend Gemini Flash for fast, high-quality results. You can
                change this anytime in brand settings.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}

      {/* Conditional: Style Selection (if AI or Mix) */}
      {(imageSource === 'ai' || imageSource === 'mix') && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div>
              <h3 className="mb-2 font-medium">Visual Style for AI Images</h3>
              <p className="text-muted-foreground mb-4 text-sm">
                This style guides how AI generates your images
              </p>
            </div>
            <StyleCardGroup
              value={style}
              onChange={(v) => updateField('style', v)}
              brandStyles={brandStyles}
            />
          </CardContent>
        </Card>
      )}

      {/* Conditional: Asset Library Help (if Assets or Mix) */}
      {(imageSource === 'assets' || imageSource === 'mix') && (
        <Alert>
          <Lightbulb className="h-4 w-4" />
          <AlertDescription>
            💡 You can select images from your asset library when reviewing individual posts later.
            No need to upload or select images now.
          </AlertDescription>
        </Alert>
      )}

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
