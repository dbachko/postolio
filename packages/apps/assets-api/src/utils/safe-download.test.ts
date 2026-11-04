import { describe, expect, it } from 'vitest';
import { downloadPublicAsset, isPublicAddress } from './safe-download.js';

describe('remote asset network policy', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '224.0.0.1',
    '::1',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
  ])('rejects non-public address %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each(['8.8.8.8', '2606:4700:4700::1111'])('permits public address %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
  it.each([
    'http://example.com/file',
    'file:///etc/passwd',
    'https://127.0.0.1/',
    'https://2130706433/',
    'https://[::ffff:127.0.0.1]/',
    'https://user:pass@example.com/',
    'https://example.com:8443/',
  ])('rejects forbidden URL before connecting: %s', async (url) => {
    await expect(downloadPublicAsset(url)).rejects.toThrow();
  });
});
