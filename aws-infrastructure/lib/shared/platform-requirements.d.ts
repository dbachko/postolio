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
        minResolution: {
            width: number;
            height: number;
        };
        maxResolution: {
            width: number;
            height: number;
        };
        aspectRatios: string[];
        minFrameRate: number;
        maxFrameRate: number;
        audioBitrate: {
            min: number;
            max: number;
        };
        videoBitrate: {
            min: number;
            max: number;
        };
    };
    encoding: {
        resolution: {
            width: number;
            height: number;
        };
        maxBitrate: number;
        audioSettings: {
            codec: string;
            bitrate: number;
            sampleRate: number;
        };
    };
}
export declare const PLATFORM_REQUIREMENTS: Record<string, PlatformRequirements>;
export declare function normalizePlatformKey(platform: string): string;
export declare const VALID_VIDEO_MIME_TYPES: string[];
export declare const MAX_FILE_SIZE: number;
export declare const MIN_PART_SIZE: number;
export declare const MAX_UPLOAD_PARTS = 10000;
export declare const PRESIGNED_URL_EXPIRY = 3600;
