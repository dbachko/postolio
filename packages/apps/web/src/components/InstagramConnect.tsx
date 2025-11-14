/**
 * @deprecated Use SocialAccountConnect with platform="instagram" instead
 * Kept for backward compatibility
 */
import { SocialAccountConnect } from './social/SocialAccountConnect';
import type { Brand } from '../lib/api';

interface InstagramConnectProps {
  brand: Brand;
}

/**
 * Instagram connection component
 * @deprecated This component wraps the generic SocialAccountConnect component.
 * For new code, use: <SocialAccountConnect platform="instagram" brand={brand} />
 */
export function InstagramConnect({ brand }: InstagramConnectProps) {
  return <SocialAccountConnect platform="instagram" brand={brand} />;
}
