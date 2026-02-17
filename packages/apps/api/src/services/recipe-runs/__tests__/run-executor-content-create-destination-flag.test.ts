import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
};

function resetState() {
  state.runStatus = 'queued';
}

const envSnapshot = {
  FEATURE_MULTI_DESTINATION_ENABLED: process.env.FEATURE_MULTI_DESTINATION_ENABLED,
  FEATURE_MULTI_DESTINATION_ALLOWLIST_EMAILS:
    process.env.FEATURE_MULTI_DESTINATION_ALLOWLIST_EMAILS,
  FEATURE_MULTI_DESTINATION_ALLOWLIST_USER_IDS:
    process.env.FEATURE_MULTI_DESTINATION_ALLOWLIST_USER_IDS,
};

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
          inputJson: { target_social_account_id: 'sa-1' },
          createdByUserId: 'user-1',
          createdByUser: { id: 'user-1', email: 'user@example.com' },
          recipeTemplateVersion: {
            id: 'version-1',
            recipeTemplate: {
              id: 'recipe-1',
              name: 'Content Create',
              slug: 'content-create',
              brandId: null,
              isCurated: true,
              status: 'published',
            },
            configJson: {
              inputs: { required: [], optional: [] },
              steps: [
                {
                  type: 'content_create',
                  name: 'Create content',
                  input: {
                    series_name: 'Series',
                    strategy: 'start_date',
                    start_date: '2026-02-01',
                    posting_time: '09:00',
                    target_social_account_id: '{{input.target_social_account_id}}',
                    posts: [{ caption: 'Hello world', hashtags: [] }],
                  },
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
      createMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => ({ id: 'step-1' })),
      findFirst: vi.fn(async () => null),
    },
    socialAccount: {
      findFirst: vi.fn(async (args: any) => {
        if (args?.where?.id !== 'sa-1' || args?.where?.brandId !== 'brand-1') return null;
        return { id: 'sa-1', platform: 'facebook' };
      }),
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

vi.mock('../../timezone.js', () => ({
  TimezoneService: {
    getBrandTimezone: vi.fn(async () => 'UTC'),
    createDateInBrandTimezone: vi.fn((ymd: string, time: string) => new Date(`${ymd}T${time}:00Z`)),
  },
}));

vi.mock('../../openai-client.js', () => ({
  getDefaultOpenAIModel: vi.fn(() => 'gpt-5-mini'),
  getOpenAIClient: vi.fn(() => null),
}));

describe('executeRecipeRun content_create destination gating', () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
    process.env.FEATURE_MULTI_DESTINATION_ENABLED = 'false';
    process.env.FEATURE_MULTI_DESTINATION_ALLOWLIST_EMAILS = '';
    process.env.FEATURE_MULTI_DESTINATION_ALLOWLIST_USER_IDS = '';
  });

  afterEach(() => {
    process.env.FEATURE_MULTI_DESTINATION_ENABLED = envSnapshot.FEATURE_MULTI_DESTINATION_ENABLED;
    process.env.FEATURE_MULTI_DESTINATION_ALLOWLIST_EMAILS =
      envSnapshot.FEATURE_MULTI_DESTINATION_ALLOWLIST_EMAILS;
    process.env.FEATURE_MULTI_DESTINATION_ALLOWLIST_USER_IDS =
      envSnapshot.FEATURE_MULTI_DESTINATION_ALLOWLIST_USER_IDS;
  });

  it('fails when targeting a non-Instagram destination without the feature enabled', async () => {
    const { executeRecipeRun } = await import('../run-executor.js');

    const result = await executeRecipeRun('run-1');

    expect(result).toEqual({ runId: 'run-1', status: 'failed' });
    expect(state.runStatus).toBe('failed');
  });
});
