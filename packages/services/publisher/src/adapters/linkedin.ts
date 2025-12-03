import type { PlatformAdapter, Schedule, Credentials, PublishResult } from '../types';

export class LinkedInAdapter implements PlatformAdapter {
  async publish(schedule: Schedule, credentials: Credentials): Promise<PublishResult> {
    void schedule;
    void credentials;
    return { success: false, error: 'LinkedIn publishing not yet implemented' };
  }

  validateCredentials(credentials: Credentials): boolean {
    return !!credentials?.accessToken;
  }

  formatContent(schedule: Schedule): unknown {
    return { text: schedule.caption };
  }
}
