import { z, type ZodIssue } from 'zod';

export type Platform = 'instagram' | 'facebook' | 'twitter' | 'linkedin' | 'youtube';

// Logical content kind (how the platform will treat the post)
export type ContentType = 'post' | 'reel' | 'story';

// Pure media format (what kind of asset is attached)
// Reels are modeled as contentType === 'reel' + mediaType === 'video'
export type MediaType = 'image' | 'video';

// Platform-specific aliases (useful for frontends/backends that target a single platform)
export type InstagramContentType = Extract<ContentType, 'post' | 'reel' | 'story'>;
export type InstagramMediaType = Extract<MediaType, 'image' | 'video'>;

export interface ValidateContentPayload<
  P extends Platform = Platform,
  CT extends ContentType | null | undefined = ContentType | null | undefined,
  MT extends MediaType | null | undefined = MediaType | null | undefined,
> {
  platform: P;
  contentType?: CT;
  mediaType?: MT;
  caption?: string | null;
  videoUrl?: string | null;
  mediaAssets?: Array<
    | {
        key?: string | null;
        type?: MediaType | null | undefined;
      }
    | null
    | undefined
  > | null; // Structured media assets (preferred)
}

export interface ValidationErrorItem {
  field: string;
  message: string;
  code: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationErrorItem[];
}

const optionalCaption = z
  .string()
  .max(2200, { message: 'Caption exceeds Instagram limit of 2200 characters' })
  .optional()
  .nullable();

const optionalMediaAssets = z
  .array(
    z
      .object({
        key: z.string().optional().nullable(),
        type: z.enum(['image', 'video']).optional().nullable(),
      })
      .optional()
      .nullable()
  )
  .optional()
  .nullable();

type MediaAssetInput =
  | {
      key?: string | null;
      type?: MediaType | null | undefined;
    }
  | null
  | undefined;

function getMediaCounts(
  mediaAssets: MediaAssetInput[] | null | undefined,
  mediaTypeHint?: string | null | undefined
): { total: number; images: number; videos: number } {
  const assets = Array.isArray(mediaAssets)
    ? (mediaAssets.filter((a) => a && typeof a === 'object') as { type?: string | null }[])
    : [];

  if (assets.length > 0) {
    const typeHint = (mediaTypeHint || '').toLowerCase();
    const explicitImages = assets.filter((a) => (a.type || '').toLowerCase() === 'image').length;
    const explicitVideos = assets.filter((a) => (a.type || '').toLowerCase() === 'video').length;
    const inferredVideos = explicitVideos || (typeHint === 'video' ? assets.length : 0);
    const inferredImages =
      explicitImages ||
      (typeHint === 'image' ? assets.length : Math.max(assets.length - inferredVideos, 0));
    return {
      total: assets.length,
      images: inferredImages,
      videos: inferredVideos,
    };
  }

  return { total: 0, images: 0, videos: 0 };
}

const instagramBase = z.object({
  platform: z.literal('instagram'),
  contentType: z.enum(['post', 'reel', 'story']).optional().nullable(),
  mediaType: z.enum(['image', 'video']).optional().nullable(),
  caption: optionalCaption,
  mediaAssets: optionalMediaAssets,
  videoUrl: z.string().url().optional().nullable(),
});

function validateInstagram(payload: ValidateContentPayload): ValidationResult {
  const parsed = instagramBase.safeParse(payload);
  if (!parsed.success) {
    const errors: ValidationErrorItem[] = parsed.error.issues.map((issue: ZodIssue) => ({
      field: issue.path.join('.') || 'root',
      message: issue.message,
      code: 'INVALID_FIELD',
    }));
    return { ok: false, errors };
  }

  const data = parsed.data;
  const errors: ValidationErrorItem[] = [];
  const contentType = data.contentType || 'post';
  const mediaType = data.mediaType || 'image';
  const isReel = contentType === 'reel';
  const isImageLike = mediaType === 'image' && !isReel;
  const isVideoLike = mediaType === 'video' || isReel;
  const counts = getMediaCounts(data.mediaAssets, mediaType);

  // Media requirements
  if (isImageLike) {
    if (counts.images < 1) {
      errors.push({
        field: 'mediaAssets',
        message: 'Media content requires at least one media asset',
        code: 'MEDIA_REQUIRED',
      });
    }
    if (counts.images > 10) {
      errors.push({
        field: 'mediaAssets',
        message: 'Media content allows up to 10 media items',
        code: 'MEDIA_LIMIT',
      });
    }
  }

  if (isVideoLike && !data.videoUrl && counts.videos < 1) {
    errors.push({
      field: 'videoUrl',
      message: 'Video/Reel requires a video asset',
      code: 'MEDIA_REQUIRED',
    });
  }

  // Caption requirements: Instagram stories do NOT require captions; posts/reels allow empty captions.
  if ((contentType === 'post' || contentType === 'reel') && typeof data.caption === 'string') {
    const trimmed = data.caption.trim();
    if (trimmed.length === 0) {
      // Allow empty but normalize downstream; no error.
    }
  }

  if (contentType === 'story') {
    // Story captions optional; no hashtag requirement.
  }

  return { ok: errors.length === 0, errors };
}

// Facebook (Meta feed): allow long captions (~63k), require text or media.
const facebookBase = z.object({
  platform: z.literal('facebook'),
  contentType: z.enum(['post']).optional().nullable(),
  mediaType: z.enum(['image', 'video']).optional().nullable(),
  caption: z
    .string()
    .max(63206, { message: 'Caption exceeds Facebook limit (~63k characters)' })
    .optional()
    .nullable(),
  mediaAssets: optionalMediaAssets,
  videoUrl: z.string().url().optional().nullable(),
});

function validateFacebook(payload: ValidateContentPayload): ValidationResult {
  const parsed = facebookBase.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue: ZodIssue) => ({
        field: issue.path.join('.') || 'root',
        message: issue.message,
        code: 'INVALID_FIELD',
      })),
    };
  }

  const data = parsed.data;
  const errors: ValidationErrorItem[] = [];
  const mediaTypeHint = typeof data.mediaType === 'string' ? data.mediaType : undefined;
  const counts = getMediaCounts(data.mediaAssets, mediaTypeHint);
  const hasText = !!(data.caption && data.caption.trim().length > 0);

  const explicitMediaType = typeof data.mediaType === 'string' ? data.mediaType.toLowerCase() : '';
  const effectiveMediaType: 'image' | 'video' | 'mixed' | null = (() => {
    if (explicitMediaType === 'image' || explicitMediaType === 'video') return explicitMediaType;
    if (data.videoUrl) return 'video';
    if (counts.videos > 0 && counts.images === 0) return 'video';
    if (counts.images > 0 && counts.videos === 0) return 'image';
    if (counts.images > 0 && counts.videos > 0) return 'mixed';
    return null;
  })();

  if (effectiveMediaType === 'mixed') {
    errors.push({
      field: 'mediaAssets',
      message: 'Facebook posts cannot mix images and videos in the same post',
      code: 'MEDIA_MIXED',
    });
  }

  if (effectiveMediaType === 'image' && counts.images < 1) {
    errors.push({
      field: 'mediaAssets',
      message: 'A photo/album post needs at least one image',
      code: 'MEDIA_REQUIRED',
    });
  }

  // For Facebook, treat multiple images as an album implicitly; require at least 1 image.
  if (effectiveMediaType === 'video' && !data.videoUrl && counts.videos < 1) {
    errors.push({
      field: 'videoUrl',
      message: 'Video post requires a video asset',
      code: 'MEDIA_REQUIRED',
    });
  }

  if (!effectiveMediaType && !hasText) {
    errors.push({
      field: 'caption',
      message: 'Provide text or media for a Facebook post',
      code: 'CONTENT_REQUIRED',
    });
  }

  return { ok: errors.length === 0, errors };
}

// Twitter/X: text required, 280 chars max, media optional but video requires asset.
const twitterBase = z.object({
  platform: z.literal('twitter'),
  contentType: z.enum(['post']).optional().nullable(),
  mediaType: z.enum(['image', 'video']).optional().nullable(),
  caption: z
    .string()
    .min(1, { message: 'Tweet text is required' })
    .max(280, { message: 'Tweet exceeds 280 characters' }),
  mediaAssets: optionalMediaAssets,
  videoUrl: z.string().url().optional().nullable(),
});

function validateTwitter(payload: ValidateContentPayload): ValidationResult {
  const parsed = twitterBase.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue: ZodIssue) => ({
        field: issue.path.join('.') || 'root',
        message: issue.message,
        code: 'INVALID_FIELD',
      })),
    };
  }
  const data = parsed.data;
  const errors: ValidationErrorItem[] = [];
  const mediaType = data.mediaType || 'image';
  const counts = getMediaCounts(data.mediaAssets, mediaType);

  if (mediaType === 'video' && !data.videoUrl && counts.videos < 1) {
    errors.push({
      field: 'videoUrl',
      message: 'Tweet with video must include a video asset',
      code: 'MEDIA_REQUIRED',
    });
  }

  return { ok: errors.length === 0, errors };
}

// LinkedIn: text up to ~3000 chars; require text or media.
const linkedinBase = z.object({
  platform: z.literal('linkedin'),
  contentType: z.enum(['post']).optional().nullable(),
  mediaType: z.enum(['image', 'video']).optional().nullable(),
  caption: z
    .string()
    .max(3000, { message: 'Caption exceeds LinkedIn limit (~3000 characters)' })
    .optional()
    .nullable(),
  mediaAssets: optionalMediaAssets,
  videoUrl: z.string().url().optional().nullable(),
});

function validateLinkedIn(payload: ValidateContentPayload): ValidationResult {
  const parsed = linkedinBase.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue: ZodIssue) => ({
        field: issue.path.join('.') || 'root',
        message: issue.message,
        code: 'INVALID_FIELD',
      })),
    };
  }
  const data = parsed.data;
  const errors: ValidationErrorItem[] = [];
  const hasText = !!(data.caption && data.caption.trim().length > 0);
  const counts = getMediaCounts(data.mediaAssets, data.mediaType);

  if (!hasText && counts.total === 0 && !data.videoUrl) {
    errors.push({
      field: 'caption',
      message: 'Provide text or media for a LinkedIn post',
      code: 'CONTENT_REQUIRED',
    });
  }
  if ((data.mediaType || 'image') === 'video' && !data.videoUrl && counts.videos < 1) {
    errors.push({
      field: 'videoUrl',
      message: 'Video post requires a video asset',
      code: 'MEDIA_REQUIRED',
    });
  }

  return { ok: errors.length === 0, errors };
}

// YouTube placeholder: require video asset
const youtubeBase = z.object({
  platform: z.literal('youtube'),
  contentType: z.enum(['post']).optional().nullable(),
  mediaType: z.enum(['video']).optional().nullable(),
  caption: z.string().optional().nullable(),
  mediaAssets: optionalMediaAssets,
  videoUrl: z.string().url().optional().nullable(),
});

function validateYouTube(payload: ValidateContentPayload): ValidationResult {
  const parsed = youtubeBase.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue: ZodIssue) => ({
        field: issue.path.join('.') || 'root',
        message: issue.message,
        code: 'INVALID_FIELD',
      })),
    };
  }
  const data = parsed.data;
  const errors: ValidationErrorItem[] = [];
  const counts = getMediaCounts(data.mediaAssets, data.mediaType);
  if (!data.videoUrl && counts.total === 0) {
    errors.push({
      field: 'videoUrl',
      message: 'YouTube upload requires a video asset',
      code: 'MEDIA_REQUIRED',
    });
  }
  return { ok: errors.length === 0, errors };
}

const validators: Record<Platform, (payload: ValidateContentPayload) => ValidationResult> = {
  instagram: validateInstagram,
  facebook: validateFacebook,
  twitter: validateTwitter,
  linkedin: validateLinkedIn,
  youtube: validateYouTube,
};

export function validateContentPayload<
  P extends Platform = Platform,
  CT extends ContentType | null | undefined = ContentType | null | undefined,
  MT extends MediaType | null | undefined = MediaType | null | undefined,
>(payload: ValidateContentPayload<P, CT, MT>): ValidationResult {
  const validator = validators[payload.platform];
  if (!validator) {
    return {
      ok: false,
      errors: [
        {
          field: 'platform',
          message: `Unsupported platform: ${payload.platform}`,
          code: 'UNSUPPORTED_PLATFORM',
        },
      ],
    };
  }

  return validator(payload);
}

export const schemas = {
  instagramBase,
};
