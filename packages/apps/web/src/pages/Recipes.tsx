import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Filter, Search, X } from 'lucide-react';

import { useBrandStore } from '@/stores/brandStore';
import { AppEmptyState } from '@/components/app-empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { recipes as recipesApi, runs as runsApi } from '@/lib/api';
import { skills as skillsApi } from '@/lib/api';
import { brand as brandApi } from '@/lib/api';
import type { RecipeCategory, RecipeInputField, RecipeSummary } from '@/lib/api/recipes-client';
import type { SkillSummary } from '@/lib/api/skills-client';
import { isMultiDestinationEnabled } from '@/lib/feature-flags';
import { formatSocialAccountLabel } from '@/lib/social-account-label';
import { SocialAccountsPicker } from '@/components/social/social-accounts-picker';
import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';
import { getEnabledPlatforms, type Platform } from '@/lib/platform-config';
import { Skeleton } from '@/components/ui/skeleton';
import AssetPicker from '@/features/assets/components/AssetPicker';
import { SkillIcon } from '@/components/icons/skill-icons';
import { SortControls } from '@/features/assets/components/SortControls';
import type { SortDirection } from '@/features/assets/components/asset-utils';
import { useAuthStore } from '@/stores/authStore';

function toHumanLabel(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const cleaned = s.replace(/[_-]+/g, ' ');
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

function fieldKind(name: string): 'textarea' | 'input' {
  const key = name.toLowerCase();
  if (key.includes('brief') || key.includes('caption')) return 'textarea';
  return 'input';
}

function fieldInputType(name: string): React.HTMLInputTypeAttribute {
  const key = name.toLowerCase();
  if (key.includes('date')) return 'date';
  if (key.includes('url')) return 'url';
  return 'text';
}

function categoryName(category: RecipeCategory): string {
  switch (category) {
    case 'get_started':
      return 'Get started';
    case 'content':
      return 'Content';
    case 'growth':
      return 'Growth';
    case 'social':
      return 'Social';
    case 'other':
    default:
      return 'Other';
  }
}

function categoryEmoji(category: RecipeCategory): string {
  switch (category) {
    case 'get_started':
      return '🚀';
    case 'content':
      return '📝';
    case 'growth':
      return '📈';
    case 'social':
      return '💬';
    case 'other':
    default:
      return '🧰';
  }
}

function categoryLabel(category: RecipeCategory): string {
  return `${categoryEmoji(category)} ${categoryName(category)}`;
}

function normalizeRecipeName(name: string): string {
  const raw = String(name || '');
  return raw.replace(/^sample:\s*/i, '').trim() || raw;
}

function skillFilterEmoji(skillId: string): string {
  switch (skillId) {
    case 'text_generation':
      return '📝';
    case 'image_generation':
      return '🖼️';
    case 'web_fetch':
      return '🌐';
    default:
      return '🧩';
  }
}

function formatSkillFilterLabel(skillId: string, label: string): string {
  return `${skillFilterEmoji(skillId)} ${label}`;
}

function buildLegacyInputFields(recipe: RecipeSummary): RecipeInputField[] {
  const required = Array.isArray(recipe.inputs?.required) ? recipe.inputs.required : [];
  const optional = Array.isArray(recipe.inputs?.optional) ? recipe.inputs.optional : [];
  return [
    ...required.map(
      (key) =>
        ({
          key,
          type:
            fieldKind(key) === 'textarea'
              ? 'textarea'
              : fieldInputType(key) === 'date'
                ? 'date'
                : 'input',
          label: toHumanLabel(key),
          required: true,
        }) satisfies RecipeInputField
    ),
    ...optional.map(
      (key) =>
        ({
          key,
          type:
            fieldKind(key) === 'textarea'
              ? 'textarea'
              : fieldInputType(key) === 'date'
                ? 'date'
                : 'input',
          label: toHumanLabel(key),
          required: false,
        }) satisfies RecipeInputField
    ),
  ];
}

function getRecipeInputFields(recipe: RecipeSummary | null): RecipeInputField[] {
  if (!recipe) return [];
  const fields = Array.isArray(recipe.inputSchema?.fields) ? recipe.inputSchema.fields : [];
  if (fields.length > 0) {
    return fields.map((field) => ({
      ...field,
      type: field.type || 'input',
      label: field.label || toHumanLabel(field.key),
      required: Boolean(field.required),
    }));
  }
  return buildLegacyInputFields(recipe);
}

function isMissingFieldValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.trim().length === 0;
  return value == null;
}

type RecipeReadiness = 'ready' | 'missing_skills' | 'disabled_skills';
type RecipeSortField = 'name' | 'type';

function getRecipeReadiness(
  recipe: RecipeSummary,
  skillById: Map<string, SkillSummary>
): RecipeReadiness {
  const requiredSkills = Array.isArray(recipe.skillsRequired) ? recipe.skillsRequired : [];
  if (requiredSkills.length === 0) return 'ready';

  let hasDisabledSkill = false;
  for (const skillId of requiredSkills) {
    const skill = skillById.get(skillId) || null;
    if (!skill?.installation) return 'missing_skills';
    if (skill.installation.enabled !== true) hasDisabledSkill = true;
  }

  return hasDisabledSkill ? 'disabled_skills' : 'ready';
}

function readinessLabel(readiness: RecipeReadiness): string {
  if (readiness === 'ready') return 'Ready to run';
  if (readiness === 'missing_skills') return 'Missing required skills';
  return 'Required skills disabled';
}

export function Recipes() {
  const { selectedBrand } = useBrandStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const multiDestinationEnabled = isMultiDestinationEnabled(user);

  const [sortField, setSortField] = useState<RecipeSortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categoryFilters, setCategoryFilters] = useState<RecipeCategory[]>([]);
  const [requiredSkillFilters, setRequiredSkillFilters] = useState<string[]>([]);
  const [readinessFilters, setReadinessFilters] = useState<RecipeReadiness[]>([]);
  const [runOpen, setRunOpen] = useState(false);
  const [runRecipe, setRunRecipe] = useState<RecipeSummary | null>(null);
  const [runDestinationIds, setRunDestinationIds] = useState<string[]>([]);

  const [runInput, setRunInput] = useState<Record<string, unknown>>({});
  const [assetPickerFieldKey, setAssetPickerFieldKey] = useState<string | null>(null);

  const brandId = selectedBrand?.id ?? null;

  const skillsQuery = useQuery({
    queryKey: ['skills', brandId],
    enabled: Boolean(brandId),
    queryFn: async () => {
      const res = await skillsApi.listSkills(brandId!);
      return res.skills;
    },
  });

  const connectedAccountsQuery = useQuery({
    queryKey: ['brand-social-accounts', brandId],
    enabled: Boolean(brandId),
    queryFn: () => brandApi.getConnectedAccounts(brandId!),
    staleTime: 60_000,
  });

  const destinationPickerOptions = useMemo((): SocialAccountsPickerOption[] => {
    const enabledPlatforms = multiDestinationEnabled
      ? getEnabledPlatforms().map((p) => p.id)
      : (['instagram'] as const);
    const enabledSet = new Set<Platform>(enabledPlatforms as Platform[]);
    const accounts = (connectedAccountsQuery.data?.socialAccounts || [])
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
        if (aOrder !== bOrder) return aOrder - bOrder;
        const aCreated = typeof a?.createdAt === 'string' ? a.createdAt : '';
        const bCreated = typeof b?.createdAt === 'string' ? b.createdAt : '';
        if (aCreated !== bCreated) return aCreated.localeCompare(bCreated);
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
  }, [connectedAccountsQuery.data?.socialAccounts, multiDestinationEnabled]);

  const preferredDestinationId = useMemo(() => {
    const payload = connectedAccountsQuery.data as any;
    const byId = new Set(destinationPickerOptions.map((o) => o.id));
    const rawDefaults = Array.isArray(payload?.defaultPostSocialAccountIds)
      ? payload.defaultPostSocialAccountIds
      : [];
    const defaults = rawDefaults
      .filter((id: any) => typeof id === 'string')
      .map((id: string) => id.trim())
      .filter((id: string) => Boolean(id) && byId.has(id));
    if (defaults.length === 1) return defaults[0];

    const primary =
      typeof payload?.primarySocialAccountId === 'string' ? payload.primarySocialAccountId : null;
    if (primary && byId.has(primary)) return primary;

    return destinationPickerOptions[0]?.id ?? null;
  }, [connectedAccountsQuery.data, destinationPickerOptions]);

  useEffect(() => {
    if (!runOpen) return;
    if (!preferredDestinationId) return;

    if (!multiDestinationEnabled) {
      if (runDestinationIds.length === 1 && runDestinationIds[0] === preferredDestinationId) {
        return;
      }
      setRunDestinationIds([preferredDestinationId]);
      return;
    }

    if (runDestinationIds.length > 0) return;
    setRunDestinationIds([preferredDestinationId]);
  }, [multiDestinationEnabled, preferredDestinationId, runDestinationIds, runOpen]);

  const selectedRunDestination = useMemo(() => {
    const selectedId = runDestinationIds[0];
    if (!selectedId) return null;
    return destinationPickerOptions.find((option) => option.id === selectedId) || null;
  }, [destinationPickerOptions, runDestinationIds]);

  const recipesQuery = useQuery({
    queryKey: ['recipes', brandId, search],
    enabled: Boolean(brandId),
    queryFn: async () => {
      const res = await recipesApi.listRecipes({ brandId: brandId!, q: search || undefined });
      return res.recipes;
    },
  });

  const createRunMutation = useMutation({
    mutationFn: async (params: { recipe: RecipeSummary; input: Record<string, unknown> }) => {
      if (!brandId) throw new Error('Brand required');
      const versionId = params.recipe.publishedVersion?.id;
      if (!versionId) throw new Error('Recipe is not published');
      const input: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(params.input)) {
        if (v == null) continue;
        if (Array.isArray(v)) {
          const normalized = v
            .map((item) => String(item || '').trim())
            .filter((item) => item.length > 0);
          if (normalized.length === 0) continue;
          input[k] = normalized;
          continue;
        }
        if (typeof v === 'string') {
          const trimmed = v.trim();
          if (trimmed.length === 0) continue;
          input[k] = trimmed;
          continue;
        }
        input[k] = v;
      }
      const targetId = runDestinationIds[0];
      if (typeof targetId !== 'string' || targetId.trim().length === 0) {
        throw new Error('Destination is required');
      }
      input.target_social_account_id = targetId.trim();
      return await runsApi.createRun({
        brandId,
        recipeVersionId: versionId,
        trigger: 'manual',
        input,
      });
    },
    onSuccess: (res) => {
      toast.success('Generation started');
      setRunOpen(false);
      setRunRecipe(null);
      setRunInput({});
      setAssetPickerFieldKey(null);
      navigate(`/runs/${res.runId}`);
    },
    onError: (err) => {
      const data = err instanceof Error ? ((err as any).data as any) : null;
      const missing = data?.details?.missingSkills as undefined | Array<{ skillId: string }>;
      if (Array.isArray(missing) && missing.length) {
        toast.error(`Missing required skills: ${missing.map((m) => m.skillId).join(', ')}`);
        return;
      }
      if (data?.code === 'INSUFFICIENT_AI_CREDITS') {
        const shortfall = Number(data?.details?.shortfallCredits || 0);
        const balance = Number(data?.details?.balanceCredits || 0);
        toast.error(
          shortfall > 0
            ? `Not enough AI credits (${balance} available, short by ${shortfall}).`
            : 'Not enough AI credits.'
        );
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Failed to start run');
    },
  });

  const creditsQuery = useQuery({
    queryKey: ['run-credits', brandId],
    enabled: Boolean(brandId),
    queryFn: async () => {
      const res = await runsApi.getCredits(brandId!);
      return res.credits;
    },
  });

  const runEstimateQuery = useQuery({
    queryKey: ['run-estimate', brandId, runRecipe?.publishedVersion?.id],
    enabled: Boolean(runOpen && brandId && runRecipe?.publishedVersion?.id),
    queryFn: async () =>
      await runsApi.estimateRun({
        brandId: brandId!,
        recipeVersionId: runRecipe!.publishedVersion!.id,
        input: runInput,
      }),
  });

  const topUpMutation = useMutation({
    mutationFn: async () => {
      if (!brandId) throw new Error('Brand required');
      return await runsApi.topUpCredits({ brandId, credits: 1000 });
    },
    onSuccess: async () => {
      toast.success('Added 1000 AI credits');
      await queryClient.invalidateQueries({ queryKey: ['run-credits', brandId] });
      await queryClient.invalidateQueries({
        queryKey: ['run-estimate', brandId, runRecipe?.publishedVersion?.id],
      });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to top up credits');
    },
  });

  const recipes = recipesQuery.data ?? [];
  const runEstimate = runEstimateQuery.data;
  const enforcementEnabled =
    runEstimate?.enforcementEnabled ?? creditsQuery.data?.enforcementEnabled ?? false;
  const runShortfall = runEstimate?.shortfallCredits ?? 0;
  const blocksRunForCredits = enforcementEnabled && runShortfall > 0;

  const skillById = useMemo(() => {
    const skills = (skillsQuery.data ?? []) as SkillSummary[];
    return new Map(skills.map((s) => [s.id, s] as const));
  }, [skillsQuery.data]);
  const hasAnyActiveFilters =
    Boolean(search.trim()) ||
    categoryFilters.length > 0 ||
    requiredSkillFilters.length > 0 ||
    readinessFilters.length > 0;
  const activeFilterCount =
    (search.trim().length > 0 ? 1 : 0) +
    (categoryFilters.length > 0 ? 1 : 0) +
    (requiredSkillFilters.length > 0 ? 1 : 0) +
    (readinessFilters.length > 0 ? 1 : 0);
  const canFilterByReadiness = !skillsQuery.isLoading;

  const categoryFilterOptions = useMemo(() => {
    const order: RecipeCategory[] = ['get_started', 'content', 'growth', 'social', 'other'];
    return order.filter((category) => recipes.some((recipe) => recipe.category === category));
  }, [recipes]);

  const requiredSkillFilterOptions = useMemo(() => {
    const ids = new Set<string>();
    recipes.forEach((recipe) => {
      const req = Array.isArray(recipe.skillsRequired) ? recipe.skillsRequired : [];
      req.forEach((id) => {
        const key = String(id || '').trim();
        if (key) ids.add(key);
      });
    });
    return Array.from(ids)
      .map((id) => {
        const baseLabel = skillById.get(id)?.name || toHumanLabel(id);
        return { id, label: baseLabel, displayLabel: formatSkillFilterLabel(id, baseLabel) };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [recipes, skillById]);
  const requiredSkillFilterLabelById = useMemo(
    () => new Map(requiredSkillFilterOptions.map((item) => [item.id, item.displayLabel] as const)),
    [requiredSkillFilterOptions]
  );

  const filteredRecipes = useMemo(() => {
    return recipes.filter((recipe) => {
      if (categoryFilters.length > 0 && !categoryFilters.includes(recipe.category)) return false;

      if (requiredSkillFilters.length > 0) {
        const required = Array.isArray(recipe.skillsRequired) ? recipe.skillsRequired : [];
        if (!requiredSkillFilters.some((skillId) => required.includes(skillId))) return false;
      }

      if (readinessFilters.length > 0) {
        if (!canFilterByReadiness) return false;
        const readiness = getRecipeReadiness(recipe, skillById);
        if (!readinessFilters.includes(readiness)) return false;
      }

      return true;
    });
  }, [
    recipes,
    categoryFilters,
    requiredSkillFilters,
    readinessFilters,
    canFilterByReadiness,
    skillById,
  ]);
  const sortedRecipes = useMemo(() => {
    const sorted = [...filteredRecipes];
    const multiplier = sortDirection === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
      const aName = normalizeRecipeName(a.name).toLowerCase();
      const bName = normalizeRecipeName(b.name).toLowerCase();
      const aType = categoryName(a.category).toLowerCase();
      const bType = categoryName(b.category).toLowerCase();

      switch (sortField) {
        case 'type':
          return aType.localeCompare(bType) * multiplier || aName.localeCompare(bName);
        case 'name':
        default:
          return aName.localeCompare(bName) * multiplier || aType.localeCompare(bType);
      }
    });

    return sorted;
  }, [filteredRecipes, sortDirection, sortField, skillById]);

  const runInputFields = useMemo(() => getRecipeInputFields(runRecipe), [runRecipe]);
  const runRequiredInputFields = useMemo(
    () => runInputFields.filter((field) => field.required),
    [runInputFields]
  );
  const runOptionalInputFields = useMemo(
    () => runInputFields.filter((field) => !field.required),
    [runInputFields]
  );
  const activeAssetPickerField = useMemo(() => {
    if (!assetPickerFieldKey) return null;
    return runInputFields.find((field) => field.key === assetPickerFieldKey) || null;
  }, [assetPickerFieldKey, runInputFields]);

  const toggleCategoryFilter = (category: RecipeCategory) => {
    setCategoryFilters((prev) =>
      prev.includes(category) ? prev.filter((item) => item !== category) : [...prev, category]
    );
  };

  const toggleRequiredSkillFilter = (skillId: string) => {
    setRequiredSkillFilters((prev) =>
      prev.includes(skillId) ? prev.filter((item) => item !== skillId) : [...prev, skillId]
    );
  };

  const toggleReadinessFilter = (value: RecipeReadiness) => {
    setReadinessFilters((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
    );
  };

  const clearFilters = () => {
    setSearch('');
    setCategoryFilters([]);
    setRequiredSkillFilters([]);
    setReadinessFilters([]);
  };

  if (!selectedBrand) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AppEmptyState
          variant="minimal"
          title="Select a brand to use recipes"
          description="Choose which brand you want to generate content for."
          actions={[{ label: 'Choose Brand', to: '/brands' }]}
        />
      </div>
    );
  }

  const openRunDialog = (recipe: RecipeSummary) => {
    // Best-effort prerequisite check (backend is source of truth).
    if (skillsQuery.data) {
      const skills = skillsQuery.data as SkillSummary[];
      const enabled = new Set(
        skills
          .filter((s) => s.installation?.enabled)
          .map((s) => s.id)
          .filter(Boolean)
      );
      const requiredSkills = Array.isArray(recipe.skillsRequired) ? recipe.skillsRequired : [];
      const missing = requiredSkills.filter((id) => !enabled.has(id));
      if (missing.length) {
        toast.error(`Missing required skills: ${missing.join(', ')}`);
        navigate(`/skills?skill=${encodeURIComponent(missing[0])}`);
        return;
      }
    }

    setRunRecipe(recipe);
    setRunDestinationIds(preferredDestinationId ? [preferredDestinationId] : []);
    const fields = getRecipeInputFields(recipe);
    const next: Record<string, unknown> = {};
    fields.forEach((field) => {
      if (field.default != null) {
        next[field.key] = field.default;
        return;
      }
      if (
        field.multiple ||
        field.type === 'asset_picker' ||
        field.type === 'asset_reference_selector'
      ) {
        next[field.key] = [];
        return;
      }
      next[field.key] = '';
    });
    setRunInput(next);
    setAssetPickerFieldKey(null);
    setRunOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-semibold">Recipes</h1>
          <p className="text-muted-foreground text-sm">
            Generate content from reusable workflows powered by skills and AI.
          </p>
          {creditsQuery.data ? (
            <p className="text-muted-foreground mt-1 text-xs">
              AI credits: <span className="font-mono">{creditsQuery.data.balanceCredits}</span>
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate('/skills')}>
            Skills
          </Button>
          <Button variant="outline" onClick={() => navigate('/runs')}>
            History
          </Button>
          <SortControls<RecipeSortField>
            field={sortField}
            direction={sortDirection}
            onFieldChange={(field) => setSortField(field)}
            onDirectionToggle={() => setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
            options={[
              { value: 'name', label: 'Name' },
              { value: 'type', label: 'Type' },
            ]}
            placeholder="Sort recipes"
            triggerWidthClassName="sm:w-auto"
          />
          <div className="relative">
            <Button
              variant={filtersOpen || hasAnyActiveFilters ? 'default' : 'outline'}
              size="icon"
              aria-label={filtersOpen || hasAnyActiveFilters ? 'Hide filters' : 'Show filters'}
              aria-pressed={filtersOpen || hasAnyActiveFilters}
              onClick={() => setFiltersOpen((prev) => !prev)}
              className="relative h-10 w-10"
            >
              <Filter className="h-4 w-4" />
              {hasAnyActiveFilters ? (
                <span
                  className={`absolute -top-1 -right-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium ${
                    filtersOpen
                      ? 'bg-background text-foreground ring-ring ring-1'
                      : 'bg-foreground text-background'
                  }`}
                >
                  {activeFilterCount}
                </span>
              ) : null}
            </Button>

            {filtersOpen ? (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setFiltersOpen(false)}
                  aria-hidden="true"
                />

                <div className="bg-card absolute top-12 right-0 z-50 w-[min(38rem,calc(100vw-2rem))] rounded-lg border p-4 shadow-lg">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <h3 className="text-base font-semibold">Recipe Filters</h3>
                      <p className="text-muted-foreground text-sm">
                        Filter by search, category, required skills, and readiness.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={clearFilters}
                        disabled={!hasAnyActiveFilters}
                      >
                        Clear all
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setFiltersOpen(false)}
                        className="h-8 w-8"
                        aria-label="Close filters"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {hasAnyActiveFilters ? (
                    <div className="bg-background mb-4 rounded-lg border p-3">
                      <div className="mb-2 text-sm font-semibold">Applied filters</div>
                      <div className="flex flex-wrap gap-2">
                        {search.trim() ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 rounded-full px-3"
                            onClick={() => setSearch('')}
                          >
                            Search: {search.trim()}
                            <X className="ml-1 h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                        {categoryFilters.map((category) => (
                          <Button
                            key={`chip-category-${category}`}
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 rounded-full px-3"
                            onClick={() => toggleCategoryFilter(category)}
                          >
                            {categoryLabel(category)}
                            <X className="ml-1 h-3.5 w-3.5" />
                          </Button>
                        ))}
                        {requiredSkillFilters.map((skillId) => (
                          <Button
                            key={`chip-skill-${skillId}`}
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 rounded-full px-3"
                            onClick={() => toggleRequiredSkillFilter(skillId)}
                          >
                            {requiredSkillFilterLabelById.get(skillId) || toHumanLabel(skillId)}
                            <X className="ml-1 h-3.5 w-3.5" />
                          </Button>
                        ))}
                        {readinessFilters.map((value) => (
                          <Button
                            key={`chip-readiness-${value}`}
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 rounded-full px-3"
                            onClick={() => toggleReadinessFilter(value)}
                          >
                            {readinessLabel(value)}
                            <X className="ml-1 h-3.5 w-3.5" />
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-4 lg:grid-cols-3">
                    <div className="bg-background rounded-lg border p-4 lg:col-span-3">
                      <div className="relative">
                        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                        <Input
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Search recipes"
                          className="h-9 pr-10 pl-9"
                        />
                        {search.trim() ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSearch('')}
                            className="absolute top-1/2 right-2 h-7 w-7 -translate-y-1/2 p-0 hover:bg-transparent"
                            aria-label="Clear search"
                          >
                            <X className="text-muted-foreground h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    <div className="bg-background rounded-lg border p-4">
                      <div className="mb-3 text-sm font-semibold">
                        Category
                        {categoryFilters.length > 0 ? (
                          <span className="text-muted-foreground ml-1 text-xs font-normal">
                            ({categoryFilters.length})
                          </span>
                        ) : null}
                      </div>
                      <div className="space-y-1">
                        {categoryFilterOptions.map((category) => {
                          const checked = categoryFilters.includes(category);
                          const id = `recipe-filter-category-${category}`;
                          return (
                            <label
                              key={category}
                              htmlFor={id}
                              className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1"
                            >
                              <Checkbox
                                id={id}
                                checked={checked}
                                onCheckedChange={() => toggleCategoryFilter(category)}
                                className="h-3.5 w-3.5"
                              />
                              <span className="text-sm">{categoryLabel(category)}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <div className="bg-background rounded-lg border p-4">
                      <div className="mb-3 text-sm font-semibold">
                        Required skills
                        {requiredSkillFilters.length > 0 ? (
                          <span className="text-muted-foreground ml-1 text-xs font-normal">
                            ({requiredSkillFilters.length})
                          </span>
                        ) : null}
                      </div>
                      <div className="max-h-[16rem] space-y-1 overflow-auto pr-1">
                        {requiredSkillFilterOptions.length === 0 ? (
                          <div className="text-muted-foreground text-sm">
                            No required skills in results.
                          </div>
                        ) : (
                          requiredSkillFilterOptions.map((skill) => {
                            const checked = requiredSkillFilters.includes(skill.id);
                            const id = `recipe-filter-skill-${skill.id}`;
                            return (
                              <label
                                key={skill.id}
                                htmlFor={id}
                                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1"
                              >
                                <Checkbox
                                  id={id}
                                  checked={checked}
                                  onCheckedChange={() => toggleRequiredSkillFilter(skill.id)}
                                  className="h-3.5 w-3.5"
                                />
                                <span className="text-sm">{skill.displayLabel}</span>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>

                    <div className="bg-background rounded-lg border p-4">
                      <div className="mb-3 text-sm font-semibold">
                        Readiness
                        {readinessFilters.length > 0 ? (
                          <span className="text-muted-foreground ml-1 text-xs font-normal">
                            ({readinessFilters.length})
                          </span>
                        ) : null}
                      </div>
                      <div className="space-y-1">
                        {[
                          { value: 'ready' as const, label: 'Ready to run' },
                          { value: 'missing_skills' as const, label: 'Missing required skills' },
                          { value: 'disabled_skills' as const, label: 'Required skills disabled' },
                        ].map((option) => {
                          const checked = readinessFilters.includes(option.value);
                          const id = `recipe-filter-readiness-${option.value}`;
                          return (
                            <label
                              key={option.value}
                              htmlFor={id}
                              className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1"
                            >
                              <Checkbox
                                id={id}
                                checked={checked}
                                disabled={!canFilterByReadiness}
                                onCheckedChange={() => toggleReadinessFilter(option.value)}
                                className="h-3.5 w-3.5"
                              />
                              <span className="text-sm">{option.label}</span>
                            </label>
                          );
                        })}
                      </div>
                      {!canFilterByReadiness ? (
                        <p className="text-muted-foreground mt-2 text-xs">Loading skill status…</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {recipes.length > 0 ? (
        <div className="text-muted-foreground text-xs">
          Showing {sortedRecipes.length} of {recipes.length} recipes
        </div>
      ) : null}

      {recipes.length === 0 ? (
        <div className="py-10">
          <AppEmptyState
            variant="minimal"
            title="No recipes yet"
            description="No recipes are currently available for this brand."
          />
        </div>
      ) : null}

      {recipes.length > 0 && sortedRecipes.length === 0 ? (
        <div className="py-10">
          <AppEmptyState
            variant="minimal"
            title="No recipes match current filters"
            description="Adjust filters or reset them to see more recipes."
            actions={[{ label: 'Reset filters', onClick: clearFilters }]}
          />
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sortedRecipes.map((recipe) => (
          <Card
            key={recipe.id}
            role="button"
            tabIndex={recipe.publishedVersion?.id ? 0 : -1}
            aria-disabled={!recipe.publishedVersion?.id}
            onClick={() => {
              if (!recipe.publishedVersion?.id) return;
              openRunDialog(recipe);
            }}
            onKeyDown={(e) => {
              if (!recipe.publishedVersion?.id) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openRunDialog(recipe);
              }
            }}
            className={[
              'bg-card border-border',
              'hover:border-foreground/20 transition-colors',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
              recipe.publishedVersion?.id ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
            ].join(' ')}
          >
            <CardHeader className="space-y-1">
              <div className="flex items-start gap-3">
                <CardTitle className="text-foreground flex items-start gap-1.5 text-base">
                  <span
                    title={categoryName(recipe.category)}
                    aria-label={categoryName(recipe.category)}
                    className="bg-muted/40 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-base leading-none"
                  >
                    {categoryEmoji(recipe.category)}
                  </span>
                  <span>{normalizeRecipeName(recipe.name)}</span>
                </CardTitle>
              </div>
              <CardDescription className="text-muted-foreground">
                {recipe.description || '—'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.isArray(recipe.skillsRequired) && recipe.skillsRequired.length > 0 ? (
                <div className="flex flex-wrap justify-end gap-2">
                  {recipe.skillsRequired.map((skillId) => {
                    const skill = skillById.get(skillId) || null;
                    const label = skill?.name || toHumanLabel(skillId);
                    const enabled = skill?.installation?.enabled === true;
                    const missing = !skill?.installation;
                    const disabled = Boolean(skill?.installation) && !enabled;
                    const suffix = missing ? ' (missing)' : disabled ? ' (disabled)' : '';
                    return (
                      <Button
                        key={skillId}
                        type="button"
                        variant="outline"
                        size="sm"
                        className={[
                          'h-7 rounded-full px-3',
                          missing || disabled ? 'text-destructive border-destructive/40' : '',
                        ].join(' ')}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/skills?skill=${encodeURIComponent(skillId)}`);
                        }}
                      >
                        <SkillIcon source={skill || { id: skillId }} className="mr-1 h-3.5 w-3.5" />
                        {label}
                        {suffix}
                      </Button>
                    );
                  })}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog
        open={runOpen}
        onOpenChange={(open) => {
          setRunOpen(open);
          if (!open) {
            setRunRecipe(null);
            setRunInput({});
            setAssetPickerFieldKey(null);
          }
        }}
      >
        <DialogContent
          className="max-w-2xl"
          onInteractOutside={(event) => {
            if (assetPickerFieldKey) {
              event.preventDefault();
            }
          }}
          onEscapeKeyDown={(event) => {
            if (assetPickerFieldKey) {
              event.preventDefault();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Generate content</DialogTitle>
            <DialogDescription>
              {runRecipe ? normalizeRecipeName(runRecipe.name) : '—'}
            </DialogDescription>
          </DialogHeader>

          {runRecipe ? (
            <div className="space-y-4">
              {multiDestinationEnabled ? (
                <div className="space-y-1">
                  <Label>Destination</Label>
                  {connectedAccountsQuery.isLoading ? (
                    <Skeleton className="h-10 w-full" />
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <SocialAccountsPicker
                        options={destinationPickerOptions}
                        value={runDestinationIds}
                        onChange={(next) => {
                          const nextUnique = Array.from(new Set(next)).filter((id) =>
                            destinationPickerOptions.some((o) => o.id === id)
                          );
                          if (nextUnique.length <= 1) {
                            setRunDestinationIds(nextUnique);
                            return;
                          }
                          setRunDestinationIds((prev) => {
                            const prevSet = new Set(prev);
                            const added = nextUnique.find((id) => !prevSet.has(id)) || null;
                            return added ? [added] : [nextUnique[0]];
                          });
                        }}
                        disabled={createRunMutation.isPending}
                        size="md"
                        required
                        selectedLayout="wrap"
                        addButtonText="Choose destination"
                        addButtonTextMode="always"
                        addTooltip="Pick a social account"
                        searchPlaceholder="Search destinations…"
                      />
                    </div>
                  )}
                  <p className="text-muted-foreground text-xs">
                    Defaults to your brand’s primary/default posting account when available.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <Label>Destination</Label>
                  {connectedAccountsQuery.isLoading ? (
                    <Skeleton className="h-5 w-full" />
                  ) : selectedRunDestination ? (
                    <p className="text-muted-foreground text-sm">
                      Using {selectedRunDestination.label} for this run.
                    </p>
                  ) : (
                    <p className="text-destructive text-sm">
                      No eligible destination account is connected for this brand.
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-4">
                {runRequiredInputFields.map((field) => {
                  const value = runInput[field.key];
                  const asString = typeof value === 'string' ? value : '';
                  const selectedAssetIds = Array.isArray(value)
                    ? value
                        .map((item) => String(item || '').trim())
                        .filter((item) => item.length > 0)
                    : [];

                  return (
                    <div key={field.key} className="space-y-1">
                      <Label>
                        {field.label || toHumanLabel(field.key)}{' '}
                        <span className="text-destructive">*</span>
                      </Label>

                      {field.type === 'textarea' ? (
                        <Textarea
                          value={asString}
                          placeholder={field.placeholder || undefined}
                          onChange={(e) =>
                            setRunInput((s) => ({ ...s, [field.key]: e.target.value }))
                          }
                        />
                      ) : null}

                      {field.type === 'input' || field.type === 'date' ? (
                        <Input
                          type={field.type === 'date' ? 'date' : 'text'}
                          value={asString}
                          placeholder={field.placeholder || undefined}
                          onChange={(e) =>
                            setRunInput((s) => ({ ...s, [field.key]: e.target.value }))
                          }
                        />
                      ) : null}

                      {field.type === 'select' ? (
                        <Select
                          value={asString}
                          onValueChange={(next) =>
                            setRunInput((s) => ({ ...s, [field.key]: next }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={field.placeholder || 'Choose value'} />
                          </SelectTrigger>
                          <SelectContent>
                            {(field.options || []).map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}

                      {field.type === 'asset_picker' ||
                      field.type === 'asset_reference_selector' ? (
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setAssetPickerFieldKey(field.key)}
                              disabled={createRunMutation.isPending}
                            >
                              {selectedAssetIds.length > 0
                                ? `Selected ${selectedAssetIds.length} asset${selectedAssetIds.length === 1 ? '' : 's'}`
                                : 'Choose assets'}
                            </Button>
                            {selectedAssetIds.length > 0 ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setRunInput((s) => ({ ...s, [field.key]: [] }))}
                                disabled={createRunMutation.isPending}
                              >
                                Clear
                              </Button>
                            ) : null}
                          </div>
                          {selectedAssetIds.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {selectedAssetIds.map((assetId) => (
                                <Badge
                                  key={assetId}
                                  variant="outline"
                                  className="font-mono text-xs"
                                >
                                  {assetId}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {field.description ? (
                        <p className="text-muted-foreground text-xs">{field.description}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {runOptionalInputFields.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-muted-foreground text-sm">Optional</div>
                  <div className="space-y-3">
                    {runOptionalInputFields.map((field) => {
                      const value = runInput[field.key];
                      const asString = typeof value === 'string' ? value : '';
                      const selectedAssetIds = Array.isArray(value)
                        ? value
                            .map((item) => String(item || '').trim())
                            .filter((item) => item.length > 0)
                        : [];

                      return (
                        <div key={field.key} className="space-y-1">
                          <Label>{field.label || toHumanLabel(field.key)}</Label>

                          {field.type === 'textarea' ? (
                            <Textarea
                              value={asString}
                              placeholder={field.placeholder || undefined}
                              onChange={(e) =>
                                setRunInput((s) => ({ ...s, [field.key]: e.target.value }))
                              }
                            />
                          ) : null}

                          {field.type === 'input' || field.type === 'date' ? (
                            <Input
                              type={field.type === 'date' ? 'date' : 'text'}
                              value={asString}
                              placeholder={field.placeholder || undefined}
                              onChange={(e) =>
                                setRunInput((s) => ({ ...s, [field.key]: e.target.value }))
                              }
                            />
                          ) : null}

                          {field.type === 'select' ? (
                            <Select
                              value={asString}
                              onValueChange={(next) =>
                                setRunInput((s) => ({ ...s, [field.key]: next }))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder={field.placeholder || 'Choose value'} />
                              </SelectTrigger>
                              <SelectContent>
                                {(field.options || []).map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : null}

                          {field.type === 'asset_picker' ||
                          field.type === 'asset_reference_selector' ? (
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setAssetPickerFieldKey(field.key)}
                                  disabled={createRunMutation.isPending}
                                >
                                  {selectedAssetIds.length > 0
                                    ? `Selected ${selectedAssetIds.length} asset${selectedAssetIds.length === 1 ? '' : 's'}`
                                    : 'Choose assets'}
                                </Button>
                                {selectedAssetIds.length > 0 ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setRunInput((s) => ({ ...s, [field.key]: [] }))}
                                    disabled={createRunMutation.isPending}
                                  >
                                    Clear
                                  </Button>
                                ) : null}
                              </div>
                              {selectedAssetIds.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {selectedAssetIds.map((assetId) => (
                                    <Badge
                                      key={assetId}
                                      variant="outline"
                                      className="font-mono text-xs"
                                    >
                                      {assetId}
                                    </Badge>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {field.description ? (
                            <p className="text-muted-foreground text-xs">{field.description}</p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="bg-muted/30 border-border space-y-2 rounded-md border p-3">
                {runEstimateQuery.isLoading ? (
                  <>
                    <Skeleton className="h-4 w-44" />
                    <Skeleton className="h-4 w-56" />
                  </>
                ) : (
                  <>
                    <div className="text-sm font-medium">
                      AI credits balance:{' '}
                      <span className="font-mono">
                        {runEstimate?.balanceCredits ?? creditsQuery.data?.balanceCredits ?? 0}
                      </span>
                    </div>
                    <div className="text-muted-foreground text-sm">
                      Estimated managed run cost:{' '}
                      <span className="font-mono">
                        {runEstimate?.estimate.estimatedCredits ?? 0} credits
                      </span>{' '}
                      ({runEstimate?.estimate.estimatedUsd ?? '0.0000'} USD)
                    </div>
                    {blocksRunForCredits ? (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-destructive text-sm">
                          Insufficient credits. Short by {runShortfall} credits.
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => topUpMutation.mutate()}
                          disabled={topUpMutation.isPending}
                        >
                          Top up +1000
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setRunOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!runRecipe) return;
                if (runDestinationIds.length === 0) {
                  toast.error(
                    multiDestinationEnabled
                      ? 'Choose a destination'
                      : 'No destination account is available for this brand.'
                  );
                  return;
                }
                for (const field of runRequiredInputFields) {
                  if (isMissingFieldValue(runInput[field.key])) {
                    toast.error(
                      `Missing required input: ${field.label || toHumanLabel(field.key)}`
                    );
                    return;
                  }
                }
                createRunMutation.mutate({ recipe: runRecipe, input: runInput });
              }}
              disabled={
                !runRecipe ||
                createRunMutation.isPending ||
                topUpMutation.isPending ||
                blocksRunForCredits ||
                runDestinationIds.length === 0
              }
            >
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {assetPickerFieldKey && brandId && activeAssetPickerField ? (
        <AssetPicker
          brandId={brandId}
          onSelectMany={(assets) => {
            const allIds = assets.map((asset) => asset.id).filter(Boolean);
            const allowMany = activeAssetPickerField.multiple !== false;
            const capped = allowMany ? allIds : allIds.slice(0, 1);
            const max =
              typeof activeAssetPickerField.max === 'number' && activeAssetPickerField.max > 0
                ? activeAssetPickerField.max
                : undefined;
            const next = max ? capped.slice(0, max) : capped;
            setRunInput((s) => ({ ...s, [assetPickerFieldKey]: next }));
            setAssetPickerFieldKey(null);
          }}
          onClose={() => setAssetPickerFieldKey(null)}
        />
      ) : null}
    </div>
  );
}
