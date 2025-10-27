import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import { useTimezone } from '../contexts/TimezoneContext';
import { COMMON_TIMEZONES, getUserTimezone, getTimezoneAbbr } from '../lib/timezone';
import { Globe, Clock, Info, Save, RefreshCw, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useBrandStore } from '../stores/brandStore';
import { useAuthStore } from '../stores/authStore';
import { brand as brandApi } from '../lib/api';
import { auth as authApi } from '../lib/api';
import { useTheme } from 'next-themes';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export function Settings() {
  const { timezone, isAutoDetected, setTimezone } = useTimezone();
  const { selectedBrand } = useBrandStore();
  const [localTimezone, setLocalTimezone] = useState(timezone);
  const [autoDetect, setAutoDetect] = useState(isAutoDetected);
  const [brandTimezone, setBrandTimezone] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [detectedTimezone] = useState(getUserTimezone());
  const { theme, setTheme } = useTheme();
  const { user, setUser } = useAuthStore();
  const [appearanceMode, setAppearanceMode] = useState<'system' | 'light' | 'dark'>(
    (theme as 'system' | 'light' | 'dark') || 'system'
  );
  const [weekStart, setWeekStart] = useState<'monday' | 'sunday'>(
    (user?.weekStart as 'monday' | 'sunday') || 'monday'
  );

  // Load brand-specific timezone if a brand is selected
  useEffect(() => {
    if (selectedBrand) {
      // Fetch brand timezone settings
      const fetchBrandTimezone = async () => {
        try {
          const response = await brandApi.getBrandTimezone(selectedBrand.id);
          setBrandTimezone(response.timezone || null);
        } catch (error) {
          console.error('Failed to fetch brand timezone:', error);
        }
      };
      fetchBrandTimezone();
    }
  }, [selectedBrand]);

  const handleTimezoneChange = (value: string) => {
    if (value === 'auto') {
      setAutoDetect(true);
      setLocalTimezone(detectedTimezone);
    } else {
      setAutoDetect(false);
      setLocalTimezone(value);
    }
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

  const handleResetToDefault = () => {
    setAutoDetect(true);
    setLocalTimezone(detectedTimezone);
    setBrandTimezone(null);
  };

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-2">
          Manage your account and application preferences
        </p>
      </div>

      <Tabs defaultValue="timezone" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="timezone">Timezone</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
        </TabsList>

        <TabsContent value="timezone" className="space-y-6">
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
                    Automatically use your browser's timezone
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
                  <Select value={localTimezone} onValueChange={handleTimezoneChange}>
                    <SelectTrigger id="timezone-select" className="w-full">
                      <SelectValue>
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4" />
                          {COMMON_TIMEZONES.find((tz) => tz.value === localTimezone)?.label ||
                            localTimezone}
                        </div>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
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
                          {timezones.map((tz) => (
                            <SelectItem key={tz.value} value={tz.value}>
                              {tz.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
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
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Brand Posting Timezone
                </CardTitle>
                <CardDescription>
                  Override timezone for posting content for{' '}
                  <span className="font-medium">{selectedBrand.name}</span>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Set a specific timezone for this brand's posting schedule. Leave empty to use
                    your account timezone.
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Label htmlFor="brand-timezone">Brand timezone (optional)</Label>
                  <Select
                    value={brandTimezone || 'default'}
                    onValueChange={(value) => setBrandTimezone(value === 'default' ? null : value)}
                  >
                    <SelectTrigger id="brand-timezone" className="w-full">
                      <SelectValue>
                        {brandTimezone
                          ? COMMON_TIMEZONES.find((tz) => tz.value === brandTimezone)?.label ||
                            brandTimezone
                          : 'Use account timezone'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
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

                <Button
                  onClick={handleSaveBrandTimezone}
                  disabled={isSaving}
                  className="flex items-center gap-2"
                >
                  <Save className="h-4 w-4" />
                  {isSaving ? 'Saving...' : 'Save Brand Settings'}
                </Button>
              </CardContent>
            </Card>
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
                  onClick={async () => {
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
                  }}
                  disabled={isSaving}
                  className="flex items-center gap-2"
                >
                  <Save className="h-4 w-4" />
                  {isSaving ? 'Saving...' : 'Save Preferences'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="account">
          <Card>
            <CardHeader>
              <CardTitle>Account Settings</CardTitle>
              <CardDescription>Manage your account information and preferences</CardDescription>
            </CardHeader>
            <CardContent>
              {/* Quick link to Security Dashboard */}
              <div className="bg-muted/40 mt-6 rounded-lg border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="bg-accent text-primary grid h-9 w-9 place-items-center rounded-md">
                      <Shield className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div>
                      <div className="font-medium">Security</div>
                      <div className="text-muted-foreground text-sm">
                        Manage devices, active sessions, and recent logins
                      </div>
                    </div>
                  </div>
                  <Link to="/security">
                    <Button variant="default" className="whitespace-nowrap">
                      Open
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Notification Preferences</CardTitle>
              <CardDescription>Configure how you receive notifications</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Notification settings coming soon...</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appearance">
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Choose your color theme preference</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="appearance">Theme</Label>
                <RadioGroup
                  value={appearanceMode}
                  onValueChange={(val) => {
                    const newTheme = val as 'system' | 'light' | 'dark';
                    setAppearanceMode(newTheme);
                    // Apply theme immediately
                    setTheme(newTheme);
                    // Reflect selection in local user state so bootstrapper won't override
                    if (user) setUser({ ...user, theme: newTheme });
                  }}
                  className="grid grid-cols-3 gap-2 sm:max-w-md"
                >
                  <label
                    htmlFor="appearance-system"
                    className="border-border bg-card hover:bg-accent hover:text-accent-foreground inline-flex cursor-pointer items-center justify-between rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem id="appearance-system" value="system" />
                      <span>System</span>
                    </div>
                  </label>
                  <label
                    htmlFor="appearance-light"
                    className="border-border bg-card hover:bg-accent hover:text-accent-foreground inline-flex cursor-pointer items-center justify-between rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem id="appearance-light" value="light" />
                      <span>Light</span>
                    </div>
                  </label>
                  <label
                    htmlFor="appearance-dark"
                    className="border-border bg-card hover:bg-accent hover:text-accent-foreground inline-flex cursor-pointer items-center justify-between rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem id="appearance-dark" value="dark" />
                      <span>Dark</span>
                    </div>
                  </label>
                </RadioGroup>
                <p className="text-muted-foreground text-sm">
                  System adapts to your device’s appearance and updates automatically.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  onClick={async () => {
                    setIsSaving(true);
                    try {
                      await authApi.updateUserTheme({ theme: appearanceMode });
                      toast.success('Theme preference saved successfully');
                    } catch (_e) {
                      toast.error('Failed to save theme preference');
                    } finally {
                      setIsSaving(false);
                    }
                  }}
                  disabled={isSaving}
                  className="flex items-center gap-2"
                >
                  <Save className="h-4 w-4" />
                  {isSaving ? 'Saving...' : 'Save Theme'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setAppearanceMode('system');
                    setTheme('system');
                    if (user) setUser({ ...user, theme: 'system' });
                  }}
                  className="flex items-center gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Reset to System
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default Settings;
