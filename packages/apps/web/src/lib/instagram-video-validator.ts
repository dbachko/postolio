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
  if (!duration || Number.isNaN(duration)) return 'unknown length';
  return `${Math.round(duration)}s`;
}

export async function validateInstagramVideo(
  file: File | Blob,
  options?: VideoValidationOptions
): Promise<VideoValidationResult> {
  const allowedMimeTypes = options?.allowedMimeTypes ?? [
    'video/mp4',
    'video/quicktime',
    'video/mpeg',
  ];
  const minDurationSeconds = options?.minDurationSeconds ?? 3;
  const maxDurationSeconds = options?.maxDurationSeconds ?? 90;
  const minWidth = options?.minWidth ?? 540;
  const minHeight = options?.minHeight ?? 960;
  const maxWidth = options?.maxWidth;
  const maxHeight = options?.maxHeight;
  const recommendedAspectRatios = options?.recommendedAspectRatios ?? [
    { label: '9:16', ratio: 9 / 16 },
  ];

  const mimeType = 'type' in file ? (file as File).type || '' : '';
  const errors: string[] = [];
  const warnings: string[] = [];

  if (mimeType && !allowedMimeTypes.includes(mimeType)) {
    errors.push('Please upload MP4/MOV encoded with H.264 video and AAC audio for Instagram.');
  }

  const meta = await probeVideoMetadata(file);

  if (meta.durationSeconds !== undefined) {
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

  if (meta.width && meta.height) {
    if (meta.width < minWidth || meta.height < minHeight) {
      warnings.push(
        `Video resolution is low (${Math.round(meta.width)}×${Math.round(meta.height)}). Instagram recommends at least ${minWidth}×${minHeight}.`
      );
    }

    if ((maxWidth && meta.width > maxWidth) || (maxHeight && meta.height > maxHeight)) {
      const widthCap = maxWidth ? `${maxWidth}px wide` : '';
      const heightCap = maxHeight ? `${maxHeight}px tall` : '';
      const limitPhrase =
        [widthCap, heightCap].filter(Boolean).join(' and ') || 'recommended limits';
      warnings.push(
        `Video resolution is high (${Math.round(meta.width)}×${Math.round(meta.height)}). Keeping under ${limitPhrase} can reduce processing errors.`
      );
    }

    const ratio = meta.width / meta.height;
    meta.aspectRatio = ratio;
    if (recommendedAspectRatios.length > 0) {
      const closest = recommendedAspectRatios.reduce<{
        label: string;
        ratio: number;
        diff: number;
      }>(
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
      const tolerance = 0.08;
      if (closest.diff > tolerance) {
        const labels = recommendedAspectRatios.map((r) => r.label).join(', ');
        warnings.push(
          `Aspect ratio is ${ratio.toFixed(2)}:1. Instagram processes best at ${labels}. Tall/vertical videos help avoid errors like 2207026/2207076.`
        );
      }
    }
  } else {
    warnings.push(
      'Could not read video dimensions; ensure the file is not corrupted and uses MP4/H.264.'
    );
  }

  return {
    durationSeconds: meta.durationSeconds,
    width: meta.width,
    height: meta.height,
    aspectRatio: meta.aspectRatio,
    errors,
    warnings,
  };
}
