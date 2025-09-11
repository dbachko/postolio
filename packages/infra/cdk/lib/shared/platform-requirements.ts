/**
 * Shared platform requirements for video processing
 * This file contains all platform-specific requirements used across Lambda functions
 */

export interface PlatformRequirements {
  upload: {
    formats: string[];
    maxSize: number;
    maxDuration: number;
  };
  validation: {
    maxDuration: number;
    minDuration: number;
    maxFileSize: number;
    supportedCodecs: string[];
    supportedContainers: string[];
    minResolution: { width: number; height: number };
    maxResolution: { width: number; height: number };
    aspectRatios: string[];
    minFrameRate: number;
    maxFrameRate: number;
    audioBitrate: { min: number; max: number };
    videoBitrate: { min: number; max: number };
  };
  encoding: {
    resolution: { width: number; height: number };
    maxBitrate: number;
    audioSettings: {
      codec: string;
      bitrate: number;
      sampleRate: number;
    };
  };
}

export const PLATFORM_REQUIREMENTS: Record<string, PlatformRequirements> = {
  instagram: {
    upload: {
      formats: ['mp4', 'mov'],
      maxSize: 1024 * 1024 * 1024, // 1GB
      maxDuration: 90, // seconds for Reels
    },
    validation: {
      maxDuration: 90,
      minDuration: 3,
      maxFileSize: 1024 * 1024 * 1024, // 1GB
      supportedCodecs: ['h264', 'hevc'],
      supportedContainers: ['mp4', 'mov'],
      minResolution: { width: 540, height: 960 },
      maxResolution: { width: 1920, height: 1920 },
      aspectRatios: ['9:16', '4:5', '1:1'],
      minFrameRate: 23,
      maxFrameRate: 60,
      audioBitrate: { min: 64000, max: 320000 },
      videoBitrate: { min: 500000, max: 10000000 },
    },
    encoding: {
      resolution: { width: 1080, height: 1920 },
      maxBitrate: 5000000,
      audioSettings: {
        codec: 'AAC',
        bitrate: 128000,
        sampleRate: 48000,
      },
    },
  },
  tiktok: {
    upload: {
      formats: ['mp4', 'mov', 'mpeg', 'avi'],
      maxSize: 4 * 1024 * 1024 * 1024, // 4GB
      maxDuration: 600, // 10 minutes
    },
    validation: {
      maxDuration: 600,
      minDuration: 1,
      maxFileSize: 4 * 1024 * 1024 * 1024, // 4GB
      supportedCodecs: ['h264', 'hevc'],
      supportedContainers: ['mp4', 'mov', 'mpeg', 'avi'],
      minResolution: { width: 540, height: 960 },
      maxResolution: { width: 1920, height: 1920 },
      aspectRatios: ['9:16', '16:9', '1:1'],
      minFrameRate: 23,
      maxFrameRate: 60,
      audioBitrate: { min: 96000, max: 320000 },
      videoBitrate: { min: 516000, max: 20000000 },
    },
    encoding: {
      resolution: { width: 1080, height: 1920 },
      maxBitrate: 8000000,
      audioSettings: {
        codec: 'AAC',
        bitrate: 192000,
        sampleRate: 48000,
      },
    },
  },
  youtube: {
    upload: {
      formats: ['mp4', 'mov', 'avi', 'wmv', 'flv', 'mkv'],
      maxSize: 256 * 1024 * 1024, // 256MB for Shorts
      maxDuration: 60, // 60 seconds for Shorts
    },
    validation: {
      maxDuration: 60,
      minDuration: 1,
      maxFileSize: 256 * 1024 * 1024, // 256MB for Shorts
      supportedCodecs: ['h264', 'hevc', 'vp9'],
      supportedContainers: ['mp4', 'mov', 'avi', 'wmv', 'flv', 'mkv', 'webm'],
      minResolution: { width: 256, height: 144 },
      maxResolution: { width: 3840, height: 2160 },
      aspectRatios: ['9:16'], // Shorts must be vertical
      minFrameRate: 24,
      maxFrameRate: 60,
      audioBitrate: { min: 128000, max: 512000 },
      videoBitrate: { min: 1000000, max: 50000000 },
    },
    encoding: {
      resolution: { width: 1080, height: 1920 },
      maxBitrate: 10000000,
      audioSettings: {
        codec: 'AAC',
        bitrate: 256000,
        sampleRate: 48000,
      },
    },
  },
  facebook: {
    upload: {
      formats: ['mp4', 'mov'],
      maxSize: 4 * 1024 * 1024 * 1024, // 4GB
      maxDuration: 240, // 4 minutes for feed
    },
    validation: {
      maxDuration: 240,
      minDuration: 1,
      maxFileSize: 4 * 1024 * 1024 * 1024, // 4GB
      supportedCodecs: ['h264', 'hevc'],
      supportedContainers: ['mp4', 'mov'],
      minResolution: { width: 120, height: 120 },
      maxResolution: { width: 1920, height: 1080 },
      aspectRatios: ['16:9', '1:1', '4:5', '9:16', '2:3'],
      minFrameRate: 23,
      maxFrameRate: 60,
      audioBitrate: { min: 128000, max: 256000 },
      videoBitrate: { min: 1000000, max: 20000000 },
    },
    encoding: {
      resolution: { width: 1920, height: 1080 },
      maxBitrate: 8000000,
      audioSettings: {
        codec: 'AAC',
        bitrate: 192000,
        sampleRate: 48000,
      },
    },
  },
  linkedin: {
    upload: {
      formats: ['mp4', 'mov', 'avi'],
      maxSize: 5 * 1024 * 1024 * 1024, // 5GB
      maxDuration: 600, // 10 minutes
    },
    validation: {
      maxDuration: 600,
      minDuration: 3,
      maxFileSize: 5 * 1024 * 1024 * 1024, // 5GB
      supportedCodecs: ['h264'],
      supportedContainers: ['mp4', 'mov', 'avi'],
      minResolution: { width: 256, height: 144 },
      maxResolution: { width: 4096, height: 2304 },
      aspectRatios: ['16:9', '1:1', '4:5', '1.91:1'],
      minFrameRate: 10,
      maxFrameRate: 60,
      audioBitrate: { min: 64000, max: 512000 },
      videoBitrate: { min: 75000, max: 30000000 },
    },
    encoding: {
      resolution: { width: 1920, height: 1080 },
      maxBitrate: 10000000,
      audioSettings: {
        codec: 'AAC',
        bitrate: 256000,
        sampleRate: 48000,
      },
    },
  },
};

// Helper function to get platform key from various formats
export function normalizePlatformKey(platform: string): string {
  const normalized = platform.toLowerCase().replace(/_/g, '');

  // Map variations to standard keys
  const mappings: Record<string, string> = {
    instagramreels: 'instagram',
    instagram_reels: 'instagram',
    youtubeshorts: 'youtube',
    youtube_shorts: 'youtube',
  };

  return mappings[normalized] || normalized;
}

// Valid MIME types for video uploads
export const VALID_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-ms-wmv',
  'video/x-flv',
  'video/x-matroska',
  'video/mpeg',
  'video/webm',
];

// Maximum file size across all platforms (5GB)
export const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;

// Minimum part size for S3 multipart upload (5MB)
export const MIN_PART_SIZE = 5 * 1024 * 1024;

// Maximum number of parts for multipart upload
export const MAX_UPLOAD_PARTS = 10000;

// Presigned URL expiry time (1 hour)
export const PRESIGNED_URL_EXPIRY = 3600;
