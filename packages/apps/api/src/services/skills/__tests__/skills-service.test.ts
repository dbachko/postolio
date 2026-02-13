import { beforeEach, describe, expect, it, vi } from 'vitest';

type SkillDefinition = {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  modeSupported: 'managed' | 'byok' | 'both';
  scopesJson: unknown;
  configSchemaJson: unknown;
};

type SkillInstallation = {
  id: string;
  brandId: string;
  skillDefinitionId: string;
  enabled: boolean;
  mode: 'managed' | 'byok';
  configJson: unknown;
  secretId: string | null;
  createdByUserId: string | null;
};

const state = {
  definitions: [] as SkillDefinition[],
  installations: [] as SkillInstallation[],
  secrets: [] as Array<{ id: string }>,
};

function resetState() {
  state.definitions = [];
  state.installations = [];
  state.secrets = [];
}

vi.mock('../../../config/database.js', () => {
  const prisma = {
    skillDefinition: {
      findMany: vi.fn(async () =>
        state.definitions.slice().sort((a, b) => a.name.localeCompare(b.name))
      ),
      findUnique: vi.fn(async (args: any) => {
        const id = args?.where?.id as string | undefined;
        const found = state.definitions.find((d) => d.id === id) ?? null;
        if (!found) return null;
        const select = args?.select as Record<string, boolean> | undefined;
        if (!select) return found;
        const picked: Record<string, unknown> = {};
        for (const key of Object.keys(select)) {
          if (select[key]) picked[key] = (found as any)[key];
        }
        return picked;
      }),
    },
    skillInstallation: {
      count: vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        if (where.secretId) {
          return state.installations.filter((i) => i.secretId === where.secretId).length;
        }
        if (where.brandId) {
          return state.installations.filter((i) => i.brandId === where.brandId).length;
        }
        return state.installations.length;
      }),
      findMany: vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        if (where.brandId) {
          return state.installations.filter((i) => i.brandId === where.brandId);
        }
        return state.installations.slice();
      }),
      findUnique: vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        let found: SkillInstallation | null = null;
        if (where.id) {
          found = state.installations.find((i) => i.id === where.id) ?? null;
        } else if (where.brandId_skillDefinitionId) {
          const key = where.brandId_skillDefinitionId;
          found =
            state.installations.find(
              (i) => i.brandId === key.brandId && i.skillDefinitionId === key.skillDefinitionId
            ) ?? null;
        }
        if (!found) return null;
        const select = args?.select as Record<string, boolean> | undefined;
        if (!select) return found;
        const picked: Record<string, unknown> = {};
        for (const key of Object.keys(select)) {
          if (select[key]) picked[key] = (found as any)[key];
        }
        return picked;
      }),
      upsert: vi.fn(async (args: any) => {
        const key = args?.where?.brandId_skillDefinitionId;
        const existing = state.installations.find(
          (i) => i.brandId === key.brandId && i.skillDefinitionId === key.skillDefinitionId
        );
        if (existing) return existing;
        const create = args?.create;
        const created: SkillInstallation = {
          id: `inst-${state.installations.length + 1}`,
          brandId: create.brandId,
          skillDefinitionId: create.skillDefinitionId,
          enabled: create.enabled,
          mode: create.mode,
          configJson: create.configJson,
          secretId: create.secretId ?? null,
          createdByUserId: create.createdByUserId ?? null,
        };
        state.installations.push(created);
        return created;
      }),
      delete: vi.fn(async (args: any) => {
        const id = args?.where?.id as string;
        const idx = state.installations.findIndex((i) => i.id === id);
        if (idx < 0) throw new Error('installation_not_found');
        const [removed] = state.installations.splice(idx, 1);
        return removed;
      }),
      update: vi.fn(async (args: any) => {
        const id = args?.where?.id as string;
        const data = args?.data ?? {};
        const idx = state.installations.findIndex((i) => i.id === id);
        if (idx < 0) throw new Error('installation_not_found');
        const next = { ...state.installations[idx], ...data };
        state.installations[idx] = next;
        return next;
      }),
      create: vi.fn(async (args: any) => {
        const data = args?.data;
        const created: SkillInstallation = {
          id: `inst-${state.installations.length + 1}`,
          brandId: data.brandId,
          skillDefinitionId: data.skillDefinitionId,
          enabled: data.enabled,
          mode: data.mode,
          configJson: data.configJson,
          secretId: data.secretId ?? null,
          createdByUserId: data.createdByUserId ?? null,
        };
        state.installations.push(created);
        return created;
      }),
    },
    encryptedSecret: {
      create: vi.fn(async () => ({ id: 'secret-created' })),
      deleteMany: vi.fn(async (args: any) => {
        const id = args?.where?.id as string;
        const before = state.secrets.length;
        state.secrets = state.secrets.filter((s) => s.id !== id);
        return { count: before - state.secrets.length };
      }),
    },
    $transaction: vi.fn(async (arg: any) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      if (typeof arg === 'function') return arg(prisma);
      return null;
    }),
  } as any;

  return {
    getDatabaseUrl: vi.fn(() => 'postgresql://test:test@localhost:5432/test?schema=public'),
    getDatabaseClient: vi.fn(() => prisma),
    prisma,
  };
});

vi.mock('../seed.js', () => ({
  ensureSkillDefinitionsSeeded: vi.fn(async () => {}),
}));

describe('skills-service', () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
  });

  it('bootstraps default installations only when brand has none', async () => {
    const { ensureDefaultSkillInstallations } = await import('../skills-service.js');

    await ensureDefaultSkillInstallations('brand-1', 'user-1');
    expect(state.installations.map((i) => i.skillDefinitionId).sort()).toEqual([
      'image_generation',
      'text_generation',
      'web_fetch',
    ]);

    await ensureDefaultSkillInstallations('brand-1', 'user-1');
    expect(state.installations).toHaveLength(3);
  });

  it('returns skill details with installation and hasSecret', async () => {
    state.definitions.push({
      id: 'text_generation',
      name: 'AI Text',
      description: 'Generate text',
      icon: 'sparkles',
      modeSupported: 'both',
      scopesJson: { docs: 'Test docs' },
      configSchemaJson: { type: 'object' },
    });
    state.installations.push({
      id: 'inst-1',
      brandId: 'brand-1',
      skillDefinitionId: 'text_generation',
      enabled: true,
      mode: 'byok',
      configJson: { model: 'gpt-5-mini' },
      secretId: 'secret-1',
      createdByUserId: 'user-1',
    });

    const { getSkill } = await import('../skills-service.js');
    const skill = await getSkill('brand-1', 'text_generation');

    expect(skill).toMatchObject({
      id: 'text_generation',
      installation: {
        id: 'inst-1',
        enabled: true,
        mode: 'byok',
        hasSecret: true,
      },
    });
  });

  it('uninstalls by skill id and cleans up an unused secret', async () => {
    state.installations.push({
      id: 'inst-1',
      brandId: 'brand-1',
      skillDefinitionId: 'text_generation',
      enabled: true,
      mode: 'byok',
      configJson: {},
      secretId: 'secret-1',
      createdByUserId: 'user-1',
    });
    state.secrets.push({ id: 'secret-1' });

    const { uninstallSkillBySkillId } = await import('../skills-service.js');
    const result = await uninstallSkillBySkillId({
      brandId: 'brand-1',
      skillId: 'text_generation',
    });

    expect(result).toEqual({ uninstalled: true });
    expect(state.installations).toHaveLength(0);
    expect(state.secrets).toHaveLength(0);
  });

  it('uninstalls by installation id and does not remove shared secret', async () => {
    state.installations.push(
      {
        id: 'inst-1',
        brandId: 'brand-1',
        skillDefinitionId: 'text_generation',
        enabled: true,
        mode: 'byok',
        configJson: {},
        secretId: 'secret-shared',
        createdByUserId: 'user-1',
      },
      {
        id: 'inst-2',
        brandId: 'brand-1',
        skillDefinitionId: 'image_generation',
        enabled: true,
        mode: 'byok',
        configJson: {},
        secretId: 'secret-shared',
        createdByUserId: 'user-1',
      }
    );
    state.secrets.push({ id: 'secret-shared' });

    const { uninstallSkillByInstallationId } = await import('../skills-service.js');
    const result = await uninstallSkillByInstallationId({ installationId: 'inst-1' });

    expect(result).toEqual({ uninstalled: true });
    expect(state.installations).toHaveLength(1);
    expect(state.installations[0].id).toBe('inst-2');
    expect(state.secrets).toHaveLength(1);
  });

  it('returns safe stub output from trySkill for enabled skill', async () => {
    state.definitions.push({
      id: 'text_generation',
      name: 'AI Text',
      description: 'Generate text',
      icon: null,
      modeSupported: 'both',
      scopesJson: {},
      configSchemaJson: {},
    });
    state.installations.push({
      id: 'inst-1',
      brandId: 'brand-1',
      skillDefinitionId: 'text_generation',
      enabled: true,
      mode: 'managed',
      configJson: {},
      secretId: null,
      createdByUserId: 'user-1',
    });

    const { trySkill } = await import('../skills-service.js');
    const result = await trySkill({
      brandId: 'brand-1',
      skillId: 'text_generation',
      input: { prompt: 'Write a launch teaser.' },
    });

    expect(result.ok).toBe(true);
    expect(result.note).toContain('Safe stub');
    expect(result.output).toMatchObject({
      preview: expect.stringContaining('Write a launch teaser.'),
    });
  });

  it('throws when trySkill is called for disabled installation', async () => {
    state.definitions.push({
      id: 'text_generation',
      name: 'AI Text',
      description: 'Generate text',
      icon: null,
      modeSupported: 'both',
      scopesJson: {},
      configSchemaJson: {},
    });
    state.installations.push({
      id: 'inst-1',
      brandId: 'brand-1',
      skillDefinitionId: 'text_generation',
      enabled: false,
      mode: 'managed',
      configJson: {},
      secretId: null,
      createdByUserId: 'user-1',
    });

    const { trySkill } = await import('../skills-service.js');

    await expect(
      trySkill({
        brandId: 'brand-1',
        skillId: 'text_generation',
        input: { prompt: 'Hello' },
      })
    ).rejects.toThrow('Skill is not enabled for this brand');
  });
});
