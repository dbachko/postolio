import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { toast } from 'sonner';
import { frequencyOptions, styleOptions } from '../constants/campaign';
import { getStableColorFromId } from '../utils/campaign-colors';
import { getStoredCampaignColor, setStoredCampaignColor } from '@/utils/campaign-color-storage';
import { campaign as campaignApi, type Campaign } from '../lib/api';
import { GoalsListInput } from './campaign-wizard/shared/GoalsListInput';

interface CampaignEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign;
  onSaved?: () => void;
}

type EditableFlags = {
  all: boolean;
  name: boolean;
  priority: boolean;
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
        priority: true,
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
        priority: true,
        dates: false,
        frequency: false,
        postingTime: false,
        themes: false,
        style: false,
        color: true,
        reason: 'Active/paused campaigns only allow editing name and priority.',
      };
    case 'completed':
      return {
        all: false,
        name: false,
        priority: false,
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
        priority: true,
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

export function CampaignEditDialog({
  open,
  onOpenChange,
  campaign,
  onSaved,
}: CampaignEditDialogProps) {
  const [name, setName] = useState(campaign.name);
  const [priority, setPriority] = useState<number>(campaign.priority || 5);
  // Predefined palette (Shadcn/Tailwind 300) via CSS variables
  // IMPORTANT: memoize to avoid recreating each render which caused an effect loop
  const palette: string[] = useMemo(
    () => [
      'var(--swatch-blue-300)',
      'var(--swatch-indigo-300)',
      'var(--swatch-violet-300)',
      'var(--swatch-purple-300)',
      'var(--swatch-fuchsia-300)',
      'var(--swatch-pink-300)',
      'var(--swatch-rose-300)',
      'var(--swatch-orange-300)',
      'var(--swatch-amber-300)',
      'var(--swatch-emerald-300)',
    ],
    []
  );
  const initialColor =
    getStoredCampaignColor(campaign.id) ||
    (campaign as any).color ||
    getStableColorFromId(campaign.id) ||
    palette[0];
  const [color, setColor] = useState<string>(initialColor);
  const [startDate, setStartDate] = useState<string>(campaign.config?.duration?.start || '');
  const [endDate, setEndDate] = useState<string>(campaign.config?.duration?.end || '');
  const [frequency, setFrequency] = useState<string>(campaign.config?.frequency || '');
  const [postingTime, setPostingTime] = useState<string>(campaign.config?.postingTime || '12:00');
  const [themes, setThemes] = useState<string>((campaign.config?.themes || []).join(', '));
  const [style, setStyle] = useState<string>(campaign.config?.style || '');
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

  useEffect(() => {
    if (!open) return;
    // Hydrate when dialog opens in case campaign object changed
    setName(campaign.name);
    setPriority(campaign.priority || 5);
    setColor(
      getStoredCampaignColor(campaign.id) ||
        (campaign as any).color ||
        getStableColorFromId(campaign.id) ||
        palette[0]
    );
    setStartDate(campaign.config?.duration?.start || '');
    setEndDate(campaign.config?.duration?.end || '');
    setFrequency(campaign.config?.frequency || '');
    setPostingTime(campaign.config?.postingTime || '12:00');
    setThemes((campaign.config?.themes || []).join(', '));
    setStyle(campaign.config?.style || '');
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
  }, [open, campaign, palette]);

  const onSubmit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {};

      // Always allow name/priority if permitted
      if (perms.name && name !== campaign.name) updates.name = name.trim();
      if (perms.priority && priority !== campaign.priority) updates.priority = priority;

      // Config-related updates if permitted
      if (perms.dates) {
        if (startDate && startDate !== campaign.config?.duration?.start)
          updates.startDate = startDate;
        if (endDate && endDate !== campaign.config?.duration?.end) updates.endDate = endDate;
      }
      if (perms.frequency && frequency && frequency !== campaign.config?.frequency) {
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
      if (perms.style && style !== (campaign.config?.style || '')) {
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

  const disabledMsg = perms.reason;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit Campaign</DialogTitle>
          <DialogDescription>
            {disabledMsg}
            {perms.all ? (
              <span className="ml-1 text-gray-500">
                Changing themes or style may regenerate preview content.
              </span>
            ) : null}
          </DialogDescription>
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

          <div className="grid gap-2">
            <Label htmlFor="priority">Priority</Label>
            <Input
              id="priority"
              type="number"
              min={1}
              max={10}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              disabled={!perms.priority}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={!perms.dates}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="endDate">End Date</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={!perms.dates}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="frequency">Frequency</Label>
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
            <div className="grid gap-2">
              <Label htmlFor="postingTime">Posting Time</Label>
              <Input
                id="postingTime"
                type="time"
                value={postingTime}
                onChange={(e) => setPostingTime(e.target.value)}
                disabled={!perms.postingTime}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="themes">Themes (comma separated)</Label>
            <Textarea
              id="themes"
              value={themes}
              onChange={(e) => setThemes(e.target.value)}
              disabled={!perms.themes}
              rows={2}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="style">Style</Label>
            <Select
              value={style || undefined}
              onValueChange={(v) => setStyle(v)}
              disabled={!perms.style}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select style" />
              </SelectTrigger>
              <SelectContent>
                {styleOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-2">
          <Label>Goals</Label>
          <GoalsListInput goals={goals} onChange={setGoals} disabled={!perms.all} />
        </div>

        <div className="grid grid-cols-2 items-center gap-2">
          <div>
            <Label>Seasonality Assistance</Label>
            <div className="text-xs text-gray-500">Use seasons/holidays when relevant</div>
          </div>
          <div className="flex justify-end">
            <Switch
              checked={seasonalityAssist}
              onCheckedChange={(v) => setSeasonalityAssist(!!v)}
              disabled={!perms.all}
            />
          </div>
        </div>

        {/* Calendar highlight color (compact, less prominent) */}
        <div className="mt-3 grid gap-1">
          <Label className="text-xs text-gray-600">Calendar highlight color</Label>
          <Select value={color} onValueChange={(v) => perms.color && setColor(v)}>
            <SelectTrigger className="h-8 w-48 justify-between px-2 py-1 text-xs">
              <div
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ backgroundColor: color, color: 'hsl(var(--foreground))', opacity: 0.85 }}
              >
                {campaign.name || 'Preview'}
              </div>
            </SelectTrigger>
            <SelectContent className="w-56">
              {palette.map((hex) => (
                <SelectItem key={hex} value={hex}>
                  <div
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{ backgroundColor: hex, color: 'hsl(var(--foreground))', opacity: 0.85 }}
                  >
                    {campaign.name || 'Preview'}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={saving || (!perms.all && !perms.name && !perms.priority)}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
