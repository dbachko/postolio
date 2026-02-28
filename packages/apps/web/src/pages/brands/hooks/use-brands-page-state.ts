import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { brand as brandApi, type Brand } from '@/lib/api';
import { useBrandStore } from '@/stores/brandStore';

type EditFormValues = { name: string; description: string; countryCode: string };

type CreateFormValues = { name: string; description: string; countryCode: string };

type ProfileSummary = { tones: string[]; palette: string[] };

function useBrandsStoreQuery() {
  const queryClient = useQueryClient();
  const store = useBrandStore();
  const brandsQuery = useQuery({ queryKey: ['brands'], queryFn: () => brandApi.getBrands() });
  const fetchedBrands = brandsQuery.data?.brands;
  const { setBrands, initializeSelectedBrand } = store;

  useEffect(() => {
    if (!fetchedBrands) {
      return;
    }
    setBrands(fetchedBrands);
    initializeSelectedBrand(fetchedBrands);
  }, [fetchedBrands, initializeSelectedBrand, setBrands]);

  return { queryClient, store, brandsQuery };
}

function useBrandProfileAvailability(brands: Brand[]) {
  const [profileAvailable, setProfileAvailable] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const load = async () => {
      const entries = await Promise.all(
        (brands || []).map(
          async (brand) => [brand.id, await brandApi.hasBrandProfileProjection(brand.id)] as const
        )
      );
      setProfileAvailable(Object.fromEntries(entries));
    };
    if (brands.length > 0) {
      void load();
    }
  }, [brands]);

  return { profileAvailable, setProfileAvailable };
}

function useBrandProfileSummaries(brands: Brand[], profileAvailable: Record<string, boolean>) {
  const [profileSummaries, setProfileSummaries] = useState<Record<string, ProfileSummary>>({});

  useEffect(() => {
    const fetchSummaries = async () => {
      const toFetch = brands.filter(
        (brand) => profileAvailable[brand.id] && !profileSummaries[brand.id]
      );
      if (toFetch.length === 0) {
        return;
      }

      const results = await Promise.all(
        toFetch.map(async (brand) => {
          try {
            const profile = await brandApi.getBrandAnalysisProfile(brand.id);
            if ('error' in profile) {
              return [brand.id, null] as const;
            }
            return [
              brand.id,
              {
                tones: Array.isArray(profile.text?.tone) ? profile.text!.tone.slice(0, 3) : [],
                palette: Array.isArray(profile.visual?.palette)
                  ? profile.visual!.palette.slice(0, 3)
                  : [],
              },
            ] as const;
          } catch {
            return [brand.id, null] as const;
          }
        })
      );

      const next: Record<string, ProfileSummary> = {};
      for (const [brandId, summary] of results) {
        if (summary) {
          next[brandId] = summary;
        }
      }
      if (Object.keys(next).length > 0) {
        setProfileSummaries((current) => ({ ...current, ...next }));
      }
    };

    if (brands.length > 0) {
      void fetchSummaries();
    }
  }, [brands, profileAvailable, profileSummaries]);

  return { profileSummaries, setProfileSummaries };
}

function useBrandMutations(params: {
  queryClient: ReturnType<typeof useQueryClient>;
  removeBrand: (brandId: string) => void;
  updateBrand: (brand: Brand) => void;
  setIsCreating: React.Dispatch<React.SetStateAction<boolean>>;
  setCreateFormData: React.Dispatch<React.SetStateAction<CreateFormValues>>;
  setEditingBrandId: React.Dispatch<React.SetStateAction<string | null>>;
  setEditFormData: React.Dispatch<React.SetStateAction<Record<string, EditFormValues>>>;
}) {
  const createBrandMutation = useMutation({
    mutationFn: (data: CreateFormValues) =>
      brandApi.createBrand({
        name: data.name,
        description: data.description,
        countryCode: data.countryCode ? data.countryCode.toUpperCase() : null,
      }),
    onSuccess: () => {
      params.queryClient.invalidateQueries({ queryKey: ['brands'] });
      params.setIsCreating(false);
      params.setCreateFormData({ name: '', description: '', countryCode: '' });
    },
    onError: (error) => console.error('Brand creation error:', error),
  });

  const deleteBrandMutation = useMutation({
    mutationFn: (brandId: string) => brandApi.deleteBrand(brandId),
    onSuccess: (_, brandId) => {
      params.removeBrand(brandId);
      params.queryClient.invalidateQueries({ queryKey: ['brands'] });
    },
    onError: (error) => console.error('Brand deletion error:', error),
  });

  const updateBrandMutation = useMutation({
    mutationFn: ({ brandId, data }: { brandId: string; data: Partial<EditFormValues> }) =>
      brandApi.updateBrand(brandId, data),
    onSuccess: (response) => {
      params.updateBrand(response.brand);
      params.queryClient.invalidateQueries({ queryKey: ['brands'] });
      params.setEditingBrandId(null);
      params.setEditFormData({});
    },
    onError: (error) => console.error('Brand update error:', error),
  });

  return { createBrandMutation, deleteBrandMutation, updateBrandMutation };
}

export function useBrandsPageState() {
  const [isCreating, setIsCreating] = useState(false);
  const [editingBrandId, setEditingBrandId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<Record<string, EditFormValues>>({});
  const [createFormData, setCreateFormData] = useState<CreateFormValues>({
    name: '',
    description: '',
    countryCode: '',
  });

  const { queryClient, store, brandsQuery } = useBrandsStoreQuery();
  const { brands, selectedBrand, removeBrand, updateBrand } = store;
  const availability = useBrandProfileAvailability(brands);
  const summaries = useBrandProfileSummaries(brands, availability.profileAvailable);
  const mutations = useBrandMutations({
    queryClient,
    removeBrand,
    updateBrand,
    setIsCreating,
    setCreateFormData,
    setEditingBrandId,
    setEditFormData,
  });

  return {
    isCreating,
    setIsCreating,
    editingBrandId,
    setEditingBrandId,
    editFormData,
    setEditFormData,
    createFormData,
    setCreateFormData,
    brands,
    selectedBrand,
    hasExistingBrand: brands.length > 0,
    profileAvailable: availability.profileAvailable,
    profileSummaries: summaries.profileSummaries,
    brandsLoading: brandsQuery.isLoading,
    createBrandMutation: mutations.createBrandMutation,
    deleteBrandMutation: mutations.deleteBrandMutation,
    updateBrandMutation: mutations.updateBrandMutation,
    setSelectedBrand: store.setSelectedBrand,
  };
}
