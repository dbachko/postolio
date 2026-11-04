/// <reference types="node" />
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Uppy from '@uppy/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const getUploadUrl = vi.hoisted(() => vi.fn());
vi.mock('@/features/assets/api/client', () => ({
  assetsApi: { getUploadUrl, createAsset: vi.fn() },
}));

import { configureAssetUploadPlugin } from './asset-upload-sidebar-uploader';

describe('configureAssetUploadPlugin', () => {
  let server: Server;
  let baseUrl: string;
  const puts: Array<{ url?: string; contentType?: string; size: number }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Methods', 'PUT');
      res.setHeader('Access-Control-Expose-Headers', 'ETag');
      if (req.method === 'OPTIONS') {
        res.end();
        return;
      }
      let size = 0;
      req.on('data', (chunk: Buffer) => (size += chunk.length));
      req.on('end', () => {
        puts.push({ url: req.url, contentType: req.headers['content-type'], size });
        res.setHeader('ETag', '"etag"');
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('uploads to the presigned URL and keeps the key issued by the assets API', async () => {
    const s3Key = 'brands/b1/images/photo.png';
    getUploadUrl.mockResolvedValue({ s3Key, uploadUrl: `${baseUrl}/presigned?sig=abc` });

    const uppy = new Uppy();
    const s3KeyById = { current: new Map<string, string>() };
    configureAssetUploadPlugin(uppy, {
      brandId: 'b1',
      setError: vi.fn(),
      s3KeyById,
      videoMetaById: { current: new Map() },
    });
    const success = vi.fn();
    uppy.on('upload-success', success);

    const id = uppy.addFile({
      name: 'photo.png',
      type: 'image/png',
      data: new Blob(['png-bytes'], { type: 'image/png' }),
    });
    const result = await uppy.upload();

    expect(result?.failed ?? []).toEqual([]);
    expect(getUploadUrl).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: 'b1', fileName: 'photo.png', fileType: 'image' })
    );
    expect(puts).toEqual([
      { url: '/presigned?sig=abc', contentType: 'image/png', size: 'png-bytes'.length },
    ]);
    expect(s3KeyById.current.get(id)).toBe(s3Key);
    expect(success.mock.calls[0][1].body.key).toBe(s3Key);
  });
});
