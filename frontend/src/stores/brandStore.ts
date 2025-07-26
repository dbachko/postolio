import { create } from 'zustand'

export interface Brand {
  id: string
  name: string
  description: string | null
  instagramHandle: string | null
  styleProfile: any
  createdAt: string
}

interface BrandState {
  brands: Brand[]
  selectedBrand: Brand | null
  isLoading: boolean
  setBrands: (brands: Brand[]) => void
  setSelectedBrand: (brand: Brand | null) => void
  setLoading: (loading: boolean) => void
}

export const useBrandStore = create<BrandState>((set) => ({
  brands: [],
  selectedBrand: null,
  isLoading: false,
  
  setBrands: (brands) => set({ brands }),
  setSelectedBrand: (brand) => set({ selectedBrand: brand }),
  setLoading: (loading) => set({ isLoading: loading }),
}))