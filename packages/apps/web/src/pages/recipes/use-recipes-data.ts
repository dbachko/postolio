import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { brand as brandApi, recipes as recipesApi, skills as skillsApi } from '@/lib/api';
import type { RecipeSummary } from '@/lib/api/recipes-client';
import type { SkillSummary } from '@/lib/api/skills-client';
import { formatSocialAccountLabel } from '@/lib/social-account-label';
import { getEnabledPlatforms, type Platform } from '@/lib/platform-config';
import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';

function useSkillById(skills: SkillSummary[]) {
  return useMemo(() => new Map(skills.map((skill) => [skill.id, skill] as const)), [skills]);
}

function useDestinationPickerOptions({
  socialAccounts,
  multiDestinationEnabled,
}: {
  socialAccounts: unknown[];
  multiDestinationEnabled: boolean;
}) {
  return useMemo((): SocialAccountsPickerOption[] => {
    const enabledPlatforms = multiDestinationEnabled
      ? getEnabledPlatforms().map((platform) => platform.id)
      : (['instagram'] as const);
    const enabledSet = new Set<Platform>(enabledPlatforms as Platform[]);

    const accounts = socialAccounts
      .filter(
        (account: any) =>
          account &&
          account.disconnected !== true &&
          typeof account.platform === 'string' &&
          enabledSet.has(account.platform as Platform)
      )
      .slice()
      .sort((a: any, b: any) => {
        const aOrder = typeof a?.sortOrder === 'number' ? a.sortOrder : 0;
        const bOrder = typeof b?.sortOrder === 'number' ? b.sortOrder : 0;
        if (aOrder !== bOrder) {
          return aOrder - bOrder;
        }
        const aCreated = typeof a?.createdAt === 'string' ? a.createdAt : '';
        const bCreated = typeof b?.createdAt === 'string' ? b.createdAt : '';
        if (aCreated !== bCreated) {
          return aCreated.localeCompare(bCreated);
        }
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      });

    return accounts.map((account: any) => {
      const platform = account.platform as Platform;
      const label = formatSocialAccountLabel({
        platform,
        username: account.username ?? null,
        displayName: account.displayName ?? null,
      });
      const avatarName = account.username || account.displayName || platform;

      return {
        id: String(account.id),
        platform,
        label,
        avatarName,
        avatarUrl: account.profilePictureUrl || null,
        disabled: false,
      } satisfies SocialAccountsPickerOption;
    });
  }, [multiDestinationEnabled, socialAccounts]);
}

function usePreferredDestinationId({
  connectedAccountsData,
  destinationPickerOptions,
}: {
  connectedAccountsData: unknown;
  destinationPickerOptions: SocialAccountsPickerOption[];
}) {
  return useMemo(() => {
    const payload = connectedAccountsData as any;
    const byId = new Set(destinationPickerOptions.map((option) => option.id));
    const rawDefaults = Array.isArray(payload?.defaultPostSocialAccountIds)
      ? payload.defaultPostSocialAccountIds
      : [];
    const defaults = rawDefaults
      .filter((id: any) => typeof id === 'string')
      .map((id: string) => id.trim())
      .filter((id: string) => Boolean(id) && byId.has(id));
    if (defaults.length === 1) {
      return defaults[0];
    }

    const primary =
      typeof payload?.primarySocialAccountId === 'string' ? payload.primarySocialAccountId : null;
    if (primary && byId.has(primary)) {
      return primary;
    }

    return destinationPickerOptions[0]?.id ?? null;
  }, [connectedAccountsData, destinationPickerOptions]);
}

export function useRecipesData({
  brandId,
  search,
  multiDestinationEnabled,
}: {
  brandId: string | null;
  search: string;
  multiDestinationEnabled: boolean;
}) {
  const skillsQuery = useQuery({
    queryKey: ['skills', brandId],
    enabled: Boolean(brandId),
    queryFn: async () => {
      const response = await skillsApi.listSkills(brandId!);
      return response.skills;
    },
  });

  const connectedAccountsQuery = useQuery({
    queryKey: ['brand-social-accounts', brandId],
    enabled: Boolean(brandId),
    queryFn: () => brandApi.getConnectedAccounts(brandId!),
    staleTime: 60_000,
  });

  const recipesQuery = useQuery({
    queryKey: ['recipes', brandId, search],
    enabled: Boolean(brandId),
    queryFn: async () => {
      const response = await recipesApi.listRecipes({ brandId: brandId!, q: search || undefined });
      return response.recipes;
    },
  });

  const skills = (skillsQuery.data ?? []) as SkillSummary[];
  const recipes = (recipesQuery.data ?? []) as RecipeSummary[];
  const socialAccounts = (connectedAccountsQuery.data?.socialAccounts || []) as unknown[];
  const skillById = useSkillById(skills);
  const destinationPickerOptions = useDestinationPickerOptions({
    socialAccounts,
    multiDestinationEnabled,
  });
  const preferredDestinationId = usePreferredDestinationId({
    connectedAccountsData: connectedAccountsQuery.data,
    destinationPickerOptions,
  });

  return {
    skillsQuery,
    connectedAccountsQuery,
    recipesQuery,
    skills,
    recipes,
    skillById,
    destinationPickerOptions,
    preferredDestinationId,
  };
}
