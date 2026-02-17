import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@postolio/database', () => ({
  Prisma: {
    Decimal: class Decimal {
      constructor(private value: string) {
        this.value = value;
      }
    },
  },
}));

vi.mock('../skills/index.js', () => ({
  executeSkillCall: vi.fn(async () => {
    throw new Error('executeSkillCall should not be called in this test');
  }),
}));

const state = {
  runStatus: 'queued',
  artifacts: [] as Array<{ name: string; contentText: string | null }>,
};

function resetState() {
  state.runStatus = 'queued';
  state.artifacts = [];
}

vi.mock('../../../config/database.js', () => {
  const prisma = {
    recipeRun: {
      findUnique: vi.fn(async (args: any) => {
        const whereId = args?.where?.id;
        if (!whereId || whereId !== 'run-1') return null;
        return {
          id: 'run-1',
          brandId: 'brand-1',
          recipeTemplateId: 'recipe-1',
          recipeTemplateVersionId: 'version-1',
          status: state.runStatus,
          inputJson: {},
          recipeTemplateVersion: {
            id: 'version-1',
            recipeTemplate: {
              id: 'recipe-1',
              name: 'Foreach Recipe',
              slug: 'foreach-recipe',
              brandId: null,
              isCurated: true,
              status: 'published',
            },
            configJson: {
              inputs: { required: [], optional: [] },
              steps: [
                {
                  type: 'transform',
                  name: 'Build pillars',
                  output_key: 'pillars',
                  input: ['Launch', 'Feature'],
                },
                {
                  type: 'foreach',
                  name: 'Generate captions',
                  items: '{{pillars}}',
                  item_key: 'pillar',
                  output_key: 'captions',
                  do: [
                    {
                      type: 'transform',
                      name: 'Build caption',
                      output_key: 'caption',
                      input: 'Post about {{pillar}}',
                    },
                  ],
                },
                {
                  type: 'export',
                  name: 'Export output',
                  artifacts: [
                    {
                      kind: 'json',
                      name: 'captions.json',
                      mime_type: 'application/json',
                      content: '{{captions}}',
                    },
                  ],
                },
              ],
            },
          },
        };
      }),
      updateMany: vi.fn(async (args: any) => {
        if (args?.where?.id === 'run-1' && args?.where?.status === 'queued') {
          state.runStatus = 'running';
          return { count: 1 };
        }
        return { count: 0 };
      }),
      update: vi.fn(async (args: any) => {
        if (args?.where?.id === 'run-1' && args?.data?.status) {
          state.runStatus = args.data.status;
        }
        return { id: 'run-1' };
      }),
    },
    recipeRunStep: {
      createMany: vi.fn(async () => ({ count: 3 })),
      update: vi.fn(async () => ({ id: 'step-1' })),
      findFirst: vi.fn(async () => null),
    },
    recipeRunArtifact: {
      create: vi.fn(async (args: any) => {
        const name = args?.data?.name || 'artifact';
        const contentText = args?.data?.contentText ?? null;
        state.artifacts.push({ name, contentText });
        return { id: `artifact-${state.artifacts.length}` };
      }),
    },
    recipeRunCost: {
      create: vi.fn(async () => ({ id: 'cost-1' })),
    },
    skillInstallation: {
      findUnique: vi.fn(async () => ({ enabled: true, configJson: {} })),
    },
    encryptedSecret: {
      findUnique: vi.fn(async () => null),
    },
    content: {
      findFirst: vi.fn(async () => null),
    },
    contentSeries: {
      create: vi.fn(async () => ({ id: 'series-1', name: 'Series' })),
    },
    contentMediaAsset: {
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    $transaction: vi.fn(async (arg: any) => {
      if (typeof arg === 'function') return arg(prisma);
      if (Array.isArray(arg)) return Promise.all(arg);
      return null;
    }),
  } as any;

  return {
    getDatabaseUrl: vi.fn(() => 'postgresql://test:test@localhost:5432/test?schema=public'),
    getDatabaseClient: vi.fn(() => prisma),
    prisma,
  };
});

vi.mock('../../openai-client.js', () => ({
  getDefaultOpenAIModel: vi.fn(() => 'gpt-5-mini'),
  getOpenAIClient: vi.fn(() => null),
}));

describe('executeRecipeRun foreach support', () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
  });

  it('executes foreach steps and exports aggregated iteration outputs', async () => {
    const { executeRecipeRun } = await import('../run-executor.js');

    const result = await executeRecipeRun('run-1');

    expect(result).toEqual({ runId: 'run-1', status: 'success' });
    expect(state.runStatus).toBe('success');

    const artifact = state.artifacts.find((a) => a.name === 'captions.json');
    expect(artifact).toBeDefined();
    expect(artifact?.contentText || '').toContain('Post about Launch');
    expect(artifact?.contentText || '').toContain('Post about Feature');
  });
});
