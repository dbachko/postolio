/**
 * Convert a File object to base64 data URL
 * @param file The file to convert
 * @returns Promise resolving to base64 data URL
 */
export function convertFileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('Failed to convert file to base64'));
      }
    };
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Estimate the size of a base64-encoded string
 * Base64 encoding increases size by approximately 33%
 * @param base64String The base64 string
 * @returns Estimated size in bytes
 */
export function estimateBase64Size(base64String: string): number {
  // Remove data URL prefix if present
  const base64Data = base64String.includes(',') ? base64String.split(',')[1] : base64String;

  // Base64 uses 4 characters to encode 3 bytes
  return Math.ceil((base64Data.length * 3) / 4);
}

/**
 * Validate image file type and size
 * @param file The file to validate
 * @param maxSizeMB Maximum file size in megabytes
 * @returns Error message if invalid, undefined if valid
 */
export function validateImageFile(file: File, maxSizeMB: number = 10): string | undefined {
  const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

  if (!validTypes.includes(file.type)) {
    return 'Please upload a valid image file (JPEG, PNG, GIF, or WebP)';
  }

  const maxSize = maxSizeMB * 1024 * 1024;
  if (file.size > maxSize) {
    return `Image size must be less than ${maxSizeMB}MB`;
  }

  return undefined;
}
