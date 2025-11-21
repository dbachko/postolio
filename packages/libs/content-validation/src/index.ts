import { z } from 'zod';

export type Platform = 'instagram' | 'facebook' | 'twitter' | 'linkedin' | 'youtube';
export type ContentType = 'post' | 'reel' | 'story';
export type MediaType = 'image' | 'video' | 'reel' | 'carousel';

// Platform-specific aliases (useful for frontends/backends that target a single platform)
export type InstagramContentType = Extract<ContentType, 'post' | 'reel' | 'story'>;
export type InstagramMediaType = Extract<MediaType, 'image' | 'video' | 'reel' | 'carousel'>;

export interface ValidateContentPayload<
  P extends Platform = Platform,
  CT extends ContentType | null | undefined = ContentType | null | undefined,
  MT extends MediaType | null | undefined = MediaType | null | undefined,
> {
  platform: P;
  contentType?: CT;
  mediaType?: MT;
  caption?: string | null;
  hashtags?: string[] | null;
  mediaKeys?: string[] | null; // S3 keys or asset identifiers
  videoUrl?: string | null;
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

const optionalHashtags = z
  .array(z.string())
  .max(30, { message: 'Maximum 30 hashtags allowed' })
  .optional()
  .nullable();

const optionalMediaKeys = z.array(z.string()).optional().nullable();

const instagramBase = z.object({
  platform: z.literal('instagram'),
  contentType: z.enum(['post', 'reel', 'story']).optional().nullable(),
  mediaType: z.enum(['image', 'video', 'reel', 'carousel']).optional().nullable(),
  caption: optionalCaption,
  hashtags: optionalHashtags,
  mediaKeys: optionalMediaKeys,
  videoUrl: z.string().url().optional().nullable(),
});

function validateInstagram(payload: ValidateContentPayload): ValidationResult {
  const parsed = instagramBase.safeParse(payload);
  if (!parsed.success) {
    const errors: ValidationErrorItem[] = parsed.error.errors.map((e) => ({
      field: e.path.join('.') || 'root',
      message: e.message,
      code: 'INVALID_FIELD',
    }));
    return { ok: false, errors };
  }

  const data = parsed.data;
  const errors: ValidationErrorItem[] = [];
  const contentType = data.contentType || 'post';
  const mediaType = data.mediaType || 'image';
  const mediaCount = (data.mediaKeys?.length || 0) + (data.videoUrl ? 1 : 0);

  // Media requirements
  if (mediaType === 'image' && mediaCount < 1) {
    errors.push({
      field: 'mediaKeys',
      message: 'Image content requires at least one image asset',
      code: 'MEDIA_REQUIRED',
    });
  }

  if (mediaType === 'carousel') {
    const count = data.mediaKeys?.length || 0;
    if (count < 2) {
      errors.push({
        field: 'mediaKeys',
        message: 'Carousel requires at least 2 images',
        code: 'MEDIA_REQUIRED',
      });
    }
    if (count > 10) {
      errors.push({
        field: 'mediaKeys',
        message: 'Carousel allows up to 10 images',
        code: 'MEDIA_LIMIT',
      });
    }
  }

  if (
    (mediaType === 'video' || mediaType === 'reel') &&
    !data.videoUrl &&
    !data.mediaKeys?.length
  ) {
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
  mediaType: z.enum(['image', 'video', 'reel', 'carousel']).optional().nullable(),
  caption: z
    .string()
    .max(63206, { message: 'Caption exceeds Facebook limit (~63k characters)' })
    .optional()
    .nullable(),
  hashtags: z.array(z.string()).optional().nullable(),
  mediaKeys: optionalMediaKeys,
  videoUrl: z.string().url().optional().nullable(),
});

function validateFacebook(payload: ValidateContentPayload): ValidationResult {
  const parsed = facebookBase.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.errors.map((e) => ({
        field: e.path.join('.') || 'root',
        message: e.message,
        code: 'INVALID_FIELD',
      })),
    };
  }

  const data = parsed.data;
  const errors: ValidationErrorItem[] = [];
  const mediaType = data.mediaType || 'image';
  const mediaCount = data.mediaKeys?.length || 0;
  const hasText = !!(data.caption && data.caption.trim().length > 0);

  if ((mediaType === 'image' || mediaType === 'carousel') && mediaCount < 1) {
    errors.push({
      field: 'mediaKeys',
      message: 'A photo/album post needs at least one image',
      code: 'MEDIA_REQUIRED',
    });
  }
  if (mediaType === 'carousel' && mediaCount > 0 && mediaCount < 2) {
    errors.push({
      field: 'mediaKeys',
      message: 'Album/carousel should include at least 2 images',
      code: 'MEDIA_REQUIRED',
    });
  }
  if (mediaType === 'video' && !data.videoUrl && mediaCount === 0) {
    errors.push({
      field: 'videoUrl',
      message: 'Video post requires a video asset',
      code: 'MEDIA_REQUIRED',
    });
  }
  if (!hasText && mediaCount === 0 && !data.videoUrl) {
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
  hashtags: z.array(z.string()).optional().nullable(),
  mediaKeys: optionalMediaKeys,
  videoUrl: z.string().url().optional().nullable(),
});

function validateTwitter(payload: ValidateContentPayload): ValidationResult {
  const parsed = twitterBase.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.errors.map((e) => ({
        field: e.path.join('.') || 'root',
        message: e.message,
        code: 'INVALID_FIELD',
      })),
    };
  }
  const data = parsed.data;
  const errors: ValidationErrorItem[] = [];
  const mediaType = data.mediaType || 'image';
  if (mediaType === 'video' && !data.videoUrl && !data.mediaKeys?.length) {
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
  hashtags: z.array(z.string()).optional().nullable(),
  mediaKeys: optionalMediaKeys,
  videoUrl: z.string().url().optional().nullable(),
});

function validateLinkedIn(payload: ValidateContentPayload): ValidationResult {
  const parsed = linkedinBase.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.errors.map((e) => ({
        field: e.path.join('.') || 'root',
        message: e.message,
        code: 'INVALID_FIELD',
      })),
    };
  }
  const data = parsed.data;
  const errors: ValidationErrorItem[] = [];
  const hasText = !!(data.caption && data.caption.trim().length > 0);
  const mediaCount = data.mediaKeys?.length || 0;

  if (!hasText && mediaCount === 0 && !data.videoUrl) {
    errors.push({
      field: 'caption',
      message: 'Provide text or media for a LinkedIn post',
      code: 'CONTENT_REQUIRED',
    });
  }
  if (data.mediaType === 'video' && !data.videoUrl && mediaCount === 0) {
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
  hashtags: z.array(z.string()).optional().nullable(),
  mediaKeys: optionalMediaKeys,
  videoUrl: z.string().url().optional().nullable(),
});

function validateYouTube(payload: ValidateContentPayload): ValidationResult {
  const parsed = youtubeBase.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.errors.map((e) => ({
        field: e.path.join('.') || 'root',
        message: e.message,
        code: 'INVALID_FIELD',
      })),
    };
  }
  const data = parsed.data;
  const errors: ValidationErrorItem[] = [];
  if (!data.videoUrl && !data.mediaKeys?.length) {
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
