import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));
import { downloadPublicAsset, MAX_DOWNLOAD_BYTES } from './safe-download.js';

function respond(headers: Record<string, string>, body: Buffer[], statusCode = 200) {
  mocks.request.mockImplementationOnce((_url, options, callback) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => {
      options.lookup('source.example', { all: true }, (error: Error | null) => {
        if (error) {
          req.emit('error', error);
          return;
        }
        const response = Object.assign(Readable.from(body), { headers, statusCode });
        callback(response);
      });
    };
    return req;
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
});
it('rejects a hostname with any private DNS answer at connection lookup', async () => {
  mocks.lookup.mockResolvedValue([
    { address: '8.8.8.8', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ]);
  respond({}, [Buffer.from('private')]);
  await expect(downloadPublicAsset('https://source.example/file')).rejects.toThrow('non-public');
  expect(mocks.lookup).toHaveBeenCalledOnce();
});
it('pins validated DNS answers in the request lookup and supplies a deadline', async () => {
  respond({ 'content-type': 'image/png' }, [Buffer.from('asset')]);
  const downloaded = await downloadPublicAsset('https://source.example/file');
  expect(downloaded.buffer.toString()).toBe('asset');
  const options = mocks.request.mock.calls[0]![1];
  expect(options.agent).toBe(false);
  expect(options.signal).toBeInstanceOf(AbortSignal);
  const result = vi.fn();
  options.lookup('source.example', { all: true }, result);
  await vi.waitFor(() =>
    expect(result).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }])
  );
});
it('revalidates redirect targets instead of connecting to a private address', async () => {
  respond({ location: 'https://169.254.169.254/latest/meta-data' }, [], 302);
  await expect(downloadPublicAsset('https://source.example/file')).rejects.toThrow('public HTTPS');
  expect(mocks.request).toHaveBeenCalledOnce();
});
it('bounds redirects', async () => {
  for (let i = 0; i < 4; i++) {
    respond({ location: '/again' }, [], 302);
  }
  await expect(downloadPublicAsset('https://source.example/file')).rejects.toThrow('redirects');
  expect(mocks.request).toHaveBeenCalledTimes(4);
});
it('bounds bytes even when content length is absent', async () => {
  respond({}, [Buffer.alloc(MAX_DOWNLOAD_BYTES), Buffer.from('overflow')]);
  await expect(downloadPublicAsset('https://source.example/file')).rejects.toThrow(
    'download limit'
  );
});
it('rejects oversized declared lengths and compressed responses', async () => {
  respond({ 'content-length': String(MAX_DOWNLOAD_BYTES + 1) }, []);
  await expect(downloadPublicAsset('https://source.example/file')).rejects.toThrow(
    'download limit'
  );
  respond({ 'content-encoding': 'gzip' }, []);
  await expect(downloadPublicAsset('https://source.example/file')).rejects.toThrow('invalid');
});
