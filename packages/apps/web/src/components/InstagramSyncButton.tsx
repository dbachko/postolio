/**
 * @deprecated Use SocialSyncButton with platform="instagram" instead
 * Kept for backward compatibility
 */
import { SocialSyncButton } from './social/SocialSyncButton';

interface InstagramSyncButtonProps {
  brandId: string;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  size?: 'default' | 'sm' | 'lg';
  className?: string;
}

/**
 * Instagram sync button component
 * @deprecated This component wraps the generic SocialSyncButton component.
 * For new code, use: <SocialSyncButton platform="instagram" brandId={brandId} />
 */
export function InstagramSyncButton({
  brandId,
  variant = 'outline',
  size = 'default',
  className = '',
}: InstagramSyncButtonProps) {
  return (
    <SocialSyncButton
      platform="instagram"
      brandId={brandId}
      variant={variant}
      size={size}
      className={className}
    />
  );
}
