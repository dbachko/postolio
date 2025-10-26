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
  const [imageSrc, setImageSrc] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [format, setFormat] = useState<'jpeg' | 'webp'>('jpeg');

  useEffect(() => {
    // Detect browser support for modern formats
    if (supportsWebP()) {
      setFormat('webp');
    }

    // Determine which URL to use
    if (cdnUrl) {
      // Use CDN URL with format optimization (derive a .webp candidate if supported)
      const hasExt = /\.(jpg|jpeg|png|webp)$/i.test(cdnUrl);
      const cdnBase = hasExt ? cdnUrl.replace(/\.(jpg|jpeg|png|webp)$/i, '') : cdnUrl;
      const optimizedUrl = format === 'webp' && hasExt ? `${cdnBase}.webp` : cdnUrl;
      setImageSrc(optimizedUrl);
    } else if (fallbackUrl) {
      // Use fallback URL if no CDN URL available
      setImageSrc(fallbackUrl);
    } else {
      // Use original src as last resort
      setImageSrc(src);
    }
  }, [cdnUrl, fallbackUrl, src, format]);

  const handleLoad = () => {
    setLoading(false);
    setError(false);
    onLoadComplete?.();
  };

  const handleError = () => {
    // Move through a safe fallback sequence without getting stuck:
    // 1) If we tried an optimized .webp derived from the CDN URL, fall back to original CDN URL
    // 2) Then try provided fallbackUrl (original external URL), if any
    // 3) Finally, try the original src passed in

    // If we have a CDN URL and we're not currently using it, try it next
    if (cdnUrl && imageSrc !== cdnUrl) {
      console.warn('Optimized image failed; falling back to original CDN URL');
      setImageSrc(cdnUrl);
      setError(false);
      setLoading(true);
      return;
    }

    // If we have a fallback URL and we're not currently using it, try it next
    if (fallbackUrl && imageSrc !== fallbackUrl) {
      console.warn('CDN image failed; falling back to provided fallback URL');
      setImageSrc(fallbackUrl);
      setError(false);
      setLoading(true);
      return;
    }

    // Finally, try the original src if it's different
    if (src && imageSrc !== src) {
      console.warn('Fallback URL failed; trying original src');
      setImageSrc(src);
      setError(false);
      setLoading(true);
      return;
    }

    // All options exhausted
    setError(true);
    setLoading(false);
    console.error('All image sources failed to load');
  };

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
      {/* Loading placeholder */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="bg-muted h-full w-full animate-pulse" />
        </div>
      )}

      {/* Error placeholder */}
      {error && !loading && (
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
      )}

      {/* Actual image */}
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
