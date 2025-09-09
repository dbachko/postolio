import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { supportsWebP } from "@/lib/image-utils";

interface OptimizedImageProps
  extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  cdnUrl?: string | null; // New CDN URL if available
  fallbackUrl?: string; // Original external URL as fallback
  priority?: boolean;
  onLoadComplete?: () => void;
  aspectRatio?: "square" | "portrait" | "landscape";
}

export const OptimizedImage: React.FC<OptimizedImageProps> = ({
  src,
  alt,
  cdnUrl,
  fallbackUrl,
  className,
  priority = false,
  onLoadComplete,
  aspectRatio = "square",
  ...props
}) => {
  const [imageSrc, setImageSrc] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [format, setFormat] = useState<"jpeg" | "webp">("jpeg");

  useEffect(() => {
    // Detect browser support for modern formats
    if (supportsWebP()) {
      setFormat("webp");
    }

    // Determine which URL to use
    if (cdnUrl) {
      // Use CDN URL with format optimization
      const cdnBase = cdnUrl.replace(/\.(jpg|jpeg|png|webp)$/i, "");
      const optimizedUrl = format === "webp" ? `${cdnBase}.webp` : cdnUrl;
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
    setError(true);
    setLoading(false);

    // Try fallback URLs in order
    if (imageSrc === cdnUrl && fallbackUrl) {
      console.warn("CDN image failed to load, trying fallback URL");
      setImageSrc(fallbackUrl);
      setError(false);
      setLoading(true);
    } else if (imageSrc === fallbackUrl && src !== fallbackUrl) {
      console.warn("Fallback URL failed, trying original source");
      setImageSrc(src);
      setError(false);
      setLoading(true);
    } else {
      console.error("All image sources failed to load");
    }
  };

  const aspectRatioClasses = {
    square: "aspect-square",
    portrait: "aspect-[3/4]",
    landscape: "aspect-[16/9]",
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden bg-gray-100 dark:bg-gray-800",
        aspectRatioClasses[aspectRatio],
        className,
      )}
    >
      {/* Loading placeholder */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="animate-pulse bg-gray-200 dark:bg-gray-700 w-full h-full" />
        </div>
      )}

      {/* Error placeholder */}
      {error && !loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800">
          <div className="text-center p-4">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
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
            <p className="mt-2 text-sm text-gray-500">Failed to load image</p>
          </div>
        </div>
      )}

      {/* Actual image */}
      <img
        {...props}
        src={imageSrc}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        onLoad={handleLoad}
        onError={handleError}
        className={cn(
          "w-full h-full object-cover",
          loading && "opacity-0",
          !loading && "opacity-100 transition-opacity duration-300",
          error && "hidden",
          className,
        )}
      />
    </div>
  );
};
