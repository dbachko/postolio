import { create } from 'zustand';
import { useEffect } from 'react';
import { useBrandStore } from '../stores/brandStore';
import { formatLocalDate } from '../lib/timezone';
import { addDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
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
  loadDefaultsFromType: (cfg: CampaignTypeConfig, opts?: { timezone?: string }) => void;
  updateField: <K extends keyof CampaignWizardState>(key: K, value: CampaignWizardState[K]) => void;
  updatePromotionDetails: (value: PromotionDetails | null) => void;
  setSkipUnsavedWarning: (value: boolean) => void;
  reset: () => void;
};

const initialState: CampaignWizardState = {
  currentStep: 1,
  brandId: null,
  name: '',
  campaignType: null,
  goals: [],
  timeline: null,
  themes: [],
  style: [],
  imageSource: null, // NEW: Image source preference
  imageProvider: null, // NEW: Image generation provider (for AI images)
  frequency: '',
  postingTime: '12:00',
  useDefaultDestinations: true,
  targetSocialAccountIds: [],
  priority: 5,
  promotionDetails: null,
  contentPillars: null,
  acceptedRecommendations: [],
  saveStatus: 'idle',
  seasonalityAssist: true,
  strategyPredictions: null,
  strategyPredictionsMeta: null,
  strategySchedule: null,
  skipUnsavedWarning: false,
};

export const useCampaignWizard = create<CampaignWizardState & WizardActions>()((set, get) => ({
  ...initialState,

  setBrandId: (brandId) => set({ brandId }),
  setStep: (step) => set({ currentStep: Math.max(1, Math.min(7, step)) }),
  nextStep: () => set({ currentStep: Math.min(7, get().currentStep + 1) }),
  prevStep: () => set({ currentStep: Math.max(1, get().currentStep - 1) }),

  setCampaignType: (type) => set({ campaignType: type }),
  loadDefaultsFromType: (cfg, opts) => {
    const { timeline } = get();

    // Prefer brand timezone for date math so "today" aligns with the brand, not the user.
    const tz = opts?.timezone;
    const formatDate = (date: Date) =>
      tz ? formatInTimeZone(date, tz, 'yyyy-MM-dd') : formatLocalDate(date);

    // Build a midnight anchor in the brand timezone (or local if no tz provided)
    const todayMidnight = tz
      ? fromZonedTime(`${formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')}T00:00:00`, tz)
      : new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

    const end = addDays(todayMidnight, cfg.defaultDuration.days);

    set({
      campaignType: cfg.id,
      frequency: cfg.defaultFrequency,
      timeline: timeline || {
        startDate: formatDate(todayMidnight),
        endDate: formatDate(end),
      },
      // Do not preload static themes; we will fetch suggestions from API
      themes: [],
    });
  },

  updateField: (key, value) => set({ [key]: value } as unknown as Partial<CampaignWizardState>),
  updatePromotionDetails: (value) => set({ promotionDetails: value }),
  setSkipUnsavedWarning: (value) => set({ skipUnsavedWarning: value }),

  reset: () => set({ ...initialState }),
}));

// Auto-save side effect hook to be used in components
export function useWizardBrandSync(): void {
  const brand = useBrandStore((s) => s.selectedBrand);
  const state = useCampaignWizard();
  useEffect(() => {
    if (brand && state.brandId !== brand.id) {
      useCampaignWizard.setState({ brandId: brand.id });
    }
  }, [brand, state.brandId]);
}
