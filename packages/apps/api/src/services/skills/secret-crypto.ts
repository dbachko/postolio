import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

type EncryptedPayload = {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  keyVersion: number;
};

function getKeyForVersion(version: number): Buffer {
  if (version !== 1) {
    throw new Error(`Unsupported secrets key version: ${version}`);
  }

  const raw = (process.env.BYOK_SECRETS_MASTER_KEY || '').trim();
  if (!raw) {
    throw new Error('BYOK secrets encryption key is not configured (BYOK_SECRETS_MASTER_KEY)');
  }

  let key: Buffer;
  try {
    key = Buffer.from(raw, 'base64');
  } catch {
    throw new Error('BYOK_SECRETS_MASTER_KEY must be base64-encoded');
  }

  if (key.length !== 32) {
    throw new Error('BYOK_SECRETS_MASTER_KEY must decode to 32 bytes (AES-256-GCM key)');
  }

  return key;
}

export function encryptSecret(plaintext: string, keyVersion = 1): EncryptedPayload {
  const key = getKeyForVersion(keyVersion);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, iv, tag, keyVersion };
}

export function decryptSecret(payload: EncryptedPayload): string {
  const key = getKeyForVersion(payload.keyVersion);
  const decipher = createDecipheriv('aes-256-gcm', key, payload.iv);
  decipher.setAuthTag(payload.tag);
  const plaintext = Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
