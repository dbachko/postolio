import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ContentSchedulerClient } from './content-scheduler-client.js';

const BRAND_ID = '11111111-1111-4111-8111-111111111111';
const CONTENT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

describe('ContentSchedulerClient', () => {
  let server: ReturnType<typeof createServer>;
  let baseURL: string;
  let nextScheduleStatus: string;

  beforeAll(async () => {
    process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
    process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test-access-key';
    process.env.AWS_SECRET_ACCESS_KEY =
      process.env.AWS_SECRET_ACCESS_KEY || 'test-secret-access-key';

    nextScheduleStatus = 'scheduled';

    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      await readBody(req);

      if (!req.url) {
        res.statusCode = 400;
        res.end();
        return;
      }

      const isPutSchedule = req.method === 'PUT' && req.url.startsWith('/schedules/');
      const isPostSchedules = req.method === 'POST' && req.url === '/schedules';
      if (!isPutSchedule && !isPostSchedules) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: false, error: 'not_found' }));
        return;
      }

      const scheduleId = isPutSchedule ? req.url.split('/')[2] : 'test-schedule-id';

      const now = new Date();
      const scheduledAt = new Date(now.getTime() + 60_000).toISOString();
      const payload = {
        success: true,
        data: {
          scheduleId,
          contentId: CONTENT_ID,
          brandId: BRAND_ID,
          userId: USER_ID,
          platform: 'instagram',
          scheduledAt,
          caption: 'hello',
          status: nextScheduleStatus,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
        timestamp: now.toISOString(),
      };

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as AddressInfo;
    baseURL = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  });

  it('parses schedule status "skipped" from scheduler responses', async () => {
    nextScheduleStatus = 'skipped';
    const client = new ContentSchedulerClient({ baseURL, debugLogging: false });

    const schedule = await client.updateSchedule('schedule-123', {
      scheduledAt: new Date(Date.now() + 60_000).toISOString(),
      brandId: BRAND_ID,
      contentId: CONTENT_ID,
      userId: USER_ID,
      platform: 'instagram',
    });

    expect(schedule.status).toBe('skipped');
  });

  it('does not throw when scheduler returns an unknown status with scheduleId present', async () => {
    nextScheduleStatus = 'unknown-status';
    const client = new ContentSchedulerClient({ baseURL, debugLogging: false });

    const schedule = await client.updateSchedule('schedule-abc', {
      scheduledAt: new Date(Date.now() + 60_000).toISOString(),
      brandId: BRAND_ID,
      contentId: CONTENT_ID,
      userId: USER_ID,
      platform: 'instagram',
    });

    expect(schedule.scheduleId).toBe('schedule-abc');
  });
});
