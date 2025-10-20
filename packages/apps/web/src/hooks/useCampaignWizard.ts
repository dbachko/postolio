import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import debounce from 'lodash.debounce';
import { useEffect, useMemo } from 'react';
import { campaign as campaignApi, httpPost } from '../lib/api';
import { useBrandStore } from '../stores/brandStore';
import type {
  CampaignWizardState,
  CampaignType,
  CampaignTypeConfig,
  PromotionDetails,
} from '../types/campaign-wizard';

type WizardActions = {
  setBrandId: (brandId: string | null) => void;
  setStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  setCampaignType: (type: CampaignType) => void;
  loadDefaultsFromType: (cfg: CampaignTypeConfig) => void;
  updateField: <K extends keyof CampaignWizardState>(key: K, value: CampaignWizardState[K]) => void;
  updatePromotionDetails: (value: PromotionDetails | null) => void;
  reset: () => void;
  saveDraft: () => Promise<void>;
  hydrateFromDraft: (draft: Partial<CampaignWizardState> & { draftId?: string }) => void;
};

const initialState: CampaignWizardState = {
  currentStep: 1,
  brandId: null,
  name: '',
  campaignType: null,
  goals: [],
  timeline: null,
  themes: [],
  style: '',
  frequency: '',
  postingTime: '12:00',
  priority: 5,
  promotionDetails: null,
  contentPillars: null,
  acceptedRecommendations: [],
  saveStatus: 'idle',
  draftId: undefined,
  seasonalityAssist: true,
  strategyPredictions: null,
  strategyPredictionsMeta: null,
  strategySchedule: null,
};

export const useCampaignWizard = create<CampaignWizardState & WizardActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      setBrandId: (brandId) => set({ brandId }),
      setStep: (step) => set({ currentStep: Math.max(1, Math.min(5, step)) }),
      nextStep: () => set({ currentStep: Math.min(5, get().currentStep + 1) }),
      prevStep: () => set({ currentStep: Math.max(1, get().currentStep - 1) }),

      setCampaignType: (type) => set({ campaignType: type }),
      loadDefaultsFromType: (cfg) => {
        const { timeline } = get();
        const now = new Date();
        const startISO = now.toISOString().split('T')[0]!;
        const end = new Date(now);
        end.setDate(end.getDate() + cfg.defaultDuration.days);
        const endISO = end.toISOString().split('T')[0]!;
        set({
          campaignType: cfg.id,
          frequency: cfg.defaultFrequency,
          timeline: timeline || { startDate: startISO, endDate: endISO },
          // Do not preload static themes; we will fetch suggestions from API
          themes: [],
        });
      },

      updateField: (key, value) => set({ [key]: value } as unknown as Partial<CampaignWizardState>),
      updatePromotionDetails: (value) => set({ promotionDetails: value }),

      reset: () => set({ ...initialState }),

      hydrateFromDraft: (draft) => {
        const next: Partial<CampaignWizardState> = {};
        for (const key of Object.keys(initialState) as (keyof CampaignWizardState)[]) {
          if (draft[key] !== undefined) {
            // dynamic assignment with runtime cast
            if (key === 'goals') {
              const g = (draft as any)[key];
              // Migrate legacy string to array (split by newline/semicolon)
              (next as any)[key] = Array.isArray(g)
                ? g
                : typeof g === 'string'
                  ? g
                      .split(/\n|;/)
                      .map((s) => s.trim())
                      .filter(Boolean)
                  : [];
            } else {
              (next as any)[key] = (draft as any)[key];
            }
          }
        }
        set({
          ...initialState,
          ...next,
          draftId:
            draft.draftId ??
            (draft as any).id ??
            (useCampaignWizard.getState().draftId || undefined),
        });
      },

      saveDraft: async () => {
        try {
          const state = get();
          if (!state.brandId) return; // Cannot save without brand
          set({ saveStatus: 'saving' });
          const payload = {
            currentStep: state.currentStep,
            brandId: state.brandId,
            name: state.name,
            campaignType: state.campaignType,
            goals: state.goals,
            timeline: state.timeline,
            themes: state.themes,
            style: state.style,
            frequency: state.frequency,
            postingTime: state.postingTime,
            priority: state.priority,
            promotionDetails: state.promotionDetails,
            contentPillars: state.contentPillars,
            acceptedRecommendations: state.acceptedRecommendations,
            strategyPredictions: state.strategyPredictions,
            strategyPredictionsMeta: state.strategyPredictionsMeta,
            strategySchedule: state.strategySchedule,
          } as const;
          const res = await campaignApi.saveCampaignDraft({
            brandId: state.brandId,
            wizardState: payload as unknown as Record<string, unknown>,
            draftId: state.draftId,
          });
          set({ saveStatus: 'saved', draftId: res.draftId });
        } catch (err) {
          console.error('Auto-save failed', err);
          set({ saveStatus: 'error' });
        }
      },
    }),
    {
      name: 'campaign-wizard-storage',
      partialize: (state) => ({
        currentStep: state.currentStep,
        brandId: state.brandId,
        name: state.name,
        campaignType: state.campaignType,
        goals: state.goals,
        timeline: state.timeline,
        themes: state.themes,
        style: state.style,
        frequency: state.frequency,
        postingTime: state.postingTime,
        priority: state.priority,
        promotionDetails: state.promotionDetails,
        contentPillars: state.contentPillars,
        acceptedRecommendations: state.acceptedRecommendations,
        draftId: state.draftId,
        seasonalityAssist: state.seasonalityAssist,
        strategyPredictions: state.strategyPredictions,
        strategyPredictionsMeta: state.strategyPredictionsMeta,
        strategySchedule: state.strategySchedule,
      }),
    }
  )
);

// Auto-save side effect hook to be used in components
export function useWizardAutoSave(): void {
  const brand = useBrandStore((s) => s.selectedBrand);
  const state = useCampaignWizard();

  const debouncedSave = useMemo(
    () =>
      debounce(() => {
        useCampaignWizard
          .getState()
          .saveDraft()
          .catch(() => {});
      }, 3000),
    []
  );

  useEffect(() => {
    if (brand && state.brandId !== brand.id) {
      useCampaignWizard.setState({ brandId: brand.id });
    }
  }, [brand?.id, state.brandId]);

  useEffect(() => {
    // Trigger save when wizard state changes (excluding volatile fields inside saveDraft itself)
    debouncedSave();
    return () => {
      debouncedSave.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.brandId,
    state.name,
    state.campaignType,
    JSON.stringify(state.goals || []),
    state.timeline?.startDate,
    state.timeline?.endDate,
    state.themes.join('|'),
    state.style,
    state.frequency,
    state.postingTime,
    state.priority,
    state.promotionDetails?.discountPercentage,
    state.promotionDetails?.promoCode,
    state.promotionDetails?.limitedQuantity,
    // Include fields updated on strategy step so server draft persists them
    JSON.stringify(state.contentPillars?.pillars || []),
    JSON.stringify(state.acceptedRecommendations || []),
    JSON.stringify(state.strategyPredictions || null),
    JSON.stringify(state.strategyPredictionsMeta || null),
    JSON.stringify(state.strategySchedule || null),
  ]);

  // Wizard funnel instrumentation: step changes
  useEffect(() => {
    if (!state.brandId) return;
    // Fire and forget; ignore errors
    httpPost('/api/analytics/wizard-event', {
      eventName: 'wizard.step',
      step: state.currentStep,
      brandId: state.brandId,
    }).catch(() => {});
  }, [state.currentStep, state.brandId]);
}
