import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import { InstagramConnector, type AccountIdentity } from '@postolio/connectors';
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const connector = new InstagramConnector();
const credentials = { accessToken: 'test-access-token' };
const account: AccountIdentity = { platform: 'instagram', externalAccountId: 'test-account' };
beforeEach(() => vi.resetAllMocks());
it('maps paginated provider posts through the current shared connector', async () => {
  vi.mocked(axios.get).mockResolvedValue({
    data: {
      data: [{ id: 'post-1', caption: 'caption', media_type: 'IMAGE', timestamp: '2025-01-01' }],
      paging: { next: 'next-page', cursors: { after: 'cursor-2' } },
    },
  });
  expect(await connector.listRecentPosts(credentials, account, 10, 'cursor-1')).toMatchObject({
    data: [{ id: 'post-1', caption: 'caption' }],
    hasMore: true,
    cursor: 'cursor-2',
  });
  expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('limit=10'));
  expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('after=cursor-1'));
});
it('creates and publishes an image container before returning the provider permalink', async () => {
  vi.mocked(axios.post)
    .mockResolvedValueOnce({ data: { id: 'container-1' } })
    .mockResolvedValueOnce({ data: { id: 'post-1' } });
  vi.mocked(axios.get).mockResolvedValueOnce({
    data: { permalink: 'https://example.test/post-1' },
  });
  const result = await connector.publish(
    { caption: 'caption', imageUrl: 'https://example.test/image.jpg' },
    credentials,
    account
  );
  expect(result).toMatchObject({
    externalPostId: 'post-1',
    permalink: 'https://example.test/post-1',
  });
  expect(axios.post).toHaveBeenNthCalledWith(2, expect.stringContaining('/media_publish'), {
    creation_id: 'container-1',
    access_token: credentials.accessToken,
  });
});
it('fails closed on provider failures and invalid media without publishing', async () => {
  vi.mocked(axios.get).mockRejectedValueOnce(new Error('provider unavailable'));
  await expect(connector.listRecentPosts(credentials, account)).rejects.toThrow();
  await expect(
    connector.publish({ caption: 'missing media' }, credentials, account)
  ).rejects.toThrow();
  expect(axios.post).not.toHaveBeenCalled();
});
