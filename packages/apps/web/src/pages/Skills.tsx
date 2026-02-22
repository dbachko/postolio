import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';

import { useBrandStore } from '@/stores/brandStore';
import { AppEmptyState } from '@/components/app-empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { skills as skillsApi } from '@/lib/api';
import type { SkillMode, SkillSummary } from '@/lib/api/skills-client';
import { SkillIcon, getSkillProviderLabel } from '@/components/icons/skill-icons';

type SchemaProperty = {
  type?: string;
  title?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  placeholder?: string;
  secret?: boolean;
};

type ObjectSchema = {
  properties: Record<string, SchemaProperty>;
  required: Set<string>;
  additionalProperties: boolean;
};

type SkillExample = {
  title: string;
  input?: unknown;
  description?: string;
};

type ProviderSkillMeta = {
  label?: string;
  docs?: string;
  docsUrl?: string;
  examples: SkillExample[];
  secretSchema?: unknown;
  configSchema?: unknown;
  tryEnabled?: boolean;
  trySampleInput?: unknown;
};

type SkillMeta = {
  provider?: string;
  providers: string[];
  providerDetails: Record<string, ProviderSkillMeta>;
  tags: string[];
  docs?: string;
  docsUrl?: string;
  examples: SkillExample[];
  secretSchema?: unknown;
  tryEnabled: boolean;
  trySampleInput?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeProviderId(value: unknown): string | null {
  if (!isNonEmptyString(value)) {
    return null;
  }
  return value.trim().toLowerCase();
}

function humanizeKey(raw: string): string {
  const s = String(raw || '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!s) {
    return '';
  }
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function toStringValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractExamplePrompt(value: unknown): string | null {
  if (typeof value === 'string') {
    const prompt = value.trim();
    return prompt.length > 0 ? prompt : null;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const promptKeys = ['prompt', 'instruction', 'task', 'query', 'url'];
  for (const key of promptKeys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  const serialized = safeStringify(value);
  return serialized.trim().length > 0 ? serialized : null;
}

function parseObjectSchema(schemaRaw: unknown): ObjectSchema {
  const schema = asRecord(schemaRaw);
  const propertiesRaw = asRecord(schema.properties);
  const requiredRaw = Array.isArray(schema.required) ? schema.required : [];
  const required = new Set(
    requiredRaw.filter((key): key is string => typeof key === 'string' && key.trim().length > 0)
  );
  const properties: Record<string, SchemaProperty> = {};
  for (const [key, value] of Object.entries(propertiesRaw)) {
    const prop = asRecord(value);
    properties[key] = {
      type: typeof prop.type === 'string' ? prop.type : undefined,
      title: typeof prop.title === 'string' ? prop.title : undefined,
      description: typeof prop.description === 'string' ? prop.description : undefined,
      enum: Array.isArray(prop.enum) ? prop.enum : undefined,
      default: prop.default,
      placeholder: typeof prop.placeholder === 'string' ? prop.placeholder : undefined,
      secret: prop.secret === true,
    };
  }
  return {
    properties,
    required,
    additionalProperties: schema.additionalProperties !== false,
  };
}

function parseSkillMeta(scopesJson: unknown): SkillMeta {
  const meta = asRecord(scopesJson);
  const provider = normalizeProviderId(meta.provider) ?? undefined;
  const providersRaw = Array.isArray(meta.providers) ? meta.providers : [];
  const providersFromList = providersRaw
    .map((item) => normalizeProviderId(item))
    .filter((item): item is string => Boolean(item));
  const providers = Array.from(new Set([...providersFromList, ...(provider ? [provider] : [])]));

  const parseExamples = (examplesRaw: unknown): SkillExample[] =>
    Array.isArray(examplesRaw)
      ? examplesRaw
          .map((item) => asRecord(item))
          .filter((item) => isNonEmptyString(item.title))
          .map((item) => ({
            title: String(item.title),
            input: item.input,
            description: isNonEmptyString(item.description) ? String(item.description) : undefined,
          }))
      : [];

  const providerDetailsRaw = asRecord(meta.providerDetails);
  const providerDetails: Record<string, ProviderSkillMeta> = {};
  for (const [providerKey, detailRaw] of Object.entries(providerDetailsRaw)) {
    const providerId = normalizeProviderId(providerKey);
    if (!providerId) {
      continue;
    }
    const detail = asRecord(detailRaw);
    const detailTry = asRecord(detail.try);
    providerDetails[providerId] = {
      label: isNonEmptyString(detail.label) ? String(detail.label) : undefined,
      docs: isNonEmptyString(detail.docs) ? String(detail.docs) : undefined,
      docsUrl: isNonEmptyString(detail.docsUrl) ? String(detail.docsUrl) : undefined,
      examples: parseExamples(detail.examples),
      secretSchema: detail.secretSchema,
      configSchema: detail.configSchema,
      tryEnabled: typeof detailTry.enabled === 'boolean' ? detailTry.enabled : undefined,
      trySampleInput: detailTry.sampleInput,
    };
  }

  const tags = Array.isArray(meta.tags)
    ? meta.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    : [];
  const examples = parseExamples(meta.examples);
  const tryRaw = asRecord(meta.try);
  return {
    provider,
    providers,
    providerDetails,
    tags,
    docs: isNonEmptyString(meta.docs) ? String(meta.docs) : undefined,
    docsUrl: isNonEmptyString(meta.docsUrl) ? String(meta.docsUrl) : undefined,
    examples,
    secretSchema: meta.secretSchema,
    tryEnabled: tryRaw.enabled !== false,
    trySampleInput: tryRaw.sampleInput,
  };
}

function normalizeInputValueForSchema(value: unknown, schema: SchemaProperty): unknown {
  const type = schema.type;
  if (type === 'number') {
    const raw = toStringValue(value).trim();
    if (!raw) {
      return undefined;
    }
    const num = Number(raw);
    return Number.isFinite(num) ? num : undefined;
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') {
      return value;
    }
    const raw = String(value || '')
      .trim()
      .toLowerCase();
    if (raw === 'true') {
      return true;
    }
    if (raw === 'false') {
      return false;
    }
    return undefined;
  }
  const raw = toStringValue(value);
  return raw.trim().length > 0 ? raw.trim() : undefined;
}

function getInitialValuesForSchema(
  schema: ObjectSchema,
  sourceRaw: unknown
): Record<string, unknown> {
  const source = asRecord(sourceRaw);
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      out[key] = source[key];
      continue;
    }
    if (prop.default !== undefined) {
      out[key] = prop.default;
    }
  }
  return out;
}

function validateRequiredFields(schema: ObjectSchema, values: Record<string, unknown>): string[] {
  const missing: string[] = [];
  for (const key of schema.required) {
    const prop = schema.properties[key] || {};
    const normalized = normalizeInputValueForSchema(values[key], prop);
    if (normalized === undefined) {
      missing.push(prop.title || humanizeKey(key) || key);
    }
  }
  return missing;
}

function buildConfigPayload(
  schema: ObjectSchema,
  values: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, prop] of Object.entries(schema.properties)) {
    const normalized = normalizeInputValueForSchema(values[key], prop);
    if (normalized !== undefined) {
      out[key] = normalized;
    }
  }

  if (schema.additionalProperties) {
    for (const [key, value] of Object.entries(values)) {
      if (Object.prototype.hasOwnProperty.call(schema.properties, key)) {
        continue;
      }
      out[key] = value;
    }
  }

  return out;
}

function SkillCardSkeleton({ showToggle = false }: { showToggle?: boolean }) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded-sm" />
            <Skeleton className="h-5 w-28" />
          </div>
          <div className="flex items-center gap-1">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        </div>
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-8/12" />
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {showToggle ? <Skeleton className="h-6 w-11 rounded-full" /> : null}
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-9 w-20 rounded-md" />
      </CardContent>
    </Card>
  );
}

export function Skills() {
  const { selectedBrand } = useBrandStore();
  const brandId = selectedBrand?.id ?? null;
  const userBrandName = selectedBrand?.name ?? null;

  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSkillId = searchParams.get('skill');
  const didAutoOpenRef = useRef(false);

  const [configOpen, setConfigOpen] = useState(false);
  const [activeSkill, setActiveSkill] = useState<SkillSummary | null>(null);
  const [mode, setMode] = useState<SkillMode>('managed');
  const [configValues, setConfigValues] = useState<Record<string, unknown>>({});
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [loadingSkillDetail, setLoadingSkillDetail] = useState(false);
  const [search, setSearch] = useState('');

  const skillsQuery = useQuery({
    queryKey: ['skills', brandId],
    enabled: Boolean(brandId),
    queryFn: async () => {
      const res = await skillsApi.listSkills(brandId!);
      return res.skills;
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (params: { installationId: string; enabled: boolean }) =>
      await skillsApi.toggle(params.installationId, params.enabled),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['skills', brandId] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update skill');
    },
  });

  const installMutation = useMutation({
    mutationFn: async (params: {
      skillId: string;
      mode: SkillMode;
      config: Record<string, unknown>;
      apiKey?: string;
    }) => {
      if (!brandId) {
        throw new Error('Brand required');
      }
      return await skillsApi.install(params.skillId, {
        brandId,
        mode: params.mode,
        config: params.config,
        secret: params.mode === 'byok' ? { apiKey: params.apiKey || '' } : undefined,
      });
    },
    onSuccess: async () => {
      toast.success('Skill saved');
      setConfigOpen(false);
      setActiveSkill(null);
      setSecretValues({});
      await queryClient.invalidateQueries({ queryKey: ['skills', brandId] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save skill');
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: async (skill: SkillSummary) => {
      if (!brandId) {
        throw new Error('Brand required');
      }
      if (skill.installation?.id) {
        return await skillsApi.uninstallInstallation(skill.installation.id);
      }
      return await skillsApi.uninstall(skill.id, brandId);
    },
    onSuccess: async () => {
      toast.success('Skill uninstalled');
      setConfigOpen(false);
      setActiveSkill(null);
      setSecretValues({});
      await queryClient.invalidateQueries({ queryKey: ['skills', brandId] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to uninstall skill');
    },
  });

  const skills = skillsQuery.data ?? [];
  const isInitialLoading = skillsQuery.isLoading && !skillsQuery.data;
  const normalizedSearch = search.trim().toLowerCase();
  const filteredSkills = useMemo(() => {
    if (!normalizedSearch) {
      return skills;
    }
    return skills.filter((skill) => {
      const haystack = `${skill.name} ${skill.id} ${skill.description}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [normalizedSearch, skills]);
  const installedSkills = filteredSkills.filter((skill) => Boolean(skill.installation));
  const availableSkills = filteredSkills.filter((skill) => !skill.installation);

  const activeMeta = useMemo(
    () => parseSkillMeta(activeSkill?.scopesJson),
    [activeSkill?.scopesJson]
  );
  const selectedProvider = useMemo(() => {
    const selectedFromConfig = normalizeProviderId(configValues.provider);
    if (selectedFromConfig && activeMeta.providers.includes(selectedFromConfig)) {
      return selectedFromConfig;
    }
    if (activeMeta.provider) {
      return activeMeta.provider;
    }
    return activeMeta.providers[0] ?? null;
  }, [activeMeta.provider, activeMeta.providers, configValues.provider]);
  const selectedProviderMeta = useMemo(
    () => (selectedProvider ? activeMeta.providerDetails[selectedProvider] : undefined),
    [activeMeta.providerDetails, selectedProvider]
  );
  const activeConfigSchema = useMemo(
    () => parseObjectSchema(selectedProviderMeta?.configSchema ?? activeSkill?.configSchemaJson),
    [selectedProviderMeta?.configSchema, activeSkill?.configSchemaJson]
  );
  const activeSecretSchema = useMemo(
    () => parseObjectSchema(selectedProviderMeta?.secretSchema ?? activeMeta.secretSchema),
    [selectedProviderMeta?.secretSchema, activeMeta.secretSchema]
  );
  const activeDocs = selectedProviderMeta?.docs ?? activeMeta.docs;
  const activeDocsUrl = selectedProviderMeta?.docsUrl ?? activeMeta.docsUrl;
  const activeExamples =
    selectedProviderMeta?.examples && selectedProviderMeta.examples.length > 0
      ? selectedProviderMeta.examples
      : activeMeta.examples;
  const activeTrySampleInput =
    selectedProviderMeta?.trySampleInput !== undefined
      ? selectedProviderMeta.trySampleInput
      : activeMeta.trySampleInput;
  const examplePrompt = useMemo(() => {
    const fromTrySample = extractExamplePrompt(activeTrySampleInput);
    if (fromTrySample) {
      return fromTrySample;
    }
    const fromExamples = activeExamples
      .map((example) => extractExamplePrompt(example.input))
      .find((item): item is string => Boolean(item));
    return fromExamples || null;
  }, [activeExamples, activeTrySampleInput]);
  const copyExamplePrompt = useCallback(async () => {
    if (!examplePrompt) {
      return;
    }
    try {
      await navigator.clipboard.writeText(examplePrompt);
      toast.success('Example prompt copied');
    } catch {
      toast.error('Failed to copy example prompt');
    }
  }, [examplePrompt]);

  const supportedModes = useMemo(() => {
    const modeSupported = activeSkill?.modeSupported || 'managed';
    if (modeSupported === 'both') {
      return ['managed', 'byok'] as const;
    }
    return [modeSupported] as const;
  }, [activeSkill?.modeSupported]);

  const textGenerationSkill = skillsQuery.data?.find((s) => s.id === 'text_generation') ?? null;

  const initializeSkillForm = useCallback((skill: SkillSummary) => {
    const fallbackMode: SkillMode = skill.modeSupported === 'byok' ? 'byok' : 'managed';
    const currentMode = skill.installation?.mode ?? fallbackMode;
    setMode(currentMode);
    const cfgSchema = parseObjectSchema(skill.configSchemaJson);
    setConfigValues(getInitialValuesForSchema(cfgSchema, skill.installation?.configJson));
    setSecretValues({});
  }, []);

  const openConfigure = useCallback(
    async (skill: SkillSummary) => {
      setActiveSkill(skill);
      initializeSkillForm(skill);
      setConfigOpen(true);
      if (!brandId) {
        return;
      }
      try {
        setLoadingSkillDetail(true);
        const res = await skillsApi.getSkill(skill.id, brandId);
        const detailed = res.skill;
        setActiveSkill(detailed);
        initializeSkillForm(detailed);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load skill details');
      } finally {
        setLoadingSkillDetail(false);
      }
    },
    [brandId, initializeSkillForm]
  );

  useEffect(() => {
    if (!requestedSkillId) {
      return;
    }
    if (didAutoOpenRef.current) {
      return;
    }
    if (!skillsQuery.data) {
      return;
    }

    const skill = skillsQuery.data.find((s) => s.id === requestedSkillId) ?? null;
    didAutoOpenRef.current = true;

    if (!skill) {
      toast.error(`Skill not found: ${requestedSkillId}`);
      return;
    }

    openConfigure(skill);

    const next = new URLSearchParams(searchParams);
    next.delete('skill');
    setSearchParams(next, { replace: true });
  }, [requestedSkillId, skillsQuery.data, openConfigure, searchParams, setSearchParams]);

  useEffect(() => {
    if (!activeSkill) {
      return;
    }
    if (supportedModes.includes(mode)) {
      return;
    }
    setMode(supportedModes[0] as SkillMode);
  }, [activeSkill, mode, supportedModes]);

  if (!selectedBrand) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AppEmptyState
          variant="minimal"
          title="Select a brand to manage skills"
          description="Choose which brand you want to configure."
          actions={[{ label: 'Choose Brand', to: '/brands' }]}
        />
      </div>
    );
  }

  const renderSchemaFields = (
    schema: ObjectSchema,
    values: Record<string, unknown>,
    onChange: (key: string, value: unknown) => void,
    opts?: { forceSecret?: boolean }
  ) => {
    const entries = Object.entries(schema.properties);
    if (entries.length === 0) {
      return null;
    }

    return (
      <div className="space-y-3">
        {entries.map(([key, prop]) => {
          const label = prop.title || humanizeKey(key) || key;
          const required = schema.required.has(key);
          const type = prop.type || 'string';
          const enumValues = Array.isArray(prop.enum)
            ? prop.enum.filter((v): v is string => typeof v === 'string')
            : [];
          const isSecret = opts?.forceSecret || prop.secret === true;
          const value = values[key];

          if (enumValues.length > 0) {
            const current = isNonEmptyString(value)
              ? value
              : toStringValue(prop.default) || undefined;
            return (
              <div key={key} className="space-y-1">
                <Label>
                  {label}
                  {required ? <span className="text-destructive"> *</span> : null}
                </Label>
                <Select value={current} onValueChange={(next) => onChange(key, next)}>
                  <SelectTrigger>
                    <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {enumValues.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {prop.description ? (
                  <p className="text-muted-foreground text-xs">{prop.description}</p>
                ) : null}
              </div>
            );
          }

          if (type === 'boolean') {
            const checked =
              typeof value === 'boolean'
                ? value
                : typeof prop.default === 'boolean'
                  ? prop.default
                  : false;
            return (
              <div
                key={key}
                className="border-border flex items-center justify-between rounded-md border p-3"
              >
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">
                    {label}
                    {required ? <span className="text-destructive"> *</span> : null}
                  </Label>
                  {prop.description ? (
                    <p className="text-muted-foreground text-xs">{prop.description}</p>
                  ) : null}
                </div>
                <Switch checked={checked} onCheckedChange={(next) => onChange(key, next)} />
              </div>
            );
          }

          return (
            <div key={key} className="space-y-1">
              <Label>
                {label}
                {required ? <span className="text-destructive"> *</span> : null}
              </Label>
              <Input
                type={isSecret ? 'password' : type === 'number' ? 'number' : 'text'}
                value={toStringValue(value)}
                onChange={(e) => onChange(key, e.target.value)}
                placeholder={prop.placeholder}
                autoComplete={isSecret ? 'off' : undefined}
              />
              {prop.description ? (
                <p className="text-muted-foreground text-xs">{prop.description}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-semibold">Skills</h1>
          <p className="text-muted-foreground text-sm">
            Configure capabilities for {userBrandName}.
          </p>
        </div>
        <Button variant="outline" disabled>
          New skill
        </Button>
      </div>

      <div className="space-y-1">
        <Label htmlFor="skills-search">Search</Label>
        <Input
          id="skills-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            isInitialLoading ? 'Loading skills…' : 'Search installed and available skills'
          }
          disabled={isInitialLoading}
        />
      </div>

      <section className="space-y-3">
        <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">Installed</h2>
        {isInitialLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <SkillCardSkeleton key={`installed-loading-${index}`} showToggle />
            ))}
          </div>
        ) : installedSkills.length === 0 ? (
          <p className="text-muted-foreground text-sm">No installed skills match your search.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {installedSkills.map((skill) => {
              const providerLabel = getSkillProviderLabel(skill);
              return (
                <Card
                  key={skill.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openConfigure(skill)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openConfigure(skill);
                    }
                  }}
                  className={[
                    'bg-card border-border',
                    'hover:border-foreground/20 transition-colors',
                    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                    'cursor-pointer',
                  ].join(' ')}
                >
                  <CardHeader className="space-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-foreground flex items-center gap-2 text-base">
                        <SkillIcon source={skill} className="text-muted-foreground h-4 w-4" />
                        {skill.name}
                      </CardTitle>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {providerLabel ? (
                          <Badge variant="secondary" className="gap-1">
                            <SkillIcon source={skill} className="h-3.5 w-3.5" />
                            {providerLabel}
                          </Badge>
                        ) : null}
                        <Badge variant="outline">{skill.modeSupported}</Badge>
                      </div>
                    </div>
                    <CardDescription className="text-muted-foreground">
                      {skill.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between gap-3">
                    <div
                      className="flex items-center gap-3"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <Switch
                        checked={skill.installation?.enabled === true}
                        onCheckedChange={(checked) =>
                          toggleMutation.mutate({
                            installationId: skill.installation!.id,
                            enabled: checked,
                          })
                        }
                        disabled={toggleMutation.isPending}
                      />
                      <div className="text-muted-foreground text-xs">
                        {skill.installation?.mode === 'byok'
                          ? skill.installation.hasSecret
                            ? 'BYOK configured'
                            : 'BYOK missing key'
                          : 'Managed'}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        openConfigure(skill);
                      }}
                    >
                      Settings
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-foreground text-sm font-semibold tracking-wide uppercase">Available</h2>
        {isInitialLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <SkillCardSkeleton key={`available-loading-${index}`} />
            ))}
          </div>
        ) : availableSkills.length === 0 ? (
          <p className="text-muted-foreground text-sm">No available skills match your search.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {availableSkills.map((skill) => {
              const providerLabel = getSkillProviderLabel(skill);
              return (
                <Card
                  key={skill.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openConfigure(skill)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openConfigure(skill);
                    }
                  }}
                  className={[
                    'bg-card border-border',
                    'hover:border-foreground/20 transition-colors',
                    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                    'cursor-pointer',
                  ].join(' ')}
                >
                  <CardHeader className="space-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-foreground flex items-center gap-2 text-base">
                        <SkillIcon source={skill} className="text-muted-foreground h-4 w-4" />
                        {skill.name}
                      </CardTitle>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {providerLabel ? (
                          <Badge variant="secondary" className="gap-1">
                            <SkillIcon source={skill} className="h-3.5 w-3.5" />
                            {providerLabel}
                          </Badge>
                        ) : null}
                        <Badge variant="outline">{skill.modeSupported}</Badge>
                      </div>
                    </div>
                    <CardDescription className="text-muted-foreground">
                      {skill.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between gap-3">
                    <div className="text-muted-foreground text-xs">Not installed</div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        openConfigure(skill);
                      }}
                    >
                      Settings
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <Dialog
        open={configOpen}
        onOpenChange={(open) => {
          setConfigOpen(open);
          if (!open) {
            setActiveSkill(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] w-[min(96vw,48rem)] max-w-[48rem] overflow-hidden p-0">
          <div className="flex max-h-[90vh] flex-col">
            <DialogHeader className="sr-only">
              <DialogTitle>Skill details</DialogTitle>
            </DialogHeader>

            {activeSkill ? (
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pt-6 pb-4">
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="bg-muted/80 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border">
                      <SkillIcon source={activeSkill} className="h-7 w-7" />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <h3 className="text-foreground text-3xl leading-none font-semibold tracking-tight">
                        {activeSkill.name}
                      </h3>
                      <p className="text-muted-foreground text-base">{activeSkill.description}</p>
                    </div>
                  </div>

                  {examplePrompt ? (
                    <div className="border-border overflow-hidden rounded-lg border">
                      <div className="bg-muted/70 text-muted-foreground flex items-center justify-between px-3 py-2 text-xs font-medium">
                        <span>Example prompt</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={copyExamplePrompt}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <pre className="text-foreground max-h-36 overflow-auto px-3 py-3 text-sm whitespace-pre-wrap">
                        {examplePrompt}
                      </pre>
                    </div>
                  ) : null}

                  {activeDocs ? (
                    <div className="border-border rounded-lg border p-3">
                      <p className="text-muted-foreground text-sm whitespace-pre-wrap">
                        {activeDocs}
                      </p>
                      {activeDocsUrl ? (
                        <a
                          href={activeDocsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-block text-sm underline"
                        >
                          Open docs
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {loadingSkillDetail ? (
                  <div className="border-border space-y-2 rounded-md border p-3">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-11/12" />
                    <Skeleton className="h-4 w-8/12" />
                  </div>
                ) : null}

                <div className="space-y-2">
                  <RadioGroup
                    value={mode}
                    onValueChange={(next) => setMode(next as SkillMode)}
                    className="grid gap-2 sm:grid-cols-2"
                  >
                    {supportedModes.map((currentMode) => {
                      const checked = currentMode === mode;
                      return (
                        <label
                          key={currentMode}
                          className={`flex items-center gap-2 rounded-md border px-3 py-2 ${
                            checked
                              ? 'border-foreground bg-muted/70'
                              : 'border-border hover:bg-muted/40'
                          } ${supportedModes.length === 1 ? 'cursor-default' : 'cursor-pointer'}`}
                        >
                          <RadioGroupItem
                            value={currentMode}
                            disabled={supportedModes.length === 1}
                          />
                          <span className="text-sm font-medium">
                            {currentMode === 'managed' ? 'Managed' : 'BYOK'}
                          </span>
                        </label>
                      );
                    })}
                  </RadioGroup>
                </div>

                {mode === 'byok' && Object.keys(activeSecretSchema.properties).length > 0 ? (
                  <div className="space-y-2">
                    {renderSchemaFields(
                      activeSecretSchema,
                      secretValues,
                      (key, value) =>
                        setSecretValues((prev) => ({ ...prev, [key]: String(value ?? '') })),
                      { forceSecret: true }
                    )}
                    <p className="text-muted-foreground text-xs">
                      Secrets are encrypted at rest and are write-only.
                    </p>
                  </div>
                ) : null}

                {Object.keys(activeConfigSchema.properties).length > 0 ? (
                  <div className="space-y-2">
                    {renderSchemaFields(activeConfigSchema, configValues, (key, value) =>
                      setConfigValues((prev) => ({ ...prev, [key]: value }))
                    )}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-4" />
            )}

            <DialogFooter className="border-border bg-background flex-wrap gap-2 px-6 py-4 sm:flex-row sm:justify-end sm:space-x-0">
              {activeSkill ? (
                <>
                  {activeSkill.installation ? (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => uninstallMutation.mutate(activeSkill)}
                        disabled={installMutation.isPending || uninstallMutation.isPending}
                      >
                        Uninstall
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() =>
                          toggleMutation.mutate({
                            installationId: activeSkill.installation!.id,
                            enabled: !activeSkill.installation!.enabled,
                          })
                        }
                        disabled={
                          toggleMutation.isPending ||
                          installMutation.isPending ||
                          uninstallMutation.isPending
                        }
                      >
                        {activeSkill.installation.enabled ? 'Disable' : 'Enable'}
                      </Button>
                    </>
                  ) : null}

                  <Button
                    onClick={() => {
                      const configMissing = validateRequiredFields(
                        activeConfigSchema,
                        configValues
                      );
                      if (configMissing.length > 0) {
                        toast.error(`Missing required config: ${configMissing.join(', ')}`);
                        return;
                      }

                      if (mode === 'byok') {
                        const secretMissing = validateRequiredFields(
                          activeSecretSchema,
                          secretValues
                        );
                        if (secretMissing.length > 0) {
                          toast.error(`Missing required secret: ${secretMissing.join(', ')}`);
                          return;
                        }
                      }

                      const configPayload = buildConfigPayload(activeConfigSchema, configValues);
                      const apiKey = String(secretValues.apiKey || '').trim();

                      installMutation.mutate({
                        skillId: activeSkill.id,
                        mode,
                        config: configPayload,
                        apiKey: mode === 'byok' ? apiKey : undefined,
                      });
                    }}
                    disabled={
                      !activeSkill ||
                      installMutation.isPending ||
                      uninstallMutation.isPending ||
                      toggleMutation.isPending
                    }
                  >
                    {activeSkill.installation ? 'Save' : 'Install'}
                  </Button>
                </>
              ) : null}
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {!textGenerationSkill ? (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground text-base">Missing core skill</CardTitle>
            <CardDescription className="text-muted-foreground">
              The <code>text_generation</code> skill definition is missing; seed the database.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </div>
  );
}
