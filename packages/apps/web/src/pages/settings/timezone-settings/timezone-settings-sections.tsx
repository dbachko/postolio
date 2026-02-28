import { Clock, Globe, Info, RefreshCw, Save } from 'lucide-react';

import { AsyncTimezoneCombobox } from '@/components/timezone/async-timezone-combobox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { getTimezoneAbbr } from '@/lib/timezone';

interface UserTimezoneCardProps {
  timezone: string;
  detectedTimezone: string;
  localTimezone: string;
  autoDetect: boolean;
  isSaving: boolean;
  onTimezoneChange: (value: string) => void;
  onAutoDetectToggle: (checked: boolean) => void;
  onSave: () => void;
  onReset: () => void;
}

export function UserTimezoneCard(props: UserTimezoneCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" /> Timezone Settings
        </CardTitle>
        <CardDescription>
          Configure how dates and times are displayed across the application
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Current Timezone</AlertTitle>
          <AlertDescription>
            <div className="mt-2 space-y-1">
              <div>
                <span className="font-medium">Display timezone:</span> {props.timezone} (
                {getTimezoneAbbr(props.timezone)})
              </div>
              <div>
                <span className="font-medium">Browser detected:</span> {props.detectedTimezone} (
                {getTimezoneAbbr(props.detectedTimezone)})
              </div>
              <div>
                <span className="font-medium">Current time:</span>{' '}
                {new Date().toLocaleString('en-US', { timeZone: props.timezone })}
              </div>
            </div>
          </AlertDescription>
        </Alert>

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
            checked={props.autoDetect}
            onCheckedChange={props.onAutoDetectToggle}
          />
        </div>

        {!props.autoDetect ? (
          <div className="space-y-2">
            <Label htmlFor="timezone-select">Select timezone</Label>
            <AsyncTimezoneCombobox
              id="timezone-select"
              value={props.localTimezone}
              onValueChange={props.onTimezoneChange}
              leadingIcon={<Clock className="h-4 w-4" />}
              buttonClassName="w-full"
            />
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Button
            onClick={props.onSave}
            disabled={props.isSaving}
            className="flex items-center gap-2"
          >
            <Save className="h-4 w-4" /> {props.isSaving ? 'Saving...' : 'Save Settings'}
          </Button>
          <Button variant="outline" onClick={props.onReset} className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> Reset to Default
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface CalendarPreferencesCardProps {
  weekStart: 'monday' | 'sunday';
  isSaving: boolean;
  onWeekStartChange: (value: 'monday' | 'sunday') => void;
  onSave: () => void;
}

export function CalendarPreferencesCard(props: CalendarPreferencesCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" /> Calendar Preferences
        </CardTitle>
        <CardDescription>Choose which day your weeks start on</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Week starts on</Label>
          <RadioGroup
            value={props.weekStart}
            onValueChange={(value) => props.onWeekStartChange(value as 'monday' | 'sunday')}
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
            onClick={props.onSave}
            disabled={props.isSaving}
            className="flex items-center gap-2"
          >
            <Save className="h-4 w-4" /> {props.isSaving ? 'Saving...' : 'Save Preferences'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
