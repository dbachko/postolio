type AspectRatioSpec = { label: string; ratio: number };

export interface VideoValidationOptions {
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  allowedMimeTypes?: string[];
  recommendedAspectRatios?: AspectRatioSpec[];
}

export interface VideoValidationResult {
  durationSeconds?: number;
  width?: number;
  height?: number;
  aspectRatio?: number;
  errors: string[];
  warnings: string[];
}

async function probeVideoMetadata(file: File | Blob): Promise<{
  durationSeconds?: number;
  width?: number;
  height?: number;
  aspectRatio?: number;
}> {
  return await new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.remove();
    };

    const timeout = window.setTimeout(() => {
      cleanup();
      resolve({});
    }, 7000);

    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      const width = video.videoWidth || undefined;
      const height = video.videoHeight || undefined;
      const durationSeconds = Number.isFinite(video.duration) ? video.duration : undefined;
      const aspectRatio = width && height && height !== 0 ? width / height : undefined;
      cleanup();
      resolve({ durationSeconds, width, height, aspectRatio });
    };
    video.onerror = () => {
      window.clearTimeout(timeout);
      cleanup();
      resolve({});
    };

    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.load();
  });
}

function formatSeconds(duration?: number): string {
  if (!duration || Number.isNaN(duration)) {
    return 'unknown length';
  }
  return `${Math.round(duration)}s`;
}

function resolveValidationConfig(options?: VideoValidationOptions) {
  return {
    allowedMimeTypes: options?.allowedMimeTypes ?? ['video/mp4', 'video/quicktime', 'video/mpeg'],
    minDurationSeconds: options?.minDurationSeconds ?? 3,
    maxDurationSeconds: options?.maxDurationSeconds ?? 90,
    minWidth: options?.minWidth ?? 540,
    minHeight: options?.minHeight ?? 960,
    maxWidth: options?.maxWidth,
    maxHeight: options?.maxHeight,
    recommendedAspectRatios: options?.recommendedAspectRatios ?? [{ label: '9:16', ratio: 9 / 16 }],
  };
}

function maybeAddAspectRatioWarning(
  ratio: number,
  recommendedAspectRatios: AspectRatioSpec[],
  warnings: string[]
) {
  if (recommendedAspectRatios.length === 0) {
    return;
  }
  const closest = recommendedAspectRatios.reduce<{ label: string; ratio: number; diff: number }>(
    (best, current) => {
      const diff = Math.abs(current.ratio - ratio);
      return diff < best.diff ? { ...current, diff } : best;
    },
    {
      label: recommendedAspectRatios[0].label,
      ratio: recommendedAspectRatios[0].ratio,
      diff: Infinity,
    }
  );
  if (closest.diff > 0.08) {
    const labels = recommendedAspectRatios.map((candidate) => candidate.label).join(', ');
    warnings.push(
      `Aspect ratio is ${ratio.toFixed(2)}:1. Instagram processes best at ${labels}. Tall/vertical videos help avoid errors like 2207026/2207076.`
    );
  }
}

function validateMimeType(mimeType: string, allowedMimeTypes: string[], errors: string[]) {
  if (mimeType && !allowedMimeTypes.includes(mimeType)) {
    errors.push('Please upload MP4/MOV encoded with H.264 video and AAC audio for Instagram.');
  }
}

function validateDuration(
  meta: { durationSeconds?: number },
  minDurationSeconds: number,
  maxDurationSeconds: number,
  errors: string[]
) {
  if (meta.durationSeconds === undefined) {
    return;
  }
  if (meta.durationSeconds < minDurationSeconds) {
    errors.push(
      `Video is too short (${formatSeconds(meta.durationSeconds)}). Instagram requires at least ${minDurationSeconds}s.`
    );
  }
  if (meta.durationSeconds > maxDurationSeconds) {
    errors.push(
      `Video is too long (${formatSeconds(meta.durationSeconds)}). Instagram supports up to ${maxDurationSeconds}s for reels/feed videos.`
    );
  }
}

function validateDimensions(
  meta: { width?: number; height?: number; aspectRatio?: number },
  params: {
    minWidth: number;
    minHeight: number;
    maxWidth?: number;
    maxHeight?: number;
    recommendedAspectRatios: AspectRatioSpec[];
  },
  warnings: string[]
) {
  if (!(meta.width && meta.height)) {
    warnings.push(
      'Could not read video dimensions; ensure the file is not corrupted and uses MP4/H.264.'
    );
    return;
  }

  if (meta.width < params.minWidth || meta.height < params.minHeight) {
    warnings.push(
      `Video resolution is low (${Math.round(meta.width)}×${Math.round(meta.height)}). Instagram recommends at least ${params.minWidth}×${params.minHeight}.`
    );
  }

  if (
    (params.maxWidth && meta.width > params.maxWidth) ||
    (params.maxHeight && meta.height > params.maxHeight)
  ) {
    const widthCap = params.maxWidth ? `${params.maxWidth}px wide` : '';
    const heightCap = params.maxHeight ? `${params.maxHeight}px tall` : '';
    const limitPhrase = [widthCap, heightCap].filter(Boolean).join(' and ') || 'recommended limits';
    warnings.push(
      `Video resolution is high (${Math.round(meta.width)}×${Math.round(meta.height)}). Keeping under ${limitPhrase} can reduce processing errors.`
    );
  }

  const ratio = meta.width / meta.height;
  meta.aspectRatio = ratio;
  maybeAddAspectRatioWarning(ratio, params.recommendedAspectRatios, warnings);
}

export async function validateInstagramVideo(
  file: File | Blob,
  options?: VideoValidationOptions
): Promise<VideoValidationResult> {
  const {
    allowedMimeTypes,
    minDurationSeconds,
    maxDurationSeconds,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
    recommendedAspectRatios,
  } = resolveValidationConfig(options);

  const mimeType = 'type' in file ? (file as File).type || '' : '';
  const errors: string[] = [];
  const warnings: string[] = [];
  validateMimeType(mimeType, allowedMimeTypes, errors);

  const meta = await probeVideoMetadata(file);
  validateDuration(meta, minDurationSeconds, maxDurationSeconds, errors);
  validateDimensions(
    meta,
    { minWidth, minHeight, maxWidth, maxHeight, recommendedAspectRatios },
    warnings
  );

  return {
    durationSeconds: meta.durationSeconds,
    width: meta.width,
    height: meta.height,
    aspectRatio: meta.aspectRatio,
    errors,
    warnings,
  };
}
