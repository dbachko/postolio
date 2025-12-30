import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { frequencyOptions, styleOptions } from '@/constants/campaign';
import { getStableColorFromId } from '@/utils/campaign-colors';
import { getStoredCampaignColor, setStoredCampaignColor } from '@/utils/campaign-color-storage';
import { campaign as campaignApi, type Campaign } from '@/lib/api';
import { useBrandStore } from '@/stores/brandStore';

import { CAMPAIGN_COLOR_PALETTE } from '../constants';
import {
  getEditPermissions,
  normalizeOptionValue,
  toDateInputValue,
  toSelectableStyleValue,
} from '../utils';

type UseCampaignEditDialogStateParams = {
  open: boolean;
  campaign: Campaign;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
};

export function useCampaignEditDialogState({
  open,
  campaign,
  onOpenChange,
  onSaved,
}: UseCampaignEditDialogStateParams) {
  const brands = useBrandStore((s) => s.brands);
  const brandTimezone = useMemo(() => {
    const brand = brands.find((b) => b.id === campaign.brandId);
    return brand?.postingTimezone || undefined;
  }, [brands, campaign.brandId]);

  const palette = CAMPAIGN_COLOR_PALETTE;
  const initialColor =
    getStoredCampaignColor(campaign.id) ||
    (campaign as any).color ||
    getStableColorFromId(campaign.id) ||
    palette[0];

  const [name, setName] = useState(campaign.name);
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
  const [goals, setGoals] = useState<string[]>(() => {
    const raw = (campaign.config as any)?.goals;
    if (Array.isArray(raw)) return raw as string[];
    return ((raw as unknown as string) || '')
      .split(/\n|;/)
      .map((s) => s.trim())
      .filter(Boolean);
  });
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

  return {
    brandTimezone,
    color,
    disabledMsg,
    endDate,
    frequency,
    goals,
    lockedMsg,
    name,
    onSubmit,
    palette,
    perms,
    postingTime,
    saving,
    seasonalityAssist,
    setColor,
    setEndDate,
    setFrequency,
    setGoals,
    setName,
    setPostingTime,
    setSeasonalityAssist,
    setStartDate,
    setStyle,
    setThemes,
    startDate,
    style,
    styleHasCurrent,
    themes,
  };
}
