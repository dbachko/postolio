import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { frequencyOptions, styleOptions } from '../constants/campaign';
import { getStableColorFromId } from '../utils/campaign-colors';
import { getStoredCampaignColor, setStoredCampaignColor } from '@/utils/campaign-color-storage';
import { campaign as campaignApi, type Campaign } from '../lib/api';
import { GoalsListInput } from './campaign-wizard/shared/GoalsListInput';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useBrandStore } from '@/stores/brandStore';
import { formatInTimeZone } from 'date-fns-tz';
import { parseISO } from 'date-fns';

interface CampaignEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign;
  onSaved?: () => void;
}

type EditableFlags = {
  all: boolean;
  name: boolean;
  dates: boolean;
  frequency: boolean;
  postingTime: boolean;
  themes: boolean;
  style: boolean;
  color: boolean;
  reason: string;
};

function getEditPermissions(status: Campaign['status']): EditableFlags {
  switch (status) {
    case 'creating':
    case 'preview':
    case 'failed':
      return {
        all: true,
        name: true,
        dates: true,
        frequency: true,
        postingTime: true,
        themes: true,
        style: true,
        color: true,
        reason: 'All fields are editable for this campaign status.',
      };
    case 'active':
    case 'paused':
      return {
        all: false,
        name: true,
        dates: false,
        frequency: false,
        postingTime: false,
        themes: false,
        style: false,
        color: true,
        reason: 'Active/paused campaigns only allow editing name.',
      };
    case 'completed':
      return {
        all: false,
        name: false,
        dates: false,
        frequency: false,
        postingTime: false,
        themes: false,
        style: false,
        color: false,
        reason: 'Completed campaigns are read-only.',
      };
    default:
      return {
        all: false,
        name: true,
        dates: false,
        frequency: false,
        postingTime: false,
        themes: false,
        style: false,
        color: true,
        reason: 'Limited editing is available for this campaign status.',
      };
  }
}

function toDateInputValue(value: unknown, timezone?: string): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    if (timezone) return formatInTimeZone(value, timezone, 'yyyy-MM-dd');
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    try {
      const date = parseISO(trimmed);
      if (Number.isNaN(date.getTime())) return '';
      if (timezone) return formatInTimeZone(date, timezone, 'yyyy-MM-dd');
      return date.toISOString().slice(0, 10);
    } catch {
      const date = new Date(trimmed);
      if (Number.isNaN(date.getTime())) return '';
      if (timezone) return formatInTimeZone(date, timezone, 'yyyy-MM-dd');
      return date.toISOString().slice(0, 10);
    }
  }
  return '';
}

function toSelectableStyleValue(value: unknown): string {
  if (Array.isArray(value)) {
    const cleaned = value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
    return cleaned.join('; ');
  }
  if (typeof value === 'string') return value.trim();
  return '';
}

function normalizeOptionValue(
  current: string,
  options: Array<{ value: string; label: string }>
): string {
  if (!current) return '';
  const byValue = options.find((o) => o.value === current);
  if (byValue) return byValue.value;
  const byLabel = options.find((o) => o.label.toLowerCase() === current.toLowerCase());
  return byLabel ? byLabel.value : current;
}

export function CampaignEditDialog({
  open,
  onOpenChange,
  campaign,
  onSaved,
}: CampaignEditDialogProps) {
  const brands = useBrandStore((s) => s.brands);
  const brandTimezone = useMemo(() => {
    const brand = brands.find((b) => b.id === campaign.brandId);
    return brand?.postingTimezone || undefined;
  }, [brands, campaign.brandId]);

  const [name, setName] = useState(campaign.name);
  // Predefined hex palette (Tailwind 300 tones)
  // IMPORTANT: memoize to avoid recreating each render which caused an effect loop
  const palette: string[] = useMemo(
    () => [
      '#93C5FD', // blue-300
      '#A5B4FC', // indigo-300
      '#C4B5FD', // violet-300
      '#D8B4FE', // purple-300
      '#F0ABFC', // fuchsia-300
      '#F9A8D4', // pink-300
      '#FDA4AF', // rose-300
      '#FDBA74', // orange-300
      '#FCD34D', // amber-300
      '#6EE7B7', // emerald-300
    ],
    []
  );
  const initialColor =
    getStoredCampaignColor(campaign.id) ||
    (campaign as any).color ||
    getStableColorFromId(campaign.id) ||
    palette[0];
  const [color, setColor] = useState<string>(initialColor);
  const [startDate, setStartDate] = useState<string>(
    toDateInputValue(campaign.config?.duration?.start, brandTimezone)
  );
  const [endDate, setEndDate] = useState<string>(
    toDateInputValue(campaign.config?.duration?.end, brandTimezone)
  );
  const [frequency, setFrequency] = useState<string>(
    normalizeOptionValue(campaign.config?.frequency || '', frequencyOptions)
  );
  const [postingTime, setPostingTime] = useState<string>(campaign.config?.postingTime || '12:00');
  const [themes, setThemes] = useState<string>((campaign.config?.themes || []).join(', '));
  const [style, setStyle] = useState<string>(
    normalizeOptionValue(toSelectableStyleValue(campaign.config?.style), styleOptions)
  );
  const [goals, setGoals] = useState<string[]>(
    (Array.isArray((campaign.config as any)?.goals)
      ? ((campaign.config as any)?.goals as string[])
      : (((campaign.config as any)?.goals as unknown as string) || '')
          .split(/\n|;/)
          .map((s) => s.trim())
          .filter(Boolean)) || []
  );
  const [seasonalityAssist, setSeasonalityAssist] = useState<boolean>(
    (campaign.config as any)?.seasonalityAssist ?? true
  );
  const [saving, setSaving] = useState(false);

  const perms = useMemo(() => getEditPermissions(campaign.status), [campaign.status]);
  const startedStatuses = useMemo(() => new Set(['active', 'paused']), []);
  const lockedMsg = startedStatuses.has(campaign.status)
    ? 'This field can’t be edited once the campaign has started.'
    : perms.reason;

  useEffect(() => {
    if (!open) return;
    // Hydrate when dialog opens in case campaign object changed
    setName(campaign.name);
    setColor(
      getStoredCampaignColor(campaign.id) ||
        (campaign as any).color ||
        getStableColorFromId(campaign.id) ||
        palette[0]
    );
    setStartDate(toDateInputValue(campaign.config?.duration?.start, brandTimezone));
    setEndDate(toDateInputValue(campaign.config?.duration?.end, brandTimezone));
    setFrequency(normalizeOptionValue(campaign.config?.frequency || '', frequencyOptions));
    setPostingTime(campaign.config?.postingTime || '12:00');
    setThemes((campaign.config?.themes || []).join(', '));
    setStyle(normalizeOptionValue(toSelectableStyleValue(campaign.config?.style), styleOptions));
    const g = (campaign.config as any)?.goals;
    setGoals(
      Array.isArray(g)
        ? (g as string[])
        : ((g as unknown as string) || '')
            .split(/\n|;/)
            .map((s) => s.trim())
            .filter(Boolean)
    );
    setSeasonalityAssist((((campaign.config as any) || {}).seasonalityAssist as boolean) ?? true);
  }, [open, campaign, palette, brandTimezone]);

  const onSubmit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {};
      const initialStart = toDateInputValue(campaign.config?.duration?.start, brandTimezone);
      const initialEnd = toDateInputValue(campaign.config?.duration?.end, brandTimezone);
      const initialFrequency = normalizeOptionValue(
        campaign.config?.frequency || '',
        frequencyOptions
      );
      const initialStyle = normalizeOptionValue(
        toSelectableStyleValue(campaign.config?.style),
        styleOptions
      );

      // Always allow name if permitted
      if (perms.name && name !== campaign.name) updates.name = name.trim();

      // Config-related updates if permitted
      if (perms.dates) {
        if (startDate && startDate !== initialStart) updates.startDate = startDate;
        if (endDate && endDate !== initialEnd) updates.endDate = endDate;
      }
      if (perms.frequency && frequency && frequency !== initialFrequency) {
        updates.frequency = frequency;
      }
      if (perms.postingTime && postingTime && postingTime !== campaign.config?.postingTime) {
        updates.postingTime = postingTime;
      }
      if (perms.themes) {
        const list = themes
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        if (JSON.stringify(list) !== JSON.stringify(campaign.config?.themes || [])) {
          updates.themes = list;
        }
      }
      if (perms.style && style !== initialStyle) {
        updates.style = style;
      }
      // Color is a frontend-only preference for now; track change and persist locally
      const prevStoredColor = getStoredCampaignColor(campaign.id);
      const colorChanged = !!(perms.color && color && color !== prevStoredColor);
      if (colorChanged) setStoredCampaignColor(campaign.id, color);
      if (perms.all) {
        const prevGoals = Array.isArray((campaign.config as any)?.goals)
          ? ((campaign.config as any)?.goals as string[])
          : [];
        const normalized = goals.map((g) => g.trim()).filter(Boolean);
        if (JSON.stringify(normalized) !== JSON.stringify(prevGoals)) {
          updates.goals = normalized;
        }
      }
      if (
        perms.all &&
        seasonalityAssist !==
          ((((campaign.config as any) || {}).seasonalityAssist as boolean) ?? true)
      ) {
        updates.seasonalityAssist = seasonalityAssist;
      }

      if (Object.keys(updates).length === 0) {
        if (colorChanged) {
          toast.success('Calendar highlight color saved');
          onOpenChange(false);
        } else {
          toast.info('No changes to save');
        }
        setSaving(false);
        return;
      }

      const res = await campaignApi.updateCampaign(campaign.id, updates as any);
      if (res.success) {
        toast.success(res.message || 'Campaign updated');
        if (colorChanged) toast.info('Calendar highlight color saved');
        onOpenChange(false);
        onSaved?.();
      } else {
        toast.error('Failed to update campaign');
      }
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to update campaign');
    } finally {
      setSaving(false);
    }
  };

  const disabledMsg = perms.all
    ? 'Themes/style changes may regenerate preview content.'
    : perms.reason;
  const styleHasCurrent = !!style && !styleOptions.some((opt) => opt.value === style);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-xl">
        <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
          <DialogHeader>
            <DialogTitle>Edit Campaign</DialogTitle>
            <DialogDescription>{disabledMsg}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!perms.name}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="startDate">Start Date</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className={!perms.dates ? 'cursor-not-allowed' : ''}>
                        <Input
                          id="startDate"
                          type="date"
                          placeholder="YYYY-MM-DD (optional)"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          disabled={!perms.dates}
                        />
                      </div>
                    </TooltipTrigger>
                    {!perms.dates ? <TooltipContent>{lockedMsg}</TooltipContent> : null}
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="endDate">End Date</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className={!perms.dates ? 'cursor-not-allowed' : ''}>
                        <Input
                          id="endDate"
                          type="date"
                          placeholder="YYYY-MM-DD (optional)"
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          disabled={!perms.dates}
                        />
                      </div>
                    </TooltipTrigger>
                    {!perms.dates ? <TooltipContent>{lockedMsg}</TooltipContent> : null}
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="frequency">Frequency</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className={!perms.frequency ? 'cursor-not-allowed' : ''}>
                        <Select
                          value={frequency || undefined}
                          onValueChange={(v) => setFrequency(v)}
                          disabled={!perms.frequency}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select frequency" />
                          </SelectTrigger>
                          <SelectContent>
                            {frequencyOptions.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </TooltipTrigger>
                    {!perms.frequency ? <TooltipContent>{lockedMsg}</TooltipContent> : null}
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="postingTime">Posting Time</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className={!perms.postingTime ? 'cursor-not-allowed' : ''}>
                        <Input
                          id="postingTime"
                          type="time"
                          value={postingTime}
                          onChange={(e) => setPostingTime(e.target.value)}
                          disabled={!perms.postingTime}
                        />
                      </div>
                    </TooltipTrigger>
                    {!perms.postingTime ? <TooltipContent>{lockedMsg}</TooltipContent> : null}
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="themes">Themes (comma separated)</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className={!perms.themes ? 'cursor-not-allowed' : ''}>
                      <Textarea
                        id="themes"
                        value={themes}
                        onChange={(e) => setThemes(e.target.value)}
                        disabled={!perms.themes}
                        placeholder="e.g. Product launch, Summer sale"
                        rows={2}
                      />
                    </div>
                  </TooltipTrigger>
                  {!perms.themes ? <TooltipContent>{lockedMsg}</TooltipContent> : null}
                </Tooltip>
              </TooltipProvider>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="style">Style</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className={!perms.style ? 'cursor-not-allowed' : ''}>
                      <Select
                        value={style || undefined}
                        onValueChange={(v) => setStyle(v)}
                        disabled={!perms.style}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select style" />
                        </SelectTrigger>
                        <SelectContent>
                          {styleHasCurrent ? (
                            <SelectItem value={style} className="text-muted-foreground">
                              Current: {style}
                            </SelectItem>
                          ) : null}
                          {styleOptions.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </TooltipTrigger>
                  {!perms.style ? <TooltipContent>{lockedMsg}</TooltipContent> : null}
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Goals</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className={!perms.all ? 'cursor-not-allowed' : ''}>
                    <GoalsListInput goals={goals} onChange={setGoals} disabled={!perms.all} />
                  </div>
                </TooltipTrigger>
                {!perms.all ? <TooltipContent>{lockedMsg}</TooltipContent> : null}
              </Tooltip>
            </TooltipProvider>
          </div>

          <div className="grid grid-cols-2 items-center gap-2">
            <div>
              <Label>Seasonality Assistance</Label>
              <div className="text-muted-foreground text-xs">
                Use seasons/holidays when relevant
              </div>
            </div>
            <div className="flex justify-end">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className={!perms.all ? 'cursor-not-allowed' : ''}>
                      <Switch
                        checked={seasonalityAssist}
                        onCheckedChange={(v) => setSeasonalityAssist(!!v)}
                        disabled={!perms.all}
                      />
                    </div>
                  </TooltipTrigger>
                  {!perms.all ? <TooltipContent>{lockedMsg}</TooltipContent> : null}
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          {/* Calendar highlight color (compact, less prominent) */}
          <div className="mt-3 grid gap-1 pb-4">
            <Label className="text-muted-foreground text-xs">Calendar highlight color</Label>
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="inline-flex min-w-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
                style={{
                  backgroundColor: color,
                  borderColor: 'color-mix(in srgb, var(--border) 55%, transparent)',
                  color: 'hsl(var(--foreground))',
                  opacity: 0.9,
                }}
              >
                <span className="block max-w-[100px] truncate">{campaign.name || 'Preview'}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {palette.map((hex) => {
                  const selected = hex === color;
                  return (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => perms.color && setColor(hex)}
                      disabled={!perms.color}
                      className={[
                        'ring-offset-background focus-visible:ring-ring inline-flex h-6 w-6 items-center justify-center rounded-full border transition-shadow focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
                        selected ? 'ring-ring shadow-sm ring-2' : 'hover:shadow-sm',
                      ].join(' ')}
                      style={{
                        backgroundColor: hex,
                        borderColor: 'color-mix(in srgb, var(--border) 65%, transparent)',
                      }}
                      aria-label={`Set calendar highlight color to ${hex}`}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="bg-background border-border shrink-0 flex-row justify-end gap-2 border-t px-1 pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={saving || (!perms.all && !perms.name && !perms.color)}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
