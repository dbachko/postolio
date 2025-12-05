import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ListObjectsV2Command, DeleteObjectsCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, assetsBucketName } from '../utils/s3.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// All demo assets live under this local directory (relative to this file)
const LOCAL_DEMO_DIR = path.resolve(__dirname, '../../demo-assets');

// S3 prefix used for all demo images
const DEMO_S3_PREFIX = process.env.DEMO_ASSETS_PREFIX || 'system/demo/default';

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

function inferContentType(fileName: string): string {
  const ext = fileName.toLowerCase();
  if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) return 'image/jpeg';
  if (ext.endsWith('.png')) return 'image/png';
  if (ext.endsWith('.webp')) return 'image/webp';
  if (ext.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

async function listLocalFiles(rootDir: string): Promise<Map<string, string>> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = new Map<string, string>();

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fileName = entry.name;
    const absPath = path.join(rootDir, fileName);
    const key = `${DEMO_S3_PREFIX}/${fileName}`;
    files.set(key, absPath);
  }

  return files;
}

async function listRemoteKeys(): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const resp = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: assetsBucketName,
        Prefix: `${DEMO_S3_PREFIX}/`,
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of resp.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

async function uploadFile(key: string, filePath: string): Promise<void> {
  const body = await fs.readFile(filePath);
  const contentType = inferContentType(filePath);

  if (DRY_RUN) {
    console.log(`[DRY RUN] Would upload ${filePath} → s3://${assetsBucketName}/${key}`);
    return;
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: assetsBucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  console.log(`Uploaded ${filePath} → s3://${assetsBucketName}/${key}`);
}

async function deleteKeys(keys: string[]): Promise<void> {
  if (!keys.length) return;

  if (DRY_RUN) {
    for (const key of keys) {
      console.log(`[DRY RUN] Would delete s3://${assetsBucketName}/${key}`);
    }
    return;
  }

  // S3 DeleteObjects supports up to 1000 keys per request
  const chunkSize = 1000;
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize);
    await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: assetsBucketName,
        Delete: {
          Objects: chunk.map((Key) => ({ Key })),
        },
      })
    );
    console.log(`Deleted ${chunk.length} objects under ${DEMO_S3_PREFIX}/`);
  }
}

async function main() {
  try {
    console.log(`Syncing demo assets from ${LOCAL_DEMO_DIR}`);
    console.log(`Target bucket: ${assetsBucketName}`);
    console.log(`S3 prefix: ${DEMO_S3_PREFIX}`);
    if (DRY_RUN) {
      console.log('Running in DRY RUN mode (no changes will be made).');
    }

    // Ensure local directory exists
    try {
      await fs.access(LOCAL_DEMO_DIR);
    } catch {
      console.error(
        `Local demo assets directory does not exist: ${LOCAL_DEMO_DIR}. ` +
          'Create it and add image files before running this script.'
      );
      process.exit(1);
    }

    const localFiles = await listLocalFiles(LOCAL_DEMO_DIR);
    console.log(`Found ${localFiles.size} local demo asset(s).`);

    // In DRY_RUN mode, avoid calling S3 list operations in case the bucket does not exist.
    const remoteKeys = DRY_RUN ? [] : await listRemoteKeys();
    if (!DRY_RUN) {
      console.log(`Found ${remoteKeys.length} existing S3 object(s) under prefix.`);
    }

    // Upload / overwrite desired keys
    for (const [key, filePath] of localFiles.entries()) {
      await uploadFile(key, filePath);
    }

    // Delete remote keys that are no longer present locally
    const desiredKeys = new Set(localFiles.keys());
    const keysToDelete = remoteKeys.filter((k) => !desiredKeys.has(k));
    if (keysToDelete.length > 0) {
      console.log(`Deleting ${keysToDelete.length} stale S3 object(s).`);
      await deleteKeys(keysToDelete);
    } else if (!DRY_RUN) {
      console.log('No stale S3 objects to delete.');
    }

    console.log('Demo assets sync complete.');
  } catch (error) {
    console.error('Failed to sync demo assets:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
