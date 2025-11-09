import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { customAlphabet } from 'nanoid';
import process from 'node:process';
const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10);
const DEFAULT_DEV_BUCKET = 'postolio-dev-assets-storage';
export const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
});
const allowDevFallback =
  !process.env.NODE_ENV || process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev';
const resolvedBucket =
  process.env.ASSETS_S3_BUCKET ||
  process.env.S3_BUCKET ||
  (allowDevFallback ? DEFAULT_DEV_BUCKET : undefined);
if (!resolvedBucket) {
  throw new Error('ASSETS_S3_BUCKET (or S3_BUCKET) is not configured for the Assets API');
}
export const assetsBucketName = resolvedBucket;
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB
/**
 * Generate a presigned URL for direct browser → S3 upload
 */
export async function generateUploadUrl(params) {
  const { brandId, fileName, contentType, fileType, fileSize } = params;
  // Validate file type
  if (fileType === 'image' && !contentType.startsWith('image/')) {
    throw new Error('Invalid content type for image');
  }
  if (fileType === 'video' && !contentType.startsWith('video/')) {
    throw new Error('Invalid content type for video');
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    throw new Error('Invalid file size');
  }
  // Generate unique S3 key
  const timestamp = Date.now();
  const uniqueId = nanoid();
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const s3Key = `brands/${brandId}/uploads/${fileType}s/${timestamp}_${uniqueId}_${sanitizedFileName}`;
  // Determine max file size based on type
  const maxSize = fileType === 'image' ? MAX_IMAGE_SIZE : MAX_VIDEO_SIZE;
  if (fileSize > maxSize) {
    const maxSizeMb = Math.floor(maxSize / (1024 * 1024));
    throw new Error(`File exceeds maximum allowed size of ${maxSizeMb}MB for ${fileType}s`);
  }
  // Create PutObject command
  const command = new PutObjectCommand({
    Bucket: assetsBucketName,
    Key: s3Key,
    ContentType: contentType,
  });
  // Generate presigned URL (valid for 15 minutes)
  const expiresIn = 900; // 15 minutes
  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn });
  return {
    uploadUrl,
    s3Key,
    expiresIn,
  };
}
/**
 * Get public CDN URL for an asset
 */
export function getAssetUrl(s3Key) {
  if (/^https?:\/\//i.test(s3Key)) {
    return s3Key;
  }
  const cdnDomain =
    process.env.ASSETS_CDN_DOMAIN?.trim() ||
    process.env.CDN_DOMAIN?.trim() ||
    `https://${assetsBucketName}.s3.amazonaws.com`;
  const normalizedDomain = cdnDomain.replace(/\/+$/, '');
  const domainWithProtocol = /^https?:\/\//i.test(normalizedDomain)
    ? normalizedDomain
    : `https://${normalizedDomain}`;
  const normalizedKey = s3Key.replace(/^\/+/, '');
  return `${domainWithProtocol}/${normalizedKey}`;
}
