import type { PlatformAdapter, Schedule, Credentials, PublishResult } from '../types';
import { PLATFORM_LIMITS } from '../constants';

export class YouTubeAdapter implements PlatformAdapter {
  async publish(schedule: Schedule, credentials: Credentials): Promise<PublishResult> {
    void schedule;
    void credentials;
    return { success: false, error: 'YouTube publishing not yet implemented' };
  }

  validateCredentials(credentials: Credentials): boolean {
    return !!(credentials?.apiKey && credentials?.channelId);
  }

  formatContent(schedule: Schedule): unknown {
    return {
      title: schedule.caption?.split('\n')[0]?.slice(0, PLATFORM_LIMITS.YOUTUBE_TITLE),
      description: schedule.caption?.slice(0, PLATFORM_LIMITS.YOUTUBE_DESCRIPTION),
    };
  }
}
