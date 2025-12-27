import type { ReactNode } from 'react';
import { Briefcase } from 'lucide-react';
import { FacebookIcon, TikTokIcon, XBrandIcon, YouTubeIcon } from '@/components/icons/BrandIcons';
import { cn } from '@/lib/utils';

export type Platform =
  | 'instagram'
  | 'facebook'
  | 'linkedin'
  | 'x'
  | 'twitter'
  | 'youtube'
  | 'tiktok';

/**
 * Returns the appropriate platform icon component for a given platform.
 * Uses high-quality brand icons from SimpleIcons for major platforms.
 *
 * @param platform - The platform identifier (case-insensitive)
 * @param className - Optional CSS classes for styling the icon
 * @returns A React node with the platform icon, or null if platform is not supported
 */
export function getPlatformIcon(
  platform: string | undefined | null,
  className: string = 'h-4 w-4'
): ReactNode {
  if (!platform) return null;

  const platformLower = platform.toLowerCase();

  switch (platformLower) {
    case 'instagram':
      // CSS mask-based gradient fill for Instagram (see src/index.css).
      return (
        <span
          className={cn('platform-icon platform-icon--instagram', className)}
          aria-hidden="true"
        />
      );
    case 'facebook':
      return <FacebookIcon className={className} aria-hidden="true" />;
    case 'linkedin':
      return <Briefcase className={className} aria-hidden="true" />;
    case 'x':
    case 'twitter':
      return <XBrandIcon className={className} aria-hidden="true" />;
    case 'youtube':
      return <YouTubeIcon className={className} aria-hidden="true" />;
    case 'tiktok':
      return <TikTokIcon className={className} aria-hidden="true" />;
    default:
      return null;
  }
}
