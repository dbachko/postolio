import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Brand } from '../lib/api';

export interface BrandState {
  brands: Brand[];
  selectedBrand: Brand | null;
  isLoading: boolean;
  setBrands: (brands: Brand[]) => void;
  setSelectedBrand: (brand: Brand | null) => void;
  setLoading: (loading: boolean) => void;
  initializeSelectedBrand: (brands: Brand[]) => void;
  removeBrand: (brandId: string) => void;
  updateBrand: (updatedBrand: Brand) => void;
}

export const useBrandStore = create<BrandState>()(
  persist(
    (set, get) => ({
      brands: [],
      selectedBrand: null,
      isLoading: false,

      setBrands: (brands) => {
        set({ brands });
        // Auto-initialize selected brand if none is selected
        const current = get();
        if (!current.selectedBrand && brands.length > 0) {
          current.initializeSelectedBrand(brands);
        }
      },

      setSelectedBrand: (brand) => {
        set({ selectedBrand: brand });
      },

      setLoading: (loading) => set({ isLoading: loading }),

      initializeSelectedBrand: (brands) => {
        const current = get();
        if (current.selectedBrand) {
          // Check if the currently selected brand still exists in the new brands list
          const stillExists = brands.find((b) => b.id === current.selectedBrand?.id);
          if (stillExists) {
            // Update the selected brand with fresh data
            set({ selectedBrand: stillExists });
            return;
          }
        }
        // If no selected brand or it doesn't exist anymore, select the first one
        if (brands.length > 0) {
          set({ selectedBrand: brands[0] });
        } else {
          set({ selectedBrand: null });
        }
      },

      removeBrand: (brandId) => {
        const current = get();
        const updatedBrands = current.brands.filter((b) => b.id !== brandId);

        // If the deleted brand was selected, select another one
        let newSelectedBrand = current.selectedBrand;
        if (current.selectedBrand?.id === brandId) {
          newSelectedBrand = updatedBrands.length > 0 ? updatedBrands[0] : null;
        }

        set({
          brands: updatedBrands,
          selectedBrand: newSelectedBrand,
        });
      },

      updateBrand: (updatedBrand) => {
        const current = get();
        const updatedBrands = current.brands.map((b) =>
          b.id === updatedBrand.id ? updatedBrand : b
        );

        // Update selected brand if it's the one being updated
        let newSelectedBrand = current.selectedBrand;
        if (current.selectedBrand?.id === updatedBrand.id) {
          newSelectedBrand = updatedBrand;
        }

        set({
          brands: updatedBrands,
          selectedBrand: newSelectedBrand,
        });
      },
    }),
    {
      name: 'brand-storage',
      partialize: (state) => ({
        selectedBrand: state.selectedBrand,
      }),
    }
  )
);
