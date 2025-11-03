/**
 * Image Validation Service
 * Handles validation of image data, format, size, and mime types
 */

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
  data?: {
    buffer: Buffer;
    mimeType: string;
    size: number;
  };
}

export interface Base64ParseResult {
  valid: boolean;
  error?: string;
  mimeType?: string;
  base64Data?: string;
}

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Parse and validate base64 image data format
 *
 * @param imageData - Base64 encoded image string (with or without data URI prefix)
 * @returns Parse result with mime type and cleaned base64 data
 *
 * @example
 * parseBase64ImageData('data:image/jpeg;base64,/9j/4AAQ...')
 * // Returns: { valid: true, mimeType: 'image/jpeg', base64Data: '/9j/4AAQ...' }
 */
export function parseBase64ImageData(imageData: string): Base64ParseResult {
  // Extract base64 data and mime type from data URI
  const base64Match = imageData.match(/^data:([^;]+);base64,(.+)$/);

  if (!base64Match || !base64Match[2]) {
    return {
      valid: false,
      error: 'Invalid image data format. Expected data URI format (data:image/type;base64,...)',
    };
  }

  const mimeType = base64Match[1];
  const base64Data = base64Match[2];

  return {
    valid: true,
    mimeType,
    base64Data,
  };
}

/**
 * Validate mime type against allowed types
 *
 * @param mimeType - MIME type to validate (e.g., 'image/jpeg')
 * @returns Validation result
 *
 * @example
 * validateMimeType('image/jpeg') // Returns: { valid: true }
 * validateMimeType('image/gif')  // Returns: { valid: false, error: '...' }
 */
export function validateMimeType(mimeType: string): { valid: boolean; error?: string } {
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return {
      valid: false,
      error: `Invalid image type. Supported types: ${ALLOWED_MIME_TYPES.join(', ')}`,
    };
  }

  return { valid: true };
}

/**
 * Estimate image size from base64 string length
 * Base64 encoding uses 4 characters for every 3 bytes of binary data (4/3 ratio)
 * Accounts for padding characters ('=') at the end of base64 strings
 *
 * @param base64Data - Base64 encoded string (without data URI prefix)
 * @returns Estimated size in bytes
 */
export function estimateImageSize(base64Data: string): number {
  // Subtract padding characters ('=') at the end before estimating size
  const paddingLength = base64Data.match(/=+$/)?.[0].length || 0;
  return ((base64Data.length - paddingLength) * 3) / 4;
}

/**
 * Validate image size against maximum allowed size
 *
 * @param sizeInBytes - Image size in bytes
 * @param maxSize - Optional maximum size (defaults to 10MB)
 * @returns Validation result
 */
export function validateImageSize(
  sizeInBytes: number,
  maxSize: number = MAX_IMAGE_SIZE
): { valid: boolean; error?: string } {
  if (sizeInBytes > maxSize) {
    const sizeMB = (sizeInBytes / (1024 * 1024)).toFixed(2);
    const maxMB = (maxSize / (1024 * 1024)).toFixed(0);
    return {
      valid: false,
      error: `Image size exceeds ${maxMB}MB limit. Actual size: ${sizeMB}MB`,
    };
  }

  return { valid: true };
}

/**
 * Validate and convert base64 image data to buffer
 * Performs comprehensive validation: format, mime type, and size
 *
 * @param imageData - Base64 encoded image string
 * @param mimeType - Optional MIME type (if not in data URI)
 * @returns Validation result with buffer if valid
 *
 * @example
 * const result = validateAndConvertImage('data:image/jpeg;base64,/9j/4AAQ...')
 * if (result.valid) {
 *   console.log('Buffer size:', result.data.buffer.length)
 * }
 */
export function validateAndConvertImage(
  imageData: string,
  mimeType?: string
): ImageValidationResult {
  // Parse base64 data
  const parseResult = parseBase64ImageData(imageData);
  if (!parseResult.valid) {
    return { valid: false, error: parseResult.error };
  }

  // Use provided mime type or extracted one
  const finalMimeType = mimeType || parseResult.mimeType!;

  // Validate mime type
  const mimeValidation = validateMimeType(finalMimeType);
  if (!mimeValidation.valid) {
    return { valid: false, error: mimeValidation.error };
  }

  // Estimate size before creating buffer (performance optimization)
  const estimatedSize = estimateImageSize(parseResult.base64Data!);
  const sizeValidation = validateImageSize(estimatedSize);
  if (!sizeValidation.valid) {
    return { valid: false, error: sizeValidation.error };
  }

  // Create buffer
  let buffer: Buffer;
  try {
    buffer = Buffer.from(parseResult.base64Data!, 'base64');
  } catch {
    return {
      valid: false,
      error: 'Failed to decode base64 data',
    };
  }

  // Double-check actual buffer size
  const actualSizeValidation = validateImageSize(buffer.length);
  if (!actualSizeValidation.valid) {
    return { valid: false, error: actualSizeValidation.error };
  }

  return {
    valid: true,
    data: {
      buffer,
      mimeType: finalMimeType,
      size: buffer.length,
    },
  };
}

/**
 * Get allowed MIME types
 * @returns Array of allowed MIME types
 */
export function getAllowedMimeTypes(): readonly string[] {
  return ALLOWED_MIME_TYPES;
}

/**
 * Get maximum allowed image size in bytes
 * @returns Maximum size in bytes
 */
export function getMaxImageSize(): number {
  return MAX_IMAGE_SIZE;
}
