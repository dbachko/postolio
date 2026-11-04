import { beforeAll, expect, it, vi } from 'vitest';
vi.stubEnv('ASSETS_S3_BUCKET', 'test-bucket');
const { assertBrandStorageKey, deleteS3Objects, s3Client } = await import('./s3.js');
const send = vi.spyOn(s3Client, 'send').mockResolvedValue({} as never);
beforeAll(() => send.mockClear());
it.each([
  'brands/victim/uploads/a.jpg',
  'brands/own/uploads/a.jpg ',
  'brands/own/../victim/a.jpg',
  'brands/own/%2e%2e/a.jpg',
  'brands/own//a.jpg',
  'https://example.com/a.jpg',
])('rejects a foreign or noncanonical key: %s', async (key) => {
  expect(() => assertBrandStorageKey('own', key)).toThrow();
  await expect(deleteS3Objects([key], 'own')).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});
it('deletes only exact validated keys without trimming or decoding them', async () => {
  const key = 'brands/own/uploads/images/a.jpg';
  await deleteS3Objects([key, key], 'own');
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]![0].input).toMatchObject({ Delete: { Objects: [{ Key: key }] } });
});
