import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { prismaAssets, prismaAssetsPool } from '@postolio/database-assets';
import { registerUploadRoutes } from '../src/routes/assets/upload-routes.js';
import { registerItemRoutes } from '../src/routes/assets/item-routes.js';
import { registerBulkRoutes } from '../src/routes/assets/bulk-routes.js';
import { s3Client } from '../src/utils/s3.js';

const databaseUrl = new URL(process.env.ASSETS_DATABASE_URL || 'postgresql://invalid/invalid');
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname) ||
  !/_(test|review)$/.test(databaseUrl.pathname)
) {
  throw new Error('Integration tests require a local database whose name ends in _test or _review');
}
const own = `test-${randomUUID()}`;
const victim = `test-${randomUUID()}`;
const victimKey = `brands/${victim}/uploads/images/original.jpg`;
const app = Fastify();
const send = vi.spyOn(s3Client, 'send').mockResolvedValue({} as never);
let victimId: string;
let ownId: string;
beforeAll(async () => {
  app.decorate('authenticateService', async () => {});
  registerUploadRoutes(app);
  registerItemRoutes(app);
  registerBulkRoutes(app);
  const base = {
    uploadedBy: 'test',
    fileName: 'original.jpg',
    fileType: 'image',
    mimeType: 'image/jpeg',
    fileSize: 1,
    s3Bucket: 'test-bucket',
  };
  victimId = (
    await prismaAssets.asset.create({ data: { ...base, brandId: victim, s3Key: victimKey } })
  ).id;
  ownId = (
    await prismaAssets.asset.create({
      data: { ...base, brandId: own, s3Key: `brands/${own}/uploads/images/own.jpg` },
    })
  ).id;
});
afterAll(async () => {
  await prismaAssets.asset.deleteMany({ where: { brandId: { in: [own, victim] } } });
  await prismaAssets.assetTaxonomyItem.deleteMany({ where: { brandId: { in: [own, victim] } } });
  await app.close();
  await prismaAssets.$disconnect();
  await prismaAssetsPool.end();
});
it('rejects another brand storage key, including the whitespace uniqueness bypass', async () => {
  for (const s3Key of [victimKey, victimKey + ' ']) {
    const response = await app.inject({
      method: 'POST',
      url: '/assets',
      payload: {
        brandId: own,
        s3Key,
        fileName: 'alias.jpg',
        fileType: 'image',
        mimeType: 'image/jpeg',
        fileSize: 1,
      },
    });
    expect(response.statusCode).toBe(400);
  }
  expect(send).not.toHaveBeenCalled();
});
it('refuses to delete a previously poisoned record without deleting the victim object', async () => {
  const poisoned = await prismaAssets.asset.create({
    data: {
      brandId: own,
      s3Key: victimKey + ' ',
      s3Bucket: 'test-bucket',
      fileName: 'alias.jpg',
      fileType: 'image',
      mimeType: 'image/jpeg',
      fileSize: 1,
      uploadedBy: 'test',
    },
  });
  expect((await app.inject({ method: 'DELETE', url: `/assets/${poisoned.id}` })).statusCode).toBe(
    500
  );
  expect(send).not.toHaveBeenCalled();
  expect(await prismaAssets.asset.findUnique({ where: { id: victimId } })).not.toBeNull();
});
it.each([
  { move_to_collection: { collectionId: null } },
  { add_labels: { labelNames: ['test'] } },
  { remove_labels: { labelIds: ['test'] } },
  { delete: {} },
])('rejects foreign and mixed batches before any mutation: %j', async (action) => {
  for (const assetIds of [[victimId], [ownId, victimId], [ownId, 'missing']]) {
    const response = await app.inject({
      method: 'POST',
      url: '/assets/bulk',
      payload: { brandId: own, assetIds, action },
    });
    expect(response.statusCode).toBe(403);
  }
  expect(await prismaAssets.asset.findUnique({ where: { id: victimId } })).not.toBeNull();
  expect(send).not.toHaveBeenCalled();
});
it('supports valid creation and updates without a collection and explicit collection clearing', async () => {
  const created = await app.inject({
    method: 'POST',
    url: '/assets',
    payload: {
      brandId: own,
      s3Key: `brands/${own}/uploads/images/new.jpg`,
      fileName: 'new.jpg',
      fileType: 'image',
      mimeType: 'image/jpeg',
      fileSize: 1,
    },
  });
  expect(created.statusCode).toBe(200);
  const id = created.json().asset.id;
  expect(
    (
      await app.inject({ method: 'PATCH', url: `/assets/${id}`, payload: { title: 'updated' } })
    ).json().asset.title
  ).toBe('updated');
  expect(
    (
      await app.inject({ method: 'PATCH', url: `/assets/${id}`, payload: { collectionId: null } })
    ).json().asset.collectionId
  ).toBeNull();
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/assets/bulk',
        payload: {
          brandId: own,
          assetIds: [id],
          action: { move_to_collection: { collectionId: null } },
        },
      })
    ).statusCode
  ).toBe(200);
});

it.each(['single', 'bulk'] as const)(
  'deletes only an owned asset and its canonical thumbnails via %s',
  async (mode) => {
    send.mockClear();
    const prefix = `brands/${own}/uploads/images/${mode}`;
    const asset = await prismaAssets.asset.create({
      data: {
        brandId: own,
        uploadedBy: 'test',
        fileName: `${mode}.jpg`,
        fileType: 'image',
        mimeType: 'image/jpeg',
        fileSize: 1,
        s3Bucket: 'test-bucket',
        s3Key: `${prefix}.jpg`,
        thumbnailKey: `${prefix}-thumb.jpg`,
        thumbnailSmallKey: `${prefix}-small.jpg`,
        thumbnailLargeKey: `${prefix}-large.jpg`,
      },
    });
    const response =
      mode === 'single'
        ? await app.inject({ method: 'DELETE', url: `/assets/${asset.id}` })
        : await app.inject({
            method: 'POST',
            url: '/assets/bulk',
            payload: { brandId: own, assetIds: [asset.id], action: { delete: {} } },
          });
    expect(response.statusCode).toBe(200);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0].input).toMatchObject({
      Delete: {
        Objects: [
          { Key: asset.s3Key },
          { Key: asset.thumbnailKey },
          { Key: asset.thumbnailSmallKey },
          { Key: asset.thumbnailLargeKey },
        ],
      },
    });
    expect(await prismaAssets.asset.findUnique({ where: { id: asset.id } })).toBeNull();
    expect(await prismaAssets.asset.findUnique({ where: { id: victimId } })).not.toBeNull();
  }
);
it('rejects foreign labels without creating any assignments', async () => {
  const label = await prismaAssets.assetTaxonomyItem.create({
    data: { brandId: victim, type: 'LABEL', name: 'foreign' },
  });
  const response = await app.inject({
    method: 'POST',
    url: '/assets/bulk',
    payload: { brandId: own, assetIds: [ownId], action: { add_labels: { labelIds: [label.id] } } },
  });
  expect(response.statusCode).toBe(400);
  expect(await prismaAssets.assetTaxonomyAssignment.count({ where: { assetId: ownId } })).toBe(0);
});
