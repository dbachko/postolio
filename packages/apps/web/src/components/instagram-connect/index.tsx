/**
 * @deprecated Use SocialAccountConnect with platform="instagram" instead
 * Kept for backward compatibility
 */
import { SocialAccountConnect } from '@/components/social/social-account-connect';
import type { Brand } from '@/lib/api';

interface InstagramConnectProps {
  brand: Brand;
  onConnectionChange?: (connected: boolean) => void;
}

/**
 * Instagram connection component
 * @deprecated This component wraps the generic SocialAccountConnect component.
 * For new code, use: <SocialAccountConnect platform="instagram" brand={brand} />
 */
export function InstagramConnect({ brand, onConnectionChange }: InstagramConnectProps) {
  return (
    <SocialAccountConnect
      platform="instagram"
      brand={brand}
      onConnectionChange={onConnectionChange}
    />
  );
}
