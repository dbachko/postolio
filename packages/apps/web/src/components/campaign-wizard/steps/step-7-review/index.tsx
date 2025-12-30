import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useCampaignWizard } from '@/hooks/useCampaignWizard';
import { useBrandStore } from '@/stores/brandStore';
import { brand as brandApi, campaign as campaignApi, httpPost } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { formatSocialAccountHandle, formatSocialAccountLabel } from '@/lib/social-account-label';
import { ReviewCard } from './components/review-card';
import { DestinationCard } from './components/destination-card';
import { ValidationIssuesAlert } from './components/validation-issues-alert';
import type { ValidationIssue } from './types';
import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';

export function Step7Review() {
  const navigate = useNavigate();
  const brand = useBrandStore((s) => s.selectedBrand);
  const state = useCampaignWizard();
  const { setStep, prevStep, reset } = useCampaignWizard();
  const [isSubmitting, setSubmitting] = useState(false);
  const queryClient = useQueryClient();

  const socialAccountsQuery = useQuery({
    queryKey: ['brand-social-accounts', brand?.id],
    enabled: Boolean(brand?.id),
    queryFn: () => brandApi.getConnectedAccounts(brand!.id),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const destinationOptions = useMemo((): SocialAccountsPickerOption[] => {
    const items = socialAccountsQuery.data?.socialAccounts ?? [];
    return items
      .filter((account) => !account.disconnected)
      .map((account) => {
        const username =
          typeof account.username === 'string' && account.username.trim()
            ? account.username.trim()
            : null;
        const displayName =
          typeof account.displayName === 'string' && account.displayName.trim()
            ? account.displayName.trim()
            : null;

        const label = formatSocialAccountLabel({
          platform: account.platform,
          username,
          displayName,
        });
        const handle = formatSocialAccountHandle(account.platform, username);
        const tooltipLabel = handle
          ? `${account.platform} · ${handle}`
          : displayName
            ? `${account.platform} · ${displayName}`
            : account.platform;

        return {
          id: account.id,
          platform: account.platform as any,
          label,
          tooltipLabel,
          avatarName: displayName || username || account.platform,
          avatarUrl: account.profilePictureUrl ?? null,
        };
      });
  }, [socialAccountsQuery.data?.socialAccounts]);

  const effectiveDefaultDestinationId = useMemo(() => {
    const optionIds = new Set(destinationOptions.map((o) => o.id));
    const rawDefaults = socialAccountsQuery.data?.defaultPostSocialAccountIds ?? [];
    const firstDefault = rawDefaults.find((id) => optionIds.has(id)) ?? null;
    if (firstDefault) return firstDefault;
    const primaryId = socialAccountsQuery.data?.primarySocialAccountId ?? null;
    return primaryId && optionIds.has(primaryId) ? primaryId : null;
  }, [
    destinationOptions,
    socialAccountsQuery.data?.defaultPostSocialAccountIds,
    socialAccountsQuery.data?.primarySocialAccountId,
  ]);

  const customDestinationsInitializedRef = useRef(false);
  useEffect(() => {
    if (state.useDefaultDestinations) {
      customDestinationsInitializedRef.current = false;
      return;
    }
    if (customDestinationsInitializedRef.current) return;
    if (state.targetSocialAccountIds.length > 0) {
      customDestinationsInitializedRef.current = true;
      return;
    }
    if (!effectiveDefaultDestinationId) return;

    useCampaignWizard.setState({
      targetSocialAccountIds: [effectiveDefaultDestinationId],
    });
    customDestinationsInitializedRef.current = true;
  }, [
    effectiveDefaultDestinationId,
    state.targetSocialAccountIds.length,
    state.useDefaultDestinations,
  ]);

  const summary = useMemo(() => {
    return {
      type: state.campaignType || 'custom',
      name: state.name,
      goals: Array.isArray(state.goals) ? state.goals : [],
      timeline: state.timeline,
      themes: state.themes,
      style: state.style,
      frequency: state.frequency,
      postingTime: state.postingTime,
      promotionDetails: state.promotionDetails,
      seasonalityAssist: state.seasonalityAssist,
    };
  }, [state]);

  const canLaunch =
    !!brand &&
    !!summary.timeline?.startDate &&
    !!summary.timeline?.endDate &&
    !!summary.frequency &&
    state.themes.length > 0 &&
    (state.useDefaultDestinations || state.targetSocialAccountIds.length > 0);

  const validationIssues = useMemo((): ValidationIssue[] => {
    const issues: ValidationIssue[] = [];
    if (!brand) {
      issues.push({ field: 'brand', message: 'Select a brand', step: 0 });
    }
    if (!summary.timeline?.startDate) {
      issues.push({ field: 'startDate', message: 'Set a start date', step: 2 });
    }
    if (!summary.timeline?.endDate) {
      issues.push({ field: 'endDate', message: 'Set an end date', step: 2 });
    }
    if (!summary.frequency) {
      issues.push({ field: 'frequency', message: 'Choose posting frequency', step: 2 });
    }
    if (state.themes.length === 0) {
      issues.push({ field: 'themes', message: 'Add at least one theme', step: 3 });
    }
    if (!state.useDefaultDestinations && state.targetSocialAccountIds.length === 0) {
      issues.push({
        field: 'destinations',
        message: 'Choose at least one destination (or use defaults)',
        step: 7,
      });
    }
    return issues;
  }, [
    brand,
    summary,
    state.targetSocialAccountIds.length,
    state.themes.length,
    state.useDefaultDestinations,
  ]);

  const handleLaunch = async () => {
    if (!brand) return;
    setSubmitting(true);
    try {
      const payload = {
        ...(state.name && state.name.trim().length > 0 ? { name: state.name } : {}),
        brandId: brand.id,
        duration: { start: state.timeline!.startDate, end: state.timeline!.endDate },
        frequency: state.frequency!,
        themes: state.themes,
        style: state.style,
        postingTime: state.postingTime,
        ...(state.useDefaultDestinations
          ? {}
          : state.targetSocialAccountIds.length > 0
            ? { targetSocialAccountIds: state.targetSocialAccountIds }
            : {}),
        campaignType: state.campaignType || 'custom',
        promotionDetails: state.promotionDetails || undefined,
        contentPillars: state.contentPillars || undefined,
        goals: Array.isArray(state.goals) ? state.goals : undefined,
        seasonalityAssist: state.seasonalityAssist,
        imageProvider: state.imageProvider || undefined,
      } as const;

      const response = (await campaignApi.createCampaign(payload)) as {
        success: boolean;
        campaign: { id: string; name: string; status: string };
      };

      queryClient.invalidateQueries({ queryKey: ['campaigns', brand.id] });
      queryClient.invalidateQueries({ queryKey: ['calendar', brand.id] });

      try {
        await httpPost('/api/analytics/wizard-event', {
          eventName: 'wizard.launch',
          step: 7,
          brandId: brand.id,
        });
      } catch (_e) {
        // ignore telemetry errors
      }

      toast.success('Campaign created. Generating preview posts...');

      const allowNavigationRef = useCampaignWizard.getState().allowNavigationRef;
      if (allowNavigationRef) {
        allowNavigationRef.current = true;
      }
      useCampaignWizard.setState({ skipUnsavedWarning: true });

      navigate(`/campaigns/${response.campaign.id}`);
      setTimeout(() => reset(), 0);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to create campaign');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {!brand && (
        <Alert>
          <AlertDescription>Select a brand to continue.</AlertDescription>
        </Alert>
      )}

      <ReviewCard
        summary={summary as any}
        onEditType={() => setStep(1)}
        onToggleSeasonality={(v) => useCampaignWizard.setState({ seasonalityAssist: v })}
        onEditGoals={() => setStep(2)}
        onEditTimeline={() => setStep(2)}
        onEditThemes={() => setStep(2)}
      />

      <DestinationCard
        destinationOptions={destinationOptions}
        effectiveDefaultDestinationId={effectiveDefaultDestinationId}
        isUseDefaultDestinations={state.useDefaultDestinations}
        targetSocialAccountIds={state.targetSocialAccountIds}
        isLoading={socialAccountsQuery.isLoading}
        onToggleUseDefaultDestinations={(v) =>
          useCampaignWizard.setState({ useDefaultDestinations: v })
        }
        onChangeTargetSocialAccountIds={(value) =>
          useCampaignWizard.setState({ targetSocialAccountIds: value })
        }
      />

      <ValidationIssuesAlert issues={validationIssues} onGoToStep={setStep} />

      <div className="flex justify-between">
        <Button variant="outline" onClick={prevStep}>
          Back
        </Button>
        <Button onClick={handleLaunch} disabled={!canLaunch || isSubmitting}>
          {isSubmitting ? 'Creating…' : 'Create Campaign'}
        </Button>
      </div>
    </div>
  );
}
