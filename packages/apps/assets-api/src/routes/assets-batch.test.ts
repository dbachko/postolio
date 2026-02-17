import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

// Minimal environment required for S3 URL helper
process.env.ASSETS_S3_BUCKET = process.env.ASSETS_S3_BUCKET || 'test-assets-bucket';

// Prisma client mock for assets database (use vi.hoisted for safe mocking)
type PrismaAssetsMock = {
  asset: {
    findMany: Mock;
  };
};

const prismaAssetsMock = vi.hoisted(() => ({
  asset: {
    findMany: vi.fn(),
  },
})) as PrismaAssetsMock;

vi.mock('@postolio/database-assets', () => ({
  prismaAssets: prismaAssetsMock,
}));

// Mock main application Prisma client used by compiled assets.js
vi.mock('../utils/main-db.js', () => ({
  mainPrisma: {
    brand: {
      findFirst: vi.fn(),
    },
  },
  disconnectMainPrisma: vi.fn(),
}));

describe('Assets batch route', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();

    app = fastify({ logger: false });

    // Stub user/service authentication as no-ops for tests
    app.decorate(
      'authenticate',
      async function (request: FastifyRequest & { user?: { id?: string; userId?: string } }) {
        request.user = { id: 'user-123', userId: 'user-123' };
      }
    );

    app.decorate('authenticateService', async function () {
      return;
    });

    const mod = await import('./assets');
    const assetsRoutes = mod.default as (instance: FastifyInstance, opts: unknown) => unknown;

    await app.register(assetsRoutes, { prefix: '/assets-api/v1' });
    await app.ready();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('uses archivedAt filter and returns assets ordered by requested IDs', async () => {
    prismaAssetsMock.asset.findMany.mockResolvedValue([
      {
        id: 'asset-2',
        s3Key: 'keys/asset-2.jpg',
        thumbnailKey: null,
      },
      {
        id: 'asset-1',
        s3Key: 'keys/asset-1.jpg',
        thumbnailKey: 'thumbs/asset-1.jpg',
      },
    ]);

    const assetIds = ['asset-1', 'asset-2', 'asset-missing'];

    const response = await app.inject({
      method: 'POST',
      url: '/assets-api/v1/assets/batch',
      headers: {
        'content-type': 'application/json',
      },
      payload: { assetIds },
    });

    expect(response.statusCode).toBe(200);

    expect(prismaAssetsMock.asset.findMany).toHaveBeenCalledTimes(1);
    const args = prismaAssetsMock.asset.findMany.mock.calls[0][0];

    expect(args.where).toMatchObject({
      id: { in: assetIds },
      archivedAt: null,
    });
    expect(args.where).not.toHaveProperty('deletedAt');

    const payload = response.json() as { assets: Array<Record<string, unknown> | null> };
    expect(payload.assets).toHaveLength(3);

    expect(payload.assets[0]).toMatchObject({
      id: 'asset-1',
      url: expect.stringContaining('asset-1'),
    });

    expect(payload.assets[1]).toMatchObject({
      id: 'asset-2',
      url: expect.stringContaining('asset-2'),
    });

    expect(payload.assets[2]).toBeNull();
  });
});
