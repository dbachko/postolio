import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import {
  Globe,
  Clock,
  Info,
  Save,
  RefreshCw,
  Shield,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useBrandStore } from '../stores/brandStore';
import { useAuthStore } from '../stores/authStore';
import { brand as brandApi } from '../lib/api';
import { notifications as notificationsApi } from '../lib/api';
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
                    <SelectContent className="max-h-72 overflow-y-auto">
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
              <CardDescription>
                Configure channels for each notification type. Critical events default to email if
                not configured.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <NotificationPreferencesPanel />
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

function NotificationPreferencesPanel() {
  const { selectedBrand } = useBrandStore();
  const [rows, setRows] = useState<
    Array<{
      category: string;
      type: string;
      in_app: boolean;
      email: boolean;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Group master preferences keyed by category (e.g., 'accounts')
  const [masters, setMasters] = useState<Record<string, boolean>>({});

  // Map known notification types to human-friendly titles and descriptions
  const categoryTitle = (category: string) => {
    const map: Record<string, string> = {
      publishing: 'Publishing',
      accounts: 'Accounts',
      billing: 'Billing',
      collaboration: 'Collaboration',
      system: 'System',
    };
    return map[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
  };

  const humanizeType = (type: string) => {
    // Use segment after last dot, replace underscores with spaces, Title Case
    const last = type.split('.').pop() || type;
    const words = last.replace(/[_-]+/g, ' ').split(' ');
    return words.map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
  };

  const getMeta = (category: string, type: string) => {
    const byType: Record<string, { title: string; description: string }> = {
      'publishing.post_failed': {
        title: 'Post Failed',
        description: 'A scheduled post failed to publish. Review details and retry.',
      },
      'accounts.account_disconnected': {
        // In grouped view this will be rendered as "Account is connected" item label
        title: 'Account Disconnected',
        description:
          'A connected social account lost authorization. Reconnect to resume publishing.',
      },
      'accounts.token_expiring': {
        title: 'Token Expiring',
        description: 'A connected account token is expiring soon. Refresh credentials.',
      },
      'billing.payment_failed': {
        title: 'Payment Failed',
        description: 'A payment attempt failed. Update your billing method.',
      },
      'system.test_notification': {
        title: 'Test Notification',
        description: 'Used to verify your notification setup and preferences.',
      },
    };
    const meta = byType[type] ?? {
      title: humanizeType(type),
      description: 'Notification about: ' + humanizeType(type).toLowerCase(),
    };
    return { categoryLabel: categoryTitle(category), ...meta };
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await notificationsApi.getPreferences(selectedBrand?.id);
      // Track only explicitly set preferences; fall back to defaults later
      const map = new Map<string, Partial<{ in_app: boolean; email: boolean }>>();
      const masterMap: Record<string, boolean> = {};
      for (const p of res.items) {
        if (p.channel === 'all' && p.type === 'all') {
          // Store category-level master enabled flag
          masterMap[p.category] = !!p.enabled;
          continue;
        }
        const key = `${p.category}:${p.type}`;
        const entry = map.get(key) ?? {};
        if (p.channel === 'in_app') entry.in_app = p.enabled;
        if (p.channel === 'email') entry.email = p.enabled;
        map.set(key, entry);
      }
      // Merge defaults
      const keys = new Set<string>([
        ...Array.from(map.keys()),
        ...res.defaults.map((d) => `${d.category}:${d.type}`),
      ]);
      const newRows: typeof rows = Array.from(keys).map((key) => {
        const [category, type] = key.split(':');
        const entry = map.get(key) ?? {};
        // If default says enabled for a channel and no explicit pref, show as enabled
        const defaultsForKey = res.defaults.filter(
          (d) => d.category === category && d.type === type
        );
        const defaultInApp = defaultsForKey.find((d) => d.channel === 'in_app')?.enabled ?? false;
        const defaultEmail = defaultsForKey.find((d) => d.channel === 'email')?.enabled ?? false;
        return {
          category,
          type,
          // Prefer explicit user setting; otherwise fall back to defaults
          in_app: entry.in_app ?? defaultInApp,
          email: entry.email ?? defaultEmail,
        };
      });
      newRows.sort((a, b) => a.category.localeCompare(b.category) || a.type.localeCompare(b.type));
      setRows(newRows);
      setMasters(masterMap);
    } catch (_e) {
      console.error('Failed to load notification preferences', _e);
      toast.error('Failed to load preferences');
    } finally {
      setLoading(false);
    }
  }, [selectedBrand?.id]);

  // Derived grouping for UI presentation.
  // We currently have two account-related types that should be shown
  // inside one expandable group labeled "Account Settings" with a master toggle.
  type Group = {
    key: string;
    category: string;
    title: string;
    // indices into rows
    indices: number[];
    // Item presentation info per row
    items: Array<{
      index: number;
      key: string;
      title: string;
      description: string;
    }>;
  };

  const buildGroups = (): Group[] => {
    const groups: Group[] = [];
    // Accounts group: combine all rows that have category === 'accounts'
    const accountIndices: number[] = [];
    rows.forEach((r, i) => {
      if (r.category === 'accounts') accountIndices.push(i);
    });
    if (accountIndices.length > 0) {
      const items = accountIndices.map((i) => {
        const r = rows[i];
        const meta = getMeta(r.category, r.type);
        // Display titles inside group
        const displayTitle =
          r.type === 'accounts.account_disconnected' ? 'Account is connected' : meta.title;
        return {
          index: i,
          key: `${r.category}:${r.type}`,
          title: displayTitle,
          description: meta.description,
        };
      });
      groups.push({
        key: 'group:accounts:account_settings',
        category: 'accounts',
        title: 'Account Settings',
        indices: accountIndices,
        items,
      });
    }

    // All other rows render as their own group (1:1)
    rows.forEach((r, i) => {
      if (r.category === 'accounts') return; // already grouped
      const meta = getMeta(r.category, r.type);
      groups.push({
        key: `${r.category}:${r.type}`,
        category: r.category,
        title: meta.title,
        indices: [i],
        items: [
          {
            index: i,
            key: `${r.category}:${r.type}`,
            title: meta.title,
            description: meta.description,
          },
        ],
      });
    });

    return groups.sort(
      (a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title)
    );
  };

  // Open all notification groups by default once rows are loaded.
  // This only runs once per mount (when expanded is still empty).
  useEffect(() => {
    if (rows.length > 0 && Object.keys(expanded).length === 0) {
      const defaults: Record<string, boolean> = {};
      for (const g of buildGroups()) defaults[g.key] = true;
      setExpanded(defaults);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (idx: number, channel: 'in_app' | 'email') => {
    const next = [...rows];
    const row = next[idx];
    row[channel] = !row[channel];
    setRows(next);
    try {
      setSaving(true);
      await notificationsApi.updatePreferences([
        {
          category: row.category,
          type: row.type,
          brandId: selectedBrand?.id,
          channel: channel,
          enabled: row[channel],
        },
      ]);
      toast.success('Preferences saved');
    } catch (_e) {
      toast.error('Failed to save preferences');
      // revert
      row[channel] = !row[channel];
      setRows([...next]);
    } finally {
      setSaving(false);
    }
  };

  const toggleTypeMaster = async (key: string, enabled: boolean) => {
    // This function still supports the 1:1 groups (non-accounts)
    const idx = rows.findIndex((r) => `${r.category}:${r.type}` === key);
    if (idx === -1) return;
    const next = [...rows];
    const row = { ...next[idx] };
    const prev = { in_app: row.in_app, email: row.email };
    row.in_app = enabled;
    row.email = enabled;
    next[idx] = row;
    setRows(next);
    try {
      setSaving(true);
      const updates: Array<{
        category: string;
        type: string;
        brandId?: string;
        channel: 'in_app' | 'email';
        enabled: boolean;
      }> = [];
      if (prev.in_app !== enabled)
        updates.push({
          category: row.category,
          type: row.type,
          brandId: selectedBrand?.id,
          channel: 'in_app',
          enabled,
        });
      if (prev.email !== enabled)
        updates.push({
          category: row.category,
          type: row.type,
          brandId: selectedBrand?.id,
          channel: 'email',
          enabled,
        });
      if (updates.length > 0) await notificationsApi.updatePreferences(updates);
      toast.success(`Preferences ${enabled ? 'enabled' : 'disabled'} for ${row.type}`);
    } catch (_e) {
      // revert
      const revert = [...rows];
      if (revert[idx]) {
        revert[idx] = { ...revert[idx], ...prev } as any;
        setRows(revert);
      }
      toast.error('Failed to update preferences');
    } finally {
      setSaving(false);
    }
  };

  const toggleGroupMaster = async (category: string, enabled: boolean) => {
    // Do not change individual toggles; only persist a category/type-wide master preference
    const prev = masters[category];
    setMasters((m) => ({ ...m, [category]: enabled }));
    try {
      setSaving(true);
      await notificationsApi.updatePreferences([
        {
          category,
          type: 'all',
          brandId: selectedBrand?.id,
          channel: 'all',
          enabled,
        },
      ]);
      toast.success(
        `Notifications ${enabled ? 'enabled' : 'disabled'} for ${categoryTitle(category)}`
      );
    } catch (_e) {
      // revert UI state
      setMasters((m) => ({ ...m, [category]: prev }));
      toast.error('Failed to update preferences');
    } finally {
      setSaving(false);
    }
  };

  const handleSendTest = async () => {
    try {
      await notificationsApi.sendTest(selectedBrand?.id);
      toast.success('Test notification sent');
    } catch (_e) {
      toast.error('Failed to send test notification');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-muted-foreground text-sm">
          {selectedBrand ? `Preferences for ${selectedBrand.name}` : 'Account-level preferences'}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button onClick={handleSendTest} disabled={saving}>
            Send test notification
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2">
        <div className="text-muted-foreground text-xs font-medium">Notification types</div>
        {buildGroups().map((g) => {
          const key = g.key;
          const isOpen = !!expanded[key];
          const groupMasterEnabled =
            g.category === 'accounts' ? (masters['accounts'] ?? true) : undefined;
          const anyEnabled =
            groupMasterEnabled !== undefined
              ? groupMasterEnabled
              : g.indices.some((idx) => rows[idx]?.in_app || rows[idx]?.email);
          return (
            <div key={key} className="rounded-md border">
              <div className="flex items-center justify-between p-3">
                <button
                  type="button"
                  onClick={() => setExpanded((s) => ({ ...s, [key]: !isOpen }))}
                  className="hover:bg-accent/50 group -ml-1 flex flex-1 items-center gap-2 rounded px-1 py-1 text-left"
                  aria-expanded={isOpen}
                >
                  {isOpen ? (
                    <ChevronDown className="text-muted-foreground h-4 w-4 transition-transform" />
                  ) : (
                    <ChevronRight className="text-muted-foreground h-4 w-4 transition-transform" />
                  )}
                  <Badge variant="secondary" className="uppercase">
                    {categoryTitle(g.category)}
                  </Badge>
                  <div className="text-sm font-medium">
                    {g.category === 'accounts' ? 'Account Settings' : g.title}
                  </div>
                </button>
                <div className="flex items-center gap-2 pr-1">
                  <Label className="text-xs">Enabled</Label>
                  {g.category === 'accounts' ? (
                    <Switch
                      checked={anyEnabled}
                      onCheckedChange={(v) => toggleGroupMaster('accounts', v)}
                    />
                  ) : (
                    <Switch
                      checked={anyEnabled}
                      onCheckedChange={(v) =>
                        toggleTypeMaster(
                          `${rows[g.indices[0]].category}:${rows[g.indices[0]].type}`,
                          v
                        )
                      }
                    />
                  )}
                </div>
              </div>
              {isOpen && (
                <div className="border-t p-3">
                  {g.items.map((item, idx) => {
                    const r = rows[item.index];
                    if (!r) return null;
                    const disabled =
                      g.category === 'accounts' ? !(masters['accounts'] ?? true) : false;
                    return (
                      <div key={item.key} className={idx > 0 ? 'mt-4 border-t pt-4' : ''}>
                        <div className="mb-1 text-sm font-medium">{item.title}</div>
                        <div className="text-muted-foreground mb-2 text-xs">{item.description}</div>
                        <div className="text-muted-foreground mb-3 font-mono text-[10px]">
                          {r.type}
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={r.in_app}
                              disabled={disabled}
                              onCheckedChange={() => toggle(item.index, 'in_app')}
                            />
                            <Label>In‑app</Label>
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={r.email}
                              disabled={disabled}
                              onCheckedChange={() => toggle(item.index, 'email')}
                            />
                            <Label>Email</Label>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
