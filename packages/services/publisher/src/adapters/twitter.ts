import type { PlatformAdapter, Schedule, Credentials, PublishResult } from '../types';
import { PLATFORM_LIMITS } from '../constants';

export class TwitterAdapter implements PlatformAdapter {
  async publish(schedule: Schedule, credentials: Credentials): Promise<PublishResult> {
    void schedule;
    void credentials;
    return { success: false, error: 'Twitter publishing not yet implemented' };
  }

  validateCredentials(credentials: Credentials): boolean {
    return !!(credentials?.apiKey && credentials?.apiSecret);
  }

  formatContent(schedule: Schedule): unknown {
    return { text: schedule.caption?.slice(0, PLATFORM_LIMITS.TWITTER_TWEET) };
  }
}
