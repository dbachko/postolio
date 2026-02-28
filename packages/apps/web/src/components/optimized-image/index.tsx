import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { supportsWebP } from '@/lib/image-utils';

interface OptimizedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  cdnUrl?: string | null; // New CDN URL if available
  fallbackUrl?: string; // Original external URL as fallback
  priority?: boolean;
  onLoadComplete?: () => void;
  aspectRatio?: 'square' | 'portrait' | 'landscape';
}

function resolveInitialImageSrc({
  src,
  cdnUrl,
  fallbackUrl,
  format,
}: {
  src: string;
  cdnUrl?: string | null;
  fallbackUrl?: string;
  format: 'jpeg' | 'webp';
}) {
  if (cdnUrl) {
    const hasExt = /\.(jpg|jpeg|png|webp)$/i.test(cdnUrl);
    const cdnBase = hasExt ? cdnUrl.replace(/\.(jpg|jpeg|png|webp)$/i, '') : cdnUrl;
    return format === 'webp' && hasExt ? `${cdnBase}.webp` : cdnUrl;
  }
  if (fallbackUrl) {
    return fallbackUrl;
  }
  return src;
}

function resolveFallbackSource({
  currentSrc,
  src,
  cdnUrl,
  fallbackUrl,
}: {
  currentSrc: string;
  src: string;
  cdnUrl?: string | null;
  fallbackUrl?: string;
}) {
  if (cdnUrl && currentSrc !== cdnUrl) {
    console.warn('Optimized image failed; falling back to original CDN URL');
    return cdnUrl;
  }
  if (fallbackUrl && currentSrc !== fallbackUrl) {
    console.warn('CDN image failed; falling back to provided fallback URL');
    return fallbackUrl;
  }
  if (src && currentSrc !== src) {
    console.warn('Fallback URL failed; trying original src');
    return src;
  }
  return null;
}

function useImageSource({
  src,
  cdnUrl,
  fallbackUrl,
  onLoadComplete,
}: Pick<OptimizedImageProps, 'src' | 'cdnUrl' | 'fallbackUrl' | 'onLoadComplete'>) {
  const [imageSrc, setImageSrc] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [format, setFormat] = useState<'jpeg' | 'webp'>('jpeg');

  useEffect(() => {
    if (supportsWebP()) {
      setFormat('webp');
    }
  }, []);

  useEffect(() => {
    setImageSrc(resolveInitialImageSrc({ src, cdnUrl, fallbackUrl, format }));
  }, [cdnUrl, fallbackUrl, format, src]);

  const handleLoad = () => {
    setLoading(false);
    setError(false);
    onLoadComplete?.();
  };

  const handleError = () => {
    const nextSource = resolveFallbackSource({ currentSrc: imageSrc, src, cdnUrl, fallbackUrl });
    if (nextSource) {
      setImageSrc(nextSource);
      setError(false);
      setLoading(true);
      return;
    }
    setError(true);
    setLoading(false);
    console.error('All image sources failed to load');
  };

  return { error, handleError, handleLoad, imageSrc, loading };
}

function ImageLoadingPlaceholder({ loading }: { loading: boolean }) {
  if (!loading) {
    return null;
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="bg-muted h-full w-full animate-pulse" />
    </div>
  );
}

function ImageErrorPlaceholder({ error, loading }: { error: boolean; loading: boolean }) {
  if (!error || loading) {
    return null;
  }

  return (
    <div className="bg-muted absolute inset-0 flex items-center justify-center">
      <div className="p-4 text-center">
        <svg
          className="text-muted-foreground mx-auto h-12 w-12"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <p className="text-muted-foreground mt-2 text-sm">Failed to load image</p>
      </div>
    </div>
  );
}

export const OptimizedImage: React.FC<OptimizedImageProps> = ({
  src,
  alt,
  cdnUrl,
  fallbackUrl,
  className,
  priority = false,
  onLoadComplete,
  aspectRatio = 'square',
  ...props
}) => {
  const { imageSrc, loading, error, handleLoad, handleError } = useImageSource({
    src,
    cdnUrl,
    fallbackUrl,
    onLoadComplete,
  });

  const aspectRatioClasses = {
    square: 'aspect-square',
    portrait: 'aspect-[3/4]',
    landscape: 'aspect-[16/9]',
  };

  return (
    <div
      className={cn(
        'bg-muted relative overflow-hidden',
        aspectRatioClasses[aspectRatio],
        className
      )}
    >
      <ImageLoadingPlaceholder loading={loading} />
      <ImageErrorPlaceholder error={error} loading={loading} />
      <img
        {...props}
        src={imageSrc}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        onLoad={handleLoad}
        onError={handleError}
        className={cn(
          'h-full w-full object-cover',
          loading && 'opacity-0',
          !loading && 'opacity-100 transition-opacity duration-300',
          error && 'hidden',
          className
        )}
      />
    </div>
  );
};
