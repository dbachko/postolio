import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Palette, Info, Save, Sparkles } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getImageProviders } from '@/lib/api/image-providers';
import type { ImageProvider } from '@/types/image-providers';

interface BrandImageProviderCardProps {
  brandName: string;
  isSaving: boolean;
  onSave: () => void;
  selectedProvider: ImageProvider | null;
  onProviderChange: (value: ImageProvider | null) => void;
}

type ProviderDetails = {
  displayName: string;
  pricing: {
    speedEstimate: string;
    features: string[];
  };
};

function ProviderSelect({
  isLoading,
  selectedProvider,
  providers,
  defaultProvider,
  defaultProviderLabel,
  onProviderChange,
}: {
  isLoading: boolean;
  selectedProvider: ImageProvider | null;
  providers: Array<{ name: string; displayName: string }>;
  defaultProvider?: string | null;
  defaultProviderLabel: string | null;
  onProviderChange: (value: ImageProvider | null) => void;
}) {
  return (
    <Select
      disabled={isLoading}
      value={selectedProvider || 'default'}
      onValueChange={(value) =>
        onProviderChange(value === 'default' ? null : (value as ImageProvider))
      }
    >
      <SelectTrigger id="image-provider" className="w-full">
        <SelectValue>
          {selectedProvider
            ? providers.find((provider) => provider.name === selectedProvider)?.displayName ||
              selectedProvider
            : `Use system default${defaultProviderLabel ? ` (${defaultProviderLabel})` : ''}`}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="default">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Use system default
            {defaultProvider && (
              <span className="text-muted-foreground text-xs">({defaultProviderLabel})</span>
            )}
          </div>
        </SelectItem>
        {providers.map((provider) => (
          <SelectItem key={provider.name} value={provider.name}>
            <div className="flex items-center justify-between gap-4">
              <span>{provider.displayName}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SelectedProviderDetails({
  selectedProviderDetails,
}: {
  selectedProviderDetails: ProviderDetails | null;
}) {
  if (!selectedProviderDetails) {
    return null;
  }
  return (
    <div className="bg-muted rounded-lg p-3 text-sm">
      <div className="space-y-1">
        <div className="font-medium">{selectedProviderDetails.displayName}</div>
        <div className="text-muted-foreground text-xs">
          Speed: {selectedProviderDetails.pricing.speedEstimate}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {selectedProviderDetails.pricing.features.slice(0, 3).map((feature: string) => (
            <span key={feature} className="bg-background rounded-md px-2 py-0.5 text-xs">
              {feature}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function BrandImageProviderCard({
  brandName,
  isSaving,
  onSave,
  selectedProvider,
  onProviderChange,
}: BrandImageProviderCardProps) {
  // Fetch available image providers
  const { data: providersData, isLoading } = useQuery({
    queryKey: ['imageProviders'],
    queryFn: getImageProviders,
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
  });

  const providers = providersData?.providers || [];
  const defaultProvider = providersData?.default;
  const defaultProviderLabel = defaultProvider
    ? providers.find((p) => p.name === defaultProvider)?.displayName || defaultProvider
    : null;
  const selectedProviderDetails = selectedProvider
    ? providers.find((p) => p.name === selectedProvider) || null
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-5 w-5" />
          AI Image Provider
        </CardTitle>
        <CardDescription>
          Choose the default AI service for generating images for{' '}
          <span className="font-medium">{brandName}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            This setting will be used as the default for new AI image generations. Leave empty to
            use the system default (recommended for most users).
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <Label htmlFor="image-provider">Image provider (optional)</Label>
          <ProviderSelect
            isLoading={isLoading}
            selectedProvider={selectedProvider}
            providers={providers}
            defaultProvider={defaultProvider}
            defaultProviderLabel={defaultProviderLabel}
            onProviderChange={onProviderChange}
          />
        </div>

        <SelectedProviderDetails selectedProviderDetails={selectedProviderDetails} />

        <Button
          onClick={onSave}
          disabled={isSaving || isLoading}
          className="flex items-center gap-2"
        >
          <Save className="h-4 w-4" />
          {isSaving ? 'Saving...' : 'Save Brand Settings'}
        </Button>
      </CardContent>
    </Card>
  );
}
