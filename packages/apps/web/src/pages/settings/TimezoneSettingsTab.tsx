import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Globe, Clock, Info, Save, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useTimezone } from '../../contexts/TimezoneContext';
import { getUserTimezone, getTimezoneAbbr } from '../../lib/timezone';
import { useBrandStore } from '../../stores/brandStore';
import { useAuthStore } from '../../stores/authStore';
import { auth as authApi, brand as brandApi } from '../../lib/api';
import BrandTimezoneCard from './BrandTimezoneCard';
import BrandImageProviderCard from './BrandImageProviderCard';
import type { ImageProvider } from '@/types/image-providers';
import { AsyncTimezoneCombobox } from '@/components/timezone/async-timezone-combobox';

export default function TimezoneSettingsTab() {
  const { timezone, isAutoDetected, setTimezone } = useTimezone();
  const { selectedBrand } = useBrandStore();
  const { user, setUser } = useAuthStore();

  const [localTimezone, setLocalTimezone] = useState(timezone);
  const [autoDetect, setAutoDetect] = useState(isAutoDetected);
  const [brandTimezone, setBrandTimezone] = useState<string | null>(null);
  const [brandImageProvider, setBrandImageProvider] = useState<ImageProvider | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [detectedTimezone] = useState(getUserTimezone());
  const [weekStart, setWeekStart] = useState<'monday' | 'sunday'>(
    (user?.weekStart as 'monday' | 'sunday') || 'monday'
  );

  // Load brand-specific timezone if a brand is selected
  useEffect(() => {
    if (!selectedBrand) return;

    const fetchBrandTimezone = async () => {
      try {
        const response = await brandApi.getBrandTimezone(selectedBrand.id);
        setBrandTimezone(response.timezone || null);
      } catch (error) {
        console.error('Failed to fetch brand timezone:', error);
      }
    };

    void fetchBrandTimezone();
  }, [selectedBrand]);

  // Load brand-specific image provider if a brand is selected
  useEffect(() => {
    if (!selectedBrand) return;

    const fetchBrandImageProvider = async () => {
      try {
        const response = await brandApi.getBrandImageProvider(selectedBrand.id);
        setBrandImageProvider(response.imageProvider || null);
      } catch (error) {
        console.error('Failed to fetch brand image provider:', error);
      }
    };

    void fetchBrandImageProvider();
  }, [selectedBrand]);

  const handleTimezoneChange = (value: string) => {
    setAutoDetect(false);
    setLocalTimezone(value);
  };

  const handleAutoDetectToggle = (checked: boolean) => {
    setAutoDetect(checked);
    if (checked) {
      setLocalTimezone(detectedTimezone);
    }
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      await setTimezone(autoDetect ? detectedTimezone : localTimezone, autoDetect);
      toast.success('Timezone settings saved successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save settings';
      toast.error(errorMessage);
      console.error('Error saving settings:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveBrandTimezone = async () => {
    if (!selectedBrand) return;

    setIsSaving(true);
    try {
      await brandApi.updateBrandTimezone(selectedBrand.id, brandTimezone);
      toast.success('Brand timezone settings saved successfully');
    } catch (error) {
      toast.error('Failed to save brand timezone');
      console.error('Error saving brand timezone:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveBrandImageProvider = async () => {
    if (!selectedBrand) return;

    setIsSaving(true);
    try {
      await brandApi.updateBrandImageProvider(selectedBrand.id, brandImageProvider);
      toast.success('Brand image provider saved successfully');
    } catch (error) {
      toast.error('Failed to save brand image provider');
      console.error('Error saving brand image provider:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToDefault = () => {
    setAutoDetect(true);
    setLocalTimezone(detectedTimezone);
    setBrandTimezone(null);
    setBrandImageProvider(null);
  };

  const handleSaveWeekStart = async () => {
    setIsSaving(true);
    try {
      await authApi.updateUserWeekStart({ weekStart });
      if (user) setUser({ ...user, weekStart });
      toast.success('Calendar preference saved');
    } catch (_e) {
      toast.error('Failed to save calendar preference');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* User Timezone Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Timezone Settings
          </CardTitle>
          <CardDescription>
            Configure how dates and times are displayed across the application
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Current timezone info */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Current Timezone</AlertTitle>
            <AlertDescription>
              <div className="mt-2 space-y-1">
                <div>
                  <span className="font-medium">Display timezone:</span> {timezone} (
                  {getTimezoneAbbr(timezone)})
                </div>
                <div>
                  <span className="font-medium">Browser detected:</span> {detectedTimezone} (
                  {getTimezoneAbbr(detectedTimezone)})
                </div>
                <div>
                  <span className="font-medium">Current time:</span>{' '}
                  {new Date().toLocaleString('en-US', {
                    timeZone: timezone,
                  })}
                </div>
              </div>
            </AlertDescription>
          </Alert>

          {/* Auto-detect toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-detect" className="text-base">
                Auto-detect timezone
              </Label>
              <p className="text-muted-foreground text-sm">
                Automatically use your browser&apos;s timezone
              </p>
            </div>
            <Switch
              id="auto-detect"
              checked={autoDetect}
              onCheckedChange={handleAutoDetectToggle}
            />
          </div>

          {/* Manual timezone selection */}
          {!autoDetect && (
            <div className="space-y-2">
              <Label htmlFor="timezone-select">Select timezone</Label>
              <AsyncTimezoneCombobox
                id="timezone-select"
                value={localTimezone}
                onValueChange={handleTimezoneChange}
                leadingIcon={<Clock className="h-4 w-4" />}
                buttonClassName="w-full"
              />
            </div>
          )}

          {/* Save button */}
          <div className="flex items-center gap-2">
            <Button
              onClick={handleSaveSettings}
              disabled={isSaving}
              className="flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              {isSaving ? 'Saving...' : 'Save Settings'}
            </Button>
            <Button
              variant="outline"
              onClick={handleResetToDefault}
              className="flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Reset to Default
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Brand-specific Timezone Settings */}
      {selectedBrand && (
        <BrandTimezoneCard
          brandName={selectedBrand.name}
          brandTimezone={brandTimezone}
          isSaving={isSaving}
          onBrandTimezoneChange={setBrandTimezone}
          onSave={handleSaveBrandTimezone}
        />
      )}

      {/* Brand-specific Image Provider Settings */}
      {selectedBrand && (
        <BrandImageProviderCard
          brandName={selectedBrand.name}
          selectedProvider={brandImageProvider}
          isSaving={isSaving}
          onProviderChange={setBrandImageProvider}
          onSave={handleSaveBrandImageProvider}
        />
      )}

      {/* Calendar Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Calendar Preferences
          </CardTitle>
          <CardDescription>Choose which day your weeks start on</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Week starts on</Label>
            <RadioGroup
              value={weekStart}
              onValueChange={(val) => setWeekStart(val as 'monday' | 'sunday')}
              className="grid grid-cols-2 gap-2 sm:max-w-sm"
            >
              <label
                htmlFor="weekstart-monday"
                className="border-border bg-card hover:bg-accent hover:text-accent-foreground inline-flex cursor-pointer items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="weekstart-monday" value="monday" />
                  <span>Monday</span>
                </div>
              </label>
              <label
                htmlFor="weekstart-sunday"
                className="border-border bg-card hover:bg-accent hover:text-accent-foreground inline-flex cursor-pointer items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="weekstart-sunday" value="sunday" />
                  <span>Sunday</span>
                </div>
              </label>
            </RadioGroup>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleSaveWeekStart}
              disabled={isSaving}
              className="flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              {isSaving ? 'Saving...' : 'Save Preferences'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
