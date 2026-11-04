import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import Fastify from 'fastify';
import sharp from 'sharp';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn(), create: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));
vi.mock('@postolio/database-assets', () => ({ prismaAssets: { asset: { create: mocks.create } } }));
vi.stubEnv('ASSETS_S3_BUCKET', 'test-bucket');
const { registerImportRoutes } = await import('./import-routes.js');
const { s3Client } = await import('../../utils/s3.js');
const upload = vi.spyOn(s3Client, 'send').mockResolvedValue({} as never);

function respond(headers: Record<string, string>, body: Buffer[], statusCode = 200) {
  mocks.request.mockImplementationOnce((_url, options, callback) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () =>
      options.lookup('source.example', { all: true }, (error: Error | null) => {
        if (error) {
          req.emit('error', error);
        } else {
          callback(Object.assign(Readable.from(body), { headers, statusCode }));
        }
      });
    return req;
  });
}
async function importUrl(sourceUrl: string) {
  const app = Fastify();
  app.decorate('authenticateService', async () => {});
  registerImportRoutes(app);
  try {
    return await app.inject({
      method: 'POST',
      url: '/assets/import',
      payload: { brandId: 'own', sourceUrl },
    });
  } finally {
    await app.close();
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  mocks.create.mockImplementation(async ({ data }) => ({ id: 'imported', ...data }));
});
it.each(['http://127.0.0.1/image.png', 'https://169.254.169.254/image.png'])(
  'rejects unsafe source %s before storage',
  async (url) => {
    expect((await importUrl(url)).statusCode).toBe(500);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  }
);
it('rejects a public URL redirecting to a private destination before storage', async () => {
  respond({ location: 'https://127.0.0.1/private' }, [], 302);
  expect((await importUrl('https://source.example/image.png')).statusCode).toBe(500);
  expect(mocks.request).toHaveBeenCalledOnce();
  expect(upload).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});
it('imports a public image through the real adapter, bounded downloader, and image parser', async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } })
    .png()
    .toBuffer();
  respond({ 'content-type': 'image/png' }, [png]);
  const response = await importUrl('https://source.example/image.png');
  expect(response.statusCode).toBe(200);
  expect(response.json().asset).toMatchObject({
    brandId: 'own',
    width: 2,
    height: 2,
    fileSize: png.length,
  });
  expect(mocks.lookup).toHaveBeenCalledOnce();
  expect(upload).toHaveBeenCalledOnce();
  expect(mocks.create).toHaveBeenCalledOnce();
});
