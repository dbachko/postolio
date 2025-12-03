import type { PlatformAdapter, Schedule, Credentials, PublishResult } from '../types';

export class FacebookAdapter implements PlatformAdapter {
  async publish(schedule: Schedule, credentials: Credentials): Promise<PublishResult> {
    void schedule;
    void credentials;
    return { success: false, error: 'Facebook publishing not yet implemented' };
  }

  validateCredentials(credentials: Credentials): boolean {
    return !!(credentials?.accessToken && credentials?.pageId);
  }

  formatContent(schedule: Schedule): unknown {
    return { message: schedule.caption };
  }
}
