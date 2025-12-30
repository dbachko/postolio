import type { AssetProbeResult } from './types';

export function formatBytes(bytes?: number | null) {
  if (!bytes || Number.isNaN(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatDateTime(value?: string | null) {
  if (!value) return '—';
  try {
    const date = new Date(value);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  } catch {
    return value;
  }
}

export function getFileExtension(fileName?: string | null) {
  if (!fileName) return 'Unknown';
  const idx = fileName.lastIndexOf('.');
  return idx > -1 ? fileName.slice(idx + 1).toUpperCase() : fileName.toUpperCase();
}

export function probeImageDimensions(file: File): Promise<AssetProbeResult> {
  const ImageCtor = typeof window !== 'undefined' ? (window.Image as typeof Image) : undefined;
  if (!ImageCtor) {
    return Promise.resolve<AssetProbeResult>({});
  }

  return new Promise<AssetProbeResult>((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new ImageCtor();
    image.onload = () => {
      resolve({ width: image.width, height: image.height });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve({});
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}

export function probeVideoMetadata(file: File): Promise<AssetProbeResult> {
  if (typeof document === 'undefined') {
    return Promise.resolve<AssetProbeResult>({});
  }

  return new Promise<AssetProbeResult>((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      resolve({
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
        duration: Number.isFinite(video.duration) ? Math.round(video.duration) : undefined,
      });
      URL.revokeObjectURL(url);
    };
    video.onerror = () => {
      resolve({});
      URL.revokeObjectURL(url);
    };
    video.src = url;
  });
}
