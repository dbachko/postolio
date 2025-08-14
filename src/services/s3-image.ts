import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import sharp from 'sharp'
import { createHash } from 'crypto'

// Initialize AWS clients
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
})

const cloudfrontClient = new CloudFrontClient({
  region: process.env.AWS_REGION || 'us-east-1',
})

// Configuration
// Required environment variables for production:
// S3_IMAGES_BUCKET: S3 bucket name for storing images
// CLOUDFRONT_DISTRIBUTION_ID: CloudFront distribution ID for cache invalidation
// CLOUDFRONT_DOMAIN: CloudFront domain for CDN URLs
// AWS_REGION: AWS region (defaults to us-east-1)
const BUCKET_NAME = process.env.S3_IMAGES_BUCKET || 'postolio-ai-images'
const CLOUDFRONT_DISTRIBUTION_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID || ''
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN || ''

export interface ImageMetadata {
  contentId: string
  brandId: string
  campaignId?: string | undefined
  generatedAt: Date
  source: 'dalle3' | 'midjourney'
  originalPrompt: string
  userRegion?: string
}

export interface S3UploadResult {
  s3Key: string
  cdnUrl: string
  region: string
  retentionExpiresAt: Date
}

// Regional retention policies (in days)
const REGIONAL_RETENTION_POLICIES: Record<string, number> = {
  EU: 1095,    // 3 years for GDPR
  US: 2555,    // 7 years for CCPA
  UK: 2190,    // 6 years for UK GDPR
  DEFAULT: 365 // 1 year default
}

// Helper function to get retention days safely
function getRetentionDays(region: string): number {
  const days = REGIONAL_RETENTION_POLICIES[region]
  if (days !== undefined) {
    return days
  }
  // Fallback to default value
  const defaultDays = REGIONAL_RETENTION_POLICIES['DEFAULT']
  return defaultDays !== undefined ? defaultDays : 365
}

/**
 * Determine user region based on brand or user location
 */
async function getUserRegion(_brandId: string): Promise<string> {
  // TODO: Implement actual region detection based on user/brand data
  // For now, default to US
  return 'US'
}

/**
 * Generate S3 key for image storage
 */
function generateS3Key(metadata: ImageMetadata, extension: string = 'jpg'): string {
  const timestamp = Date.now()
  const hash = createHash('md5').update(`${metadata.contentId}-${timestamp}`).digest('hex').substring(0, 8)
  const dateFolder = new Date().toISOString().split('T')[0] // YYYY-MM-DD
  
  return `images/${dateFolder}/${metadata.brandId}/${metadata.contentId}-${hash}.${extension}`
}

/**
 * Download image from external URL with security validations
 */
async function downloadImage(url: string): Promise<Buffer> {
  // Validate URL format
  try {
    const urlObj = new URL(url)
    // Only allow HTTPS and HTTP protocols
    if (!['https:', 'http:'].includes(urlObj.protocol)) {
      throw new Error(`Unsupported protocol: ${urlObj.protocol}`)
    }
    // Prevent SSRF by blocking private IP ranges
    const hostname = urlObj.hostname
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('10.') || 
        hostname.startsWith('192.168.') || hostname.startsWith('172.')) {
      throw new Error('Cannot download from private/local addresses')
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Invalid URL: ${error.message}`)
    }
    throw new Error('Invalid URL provided')
  }
  
  // Add timeout and size limits
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Postolio-ImageDownloader/1.0'
      }
    })
    
    clearTimeout(timeoutId)
    
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`)
    }
    
    // Check content type
    const contentType = response.headers.get('content-type')
    if (!contentType || !contentType.startsWith('image/')) {
      throw new Error(`Invalid content type: ${contentType}`)
    }
    
    // Check content length (max 50MB)
    const contentLength = response.headers.get('content-length')
    if (contentLength && parseInt(contentLength, 10) > 50 * 1024 * 1024) {
      throw new Error('Image file too large (max 50MB)')
    }
    
    const arrayBuffer = await response.arrayBuffer()
    
    // Double check size after download
    if (arrayBuffer.byteLength > 50 * 1024 * 1024) {
      throw new Error('Downloaded image exceeds size limit')
    }
    
    return Buffer.from(arrayBuffer)
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error('Image download timed out')
      }
      throw error
    }
    throw new Error('Unknown error during image download')
  }
}

/**
 * Optimize image for web delivery
 */
async function optimizeImage(buffer: Buffer): Promise<Buffer> {
  try {
    // Get image metadata first
    const image = sharp(buffer)
    const metadata = await image.metadata()
    
    // Instagram optimal size is 1080x1080
    // Use 'contain' to fit the entire image within the square, adding white padding if needed
    const processedImage = image
      .resize(1080, 1080, {
        fit: 'contain',  // Changed from 'cover' to 'contain' to show full image
        position: 'center',
        background: { r: 255, g: 255, b: 255, alpha: 1 } // White background for padding
      })
    
    // Only flatten if the image has an alpha channel (transparency)
    if (metadata.channels === 4 || metadata.hasAlpha) {
      processedImage.flatten({ background: { r: 255, g: 255, b: 255 } })
    }
    
    return processedImage
      .jpeg({ quality: 85, progressive: true })
      .toBuffer()
  } catch (error) {
    console.error('Error optimizing image:', error)
    // If optimization fails, return the original buffer
    return buffer
  }
}

/**
 * Upload image to S3 with metadata and tagging
 */
export async function uploadImageToS3(
  imageUrl: string,
  metadata: ImageMetadata
): Promise<S3UploadResult> {
  // Input validation
  if (!imageUrl || typeof imageUrl !== 'string') {
    throw new Error('Invalid image URL provided')
  }
  
  if (!metadata.contentId || typeof metadata.contentId !== 'string') {
    throw new Error('Invalid content ID in metadata')
  }
  
  if (!metadata.brandId || typeof metadata.brandId !== 'string') {
    throw new Error('Invalid brand ID in metadata')
  }
  
  if (!BUCKET_NAME) {
    throw new Error('S3_IMAGES_BUCKET environment variable not configured')
  }
  
  try {
    // Download image from external URL
    console.log(`Downloading image from ${imageUrl.substring(0, 50)}...`)
    const imageBuffer = await downloadImage(imageUrl)
    
    // Optimize image
    console.log('Optimizing image for web delivery...')
    const optimizedBuffer = await optimizeImage(imageBuffer)
    
    // Determine user region for compliance
    const userRegion = await getUserRegion(metadata.brandId)
    const retentionDays = getRetentionDays(userRegion)
    const retentionExpiresAt = new Date()
    retentionExpiresAt.setDate(retentionExpiresAt.getDate() + retentionDays)
    
    // Generate S3 key
    const jpegKey = generateS3Key(metadata, 'jpg')
    
    // Prepare S3 metadata
    const s3Metadata = {
      contentId: metadata.contentId,
      brandId: metadata.brandId,
      campaignId: metadata.campaignId || '',
      source: metadata.source,
      generatedAt: metadata.generatedAt.toISOString(),
      region: userRegion,
      retentionDays: retentionDays.toString(),
      retentionExpiresAt: retentionExpiresAt.toISOString()
    }
    
    // Prepare tags for cost allocation
    const tags = `Brand=${metadata.brandId}&Campaign=${metadata.campaignId || 'none'}&Source=${metadata.source}&Region=${userRegion}`
    
    // Upload JPEG version
    const jpegCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: jpegKey,
      Body: optimizedBuffer,
      ContentType: 'image/jpeg',
      Metadata: s3Metadata,
      StorageClass: 'INTELLIGENT_TIERING',
      ServerSideEncryption: 'AES256', // Using SSE-S3 for dev, SSE-KMS for prod
      Tagging: tags,
      CacheControl: 'public, max-age=31536000, immutable' // 1 year cache
    })
    
    await s3Client.send(jpegCommand)
    console.log(`Uploaded image to S3: ${jpegKey}`)
    
    // Generate CloudFront URL
    const cdnUrl = CLOUDFRONT_DOMAIN 
      ? `https://${CLOUDFRONT_DOMAIN}/${jpegKey}`
      : `https://${BUCKET_NAME}.s3.amazonaws.com/${jpegKey}`
    
    return {
      s3Key: jpegKey,
      cdnUrl,
      region: userRegion,
      retentionExpiresAt
    }
  } catch (error) {
    console.error('Failed to upload image to S3:', error)
    throw new Error(`S3 upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Delete image from S3 and invalidate CloudFront cache
 */
export async function deleteImageFromS3(s3Key: string): Promise<void> {
  try {
    // Delete image from S3
    const deleteCommand = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key
    })
    await s3Client.send(deleteCommand)
    
    // Invalidate CloudFront cache if configured
    if (CLOUDFRONT_DISTRIBUTION_ID) {
      const invalidationCommand = new CreateInvalidationCommand({
        DistributionId: CLOUDFRONT_DISTRIBUTION_ID,
        InvalidationBatch: {
          CallerReference: `delete-${Date.now()}`,
          Paths: {
            Quantity: 1,
            Items: [`/${s3Key}`]
          }
        }
      })
      
      await cloudfrontClient.send(invalidationCommand)
      console.log(`Invalidated CloudFront cache for ${s3Key}`)
    }
    
    console.log(`Deleted image from S3: ${s3Key}`)
  } catch (error) {
    console.error('Failed to delete image from S3:', error)
    throw new Error(`S3 deletion failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Upload image buffer directly to S3 (for user uploads)
 */
export async function uploadImageBufferToS3(
  buffer: Buffer,
  metadata: ImageMetadata
): Promise<S3UploadResult> {
  // Input validation
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('Invalid buffer provided')
  }
  
  if (!metadata.contentId || typeof metadata.contentId !== 'string') {
    throw new Error('Invalid content ID in metadata')
  }
  
  if (!metadata.brandId || typeof metadata.brandId !== 'string') {
    throw new Error('Invalid brand ID in metadata')
  }
  
  if (!BUCKET_NAME) {
    throw new Error('S3_IMAGES_BUCKET environment variable not configured')
  }
  
  try {
    // Optimize image
    console.log('Optimizing image for web delivery...')
    const optimizedBuffer = await optimizeImage(buffer)
    
    // Determine user region for compliance
    const userRegion = await getUserRegion(metadata.brandId)
    const retentionDays = getRetentionDays(userRegion)
    const retentionExpiresAt = new Date()
    retentionExpiresAt.setDate(retentionExpiresAt.getDate() + retentionDays)
    
    // Generate S3 key
    const jpegKey = generateS3Key(metadata, 'jpg')
    
    // Prepare S3 metadata
    const s3Metadata = {
      contentId: metadata.contentId,
      brandId: metadata.brandId,
      campaignId: metadata.campaignId || '',
      source: metadata.source,
      generatedAt: metadata.generatedAt.toISOString(),
      region: userRegion,
      retentionDays: retentionDays.toString(),
      retentionExpiresAt: retentionExpiresAt.toISOString()
    }
    
    // Prepare tags for cost allocation
    const tags = `Brand=${metadata.brandId}&Campaign=${metadata.campaignId || 'none'}&Source=${metadata.source}&Region=${userRegion}`
    
    // Upload JPEG version
    const jpegCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: jpegKey,
      Body: optimizedBuffer,
      ContentType: 'image/jpeg',
      Metadata: s3Metadata,
      StorageClass: 'INTELLIGENT_TIERING',
      ServerSideEncryption: 'AES256',
      Tagging: tags,
      CacheControl: 'public, max-age=31536000, immutable'
    })
    
    await s3Client.send(jpegCommand)
    console.log(`Uploaded image to S3: ${jpegKey}`)
    
    // Generate CloudFront URL
    const cdnUrl = CLOUDFRONT_DOMAIN 
      ? `https://${CLOUDFRONT_DOMAIN}/${jpegKey}`
      : `https://${BUCKET_NAME}.s3.amazonaws.com/${jpegKey}`
    
    return {
      s3Key: jpegKey,
      cdnUrl,
      region: userRegion,
      retentionExpiresAt
    }
  } catch (error) {
    console.error('Failed to upload image buffer to S3:', error)
    throw new Error(`S3 upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Generate presigned URL for temporary access
 */
export async function generatePresignedUrl(s3Key: string, expiresIn: number = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key
  })
  
  return getSignedUrl(s3Client, command, { expiresIn })
}

/**
 * Migrate existing external image URL to S3
 */
export async function migrateImageToS3(
  externalUrl: string,
  contentId: string,
  brandId: string,
  campaignId?: string
): Promise<S3UploadResult> {
  const metadata: ImageMetadata = {
    contentId,
    brandId,
    campaignId: campaignId as string | undefined,
    generatedAt: new Date(),
    source: externalUrl.includes('dalle') ? 'dalle3' : 'midjourney',
    originalPrompt: 'Migrated from external URL'
  }
  
  return uploadImageToS3(externalUrl, metadata)
}

/**
 * Check if image retention has expired and should be deleted
 */
export async function checkRetentionExpiry(retentionExpiresAt: Date): Promise<boolean> {
  return new Date() > retentionExpiresAt
}

/**
 * Batch delete expired images
 */
export async function deleteExpiredImages(s3Keys: string[]): Promise<void> {
  const deletePromises = s3Keys.map(key => deleteImageFromS3(key))
  await Promise.all(deletePromises)
  console.log(`Deleted ${s3Keys.length} expired images`)
}