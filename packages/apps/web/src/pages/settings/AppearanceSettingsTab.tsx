import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Save, RefreshCw } from 'lucide-react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { auth as authApi } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';

function AppearanceOption({ id, value, label }: { id: string; value: string; label: string }) {
  return (
    <label
      htmlFor={id}
      className="border-border bg-card hover:bg-accent hover:text-accent-foreground inline-flex cursor-pointer items-center justify-between rounded-lg border p-3"
    >
      <div className="flex items-center gap-2">
        <RadioGroupItem id={id} value={value} />
        <span>{label}</span>
      </div>
    </label>
  );
}

export default function AppearanceSettingsTab() {
  const { theme, setTheme } = useTheme();
  const { user, setUser } = useAuthStore();
  const [appearanceMode, setAppearanceMode] = useState<'system' | 'light' | 'dark'>(
    (theme as 'system' | 'light' | 'dark') || 'system'
  );
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveTheme = async () => {
    setIsSaving(true);
    try {
      await authApi.updateUserTheme({ theme: appearanceMode });
      toast.success('Theme preference saved successfully');
    } catch (_e) {
      toast.error('Failed to save theme preference');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetTheme = () => {
    setAppearanceMode('system');
    setTheme('system');
    if (user) {
      setUser({ ...user, theme: 'system' });
    }
  };

  const handleThemeChange = (val: string) => {
    const newTheme = val as 'system' | 'light' | 'dark';
    setAppearanceMode(newTheme);
    setTheme(newTheme);
    if (user) {
      setUser({ ...user, theme: newTheme });
    }
  };

  return (
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
            onValueChange={handleThemeChange}
            className="grid grid-cols-3 gap-2 sm:max-w-md"
          >
            <AppearanceOption id="appearance-system" value="system" label="System" />
            <AppearanceOption id="appearance-light" value="light" label="Light" />
            <AppearanceOption id="appearance-dark" value="dark" label="Dark" />
          </RadioGroup>
          <p className="text-muted-foreground text-sm">
            System adapts to your device’s appearance and updates automatically.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={handleSaveTheme} disabled={isSaving} className="flex items-center gap-2">
            <Save className="h-4 w-4" />
            {isSaving ? 'Saving...' : 'Save Theme'}
          </Button>
          <Button variant="outline" onClick={handleResetTheme} className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Reset to System
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
