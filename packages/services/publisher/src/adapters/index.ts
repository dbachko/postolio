import type { PlatformAdapter } from '../types';
import { InstagramAdapter } from './instagram';
import { FacebookAdapter } from './facebook';
import { TwitterAdapter } from './twitter';
import { LinkedInAdapter } from './linkedin';
import { YouTubeAdapter } from './youtube';

export { InstagramAdapter } from './instagram';
export { FacebookAdapter } from './facebook';
export { TwitterAdapter } from './twitter';
export { LinkedInAdapter } from './linkedin';
export { YouTubeAdapter } from './youtube';

export class PlatformAdapterFactory {
  static getAdapter(platform: string): PlatformAdapter {
    switch (platform) {
      case 'instagram':
        return new InstagramAdapter();
      case 'facebook':
        return new FacebookAdapter();
      case 'twitter':
        return new TwitterAdapter();
      case 'linkedin':
        return new LinkedInAdapter();
      case 'youtube':
        return new YouTubeAdapter();
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
}
