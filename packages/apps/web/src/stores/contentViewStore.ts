import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ContentViewState {
  selectedSocialAccountIdsByBrandId: Record<string, string[] | null | undefined>;
  setSelectedSocialAccountIds: (brandId: string, socialAccountIds: string[] | null) => void;
  clearSelectedSocialAccountIds: (brandId: string) => void;
}

export const useContentViewStore = create<ContentViewState>()(
  persist(
    (set) => ({
      selectedSocialAccountIdsByBrandId: {},

      setSelectedSocialAccountIds: (brandId, socialAccountIds) => {
        set((state) => ({
          selectedSocialAccountIdsByBrandId: {
            ...state.selectedSocialAccountIdsByBrandId,
            [brandId]: socialAccountIds,
          },
        }));
      },

      clearSelectedSocialAccountIds: (brandId) => {
        set((state) => {
          const next = { ...state.selectedSocialAccountIdsByBrandId };
          delete next[brandId];
          return { selectedSocialAccountIdsByBrandId: next };
        });
      },
    }),
    {
      name: 'content-view-storage',
      partialize: (state) => ({
        selectedSocialAccountIdsByBrandId: state.selectedSocialAccountIdsByBrandId,
      }),
    }
  )
);
