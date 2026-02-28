import { randomUUID } from 'crypto';
import https from 'https';
import axios, { type AxiosInstance } from 'axios';
import { z } from 'zod';
import CircuitBreaker from 'opossum';
import { aws4Interceptor } from 'aws4-axios';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { logger as baseLogger } from '@postolio/logger';
import { resolveAwsServiceTarget } from '@postolio/aws';
import { ParameterManager, getCurrentEnvironment } from '@postolio/service-parameters';

import {
  type CacheValue,
  type ContentSchedulerConfig,
  type CreateScheduleInput,
  type ListSchedulesParams,
  type PublishNowInput,
  type Schedule,
  type ScheduleList,
  type UpdateScheduleInput,
  type RequestWithMeta,
  ScheduleSchema,
} from './content-scheduler-client.schemas.js';
import type { ErrorDetails } from './content-scheduler-client.errors.js';
import {
  setupCircuitBreakerEvents,
  setupInterceptors,
  safeSize,
  log,
  generateRequestId,
} from './content-scheduler-client.internal.js';
import {
  createScheduleOperation,
  publishNowOperation,
  updateScheduleOperation,
  deleteScheduleOperation,
  getScheduleOperation,
  listSchedulesOperation,
  cancelScheduleOperation,
  rescheduleOperation,
  getSchedulesByBrandOperation,
  getUpcomingSchedulesOperation,
  getSchedulingStatsOperation,
  healthCheckOperation,
} from './content-scheduler-client.public.js';

export type {
  Platform,
  ScheduleStatus,
  ContentType,
  MediaAsset,
  Schedule,
  ScheduleList,
  CreateScheduleInput,
  PublishNowInput,
  UpdateScheduleInput,
  ListSchedulesParams,
  ContentSchedulerConfig,
} from './content-scheduler-client.schemas.js';
export {
  SchedulerError,
  ValidationError,
  NetworkError,
  RateLimitError,
} from './content-scheduler-client.errors.js';

export class ContentSchedulerClient {
  private client: AxiosInstance;
  private circuitBreaker!: CircuitBreaker;
  private config: ContentSchedulerConfig;
  private cache: Map<string, { data: CacheValue; timestamp: number; etag?: string }>;
  private debug: boolean;
  private region: string;
  private logger = baseLogger.child({ module: 'ContentSchedulerClient' });

  constructor(config: ContentSchedulerConfig) {
    this.config = {
      timeout: 10000,
      maxRetries: 3,
      retryDelay: 1000,
      ...config,
    };

    this.cache = new Map();
    const normalizedBaseURL = this.config.baseURL.replace(/\/+$/, '');
    const { region: inferredRegion, service: inferredService } =
      resolveAwsServiceTarget(normalizedBaseURL);
    this.region = inferredRegion;
    this.debug = this.config.debugLogging ?? true;
    this.client = this.createAxiosClient(normalizedBaseURL);
    this.addPreSigningRequestInterceptor();
    setupInterceptors(this);
    this.attachSigv4Interceptor(normalizedBaseURL, inferredRegion, inferredService);
    this.initializeCircuitBreaker();
    setupCircuitBreakerEvents(this);
  }

  private createAxiosClient(baseURL: string): AxiosInstance {
    return axios.create({
      baseURL,
      timeout: this.config.timeout || 10000,
      headers: { 'Content-Type': 'application/json' },
      httpsAgent: new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 1000,
        maxSockets: 50,
        maxFreeSockets: 10,
        timeout: 60000,
      }),
    });
  }

  private addPreSigningRequestInterceptor(): void {
    this.client.interceptors.request.use((request) => {
      if (request.headers) {
        delete (request.headers as Record<string, unknown>)['Host'];
        delete (request.headers as Record<string, unknown>)['host'];
      }
      if (request.url) {
        const parts = request.url.split('?');
        const pathPart = parts[0] || '/';
        const queryPart = parts[1];
        const normalizedPath = pathPart.replace(/\/+/g, '/');
        request.url = queryPart ? `${normalizedPath}?${queryPart}` : normalizedPath;
      }
      (request as RequestWithMeta).__meta = {
        start: Date.now(),
        id: this.generateRequestId(),
        attempt: 0,
      };
      return request;
    });
  }

  private attachSigv4Interceptor(baseURL: string, region: string, service: string): void {
    const credentialProvider = defaultProvider();
    const credentialsAdapter = {
      getCredentials: async () => {
        try {
          const awsCredentials = await credentialProvider();
          const credentials: {
            accessKeyId: string;
            secretAccessKey: string;
            sessionToken?: string;
          } = {
            accessKeyId: awsCredentials.accessKeyId,
            secretAccessKey: awsCredentials.secretAccessKey,
          };
          if (awsCredentials.sessionToken) {
            credentials.sessionToken = awsCredentials.sessionToken;
          }
          return credentials;
        } catch (error) {
          this.log('error', 'scheduler.auth.credentials_error', {
            message: error instanceof Error ? error.message : String(error),
          });
          return undefined;
        }
      },
    };

    const sigv4 = aws4Interceptor({
      options: { region, service },
      credentials: credentialsAdapter,
    });

    if (this.debug) {
      this.log('info', 'scheduler.sigv4.config', {
        region,
        service,
        baseURL,
        AWS_REGION: process.env.AWS_REGION,
        AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION,
        isECS: !!process.env.ECS_CONTAINER_METADATA_URI_V4,
      });
    }
    this.client.interceptors.request.use(sigv4);
  }

  private initializeCircuitBreaker(): void {
    this.circuitBreaker = new CircuitBreaker(async (fn: () => Promise<unknown>) => fn(), {
      timeout: 30000,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
      rollingCountTimeout: 10000,
      rollingCountBuckets: 10,
      name: 'ContentSchedulerClient',
      errorFilter: (err: unknown) => {
        if (!axios.isAxiosError(err) || !err.response) {
          return false;
        }
        const status = err.response.status;
        return status < 500 && status !== 429;
      },
      ...this.config.circuitBreakerOptions,
    });
  }

  private parseScheduleResponseData(
    scheduleData: unknown,
    context: { path: string; status: number }
  ): Schedule {
    try {
      return ScheduleSchema.parse(scheduleData);
    } catch (parseError) {
      const size = this.safeSize(scheduleData);
      this.log('error', 'scheduler.response.parse_failed', {
        baseURL: this.config.baseURL,
        path: context.path,
        status: context.status,
        size,
        body: size < 2048 ? scheduleData : undefined,
        error: parseError instanceof Error ? parseError.message : String(parseError),
        zodErrors: parseError instanceof z.ZodError ? (parseError.issues as unknown[]) : undefined,
      });

      if (scheduleData && typeof scheduleData === 'object' && 'scheduleId' in scheduleData) {
        this.log('warn', 'scheduler.response.schema_mismatch_with_id', {
          scheduleId: (scheduleData as { scheduleId: string }).scheduleId,
        });
        return scheduleData as Schedule;
      }
      if (scheduleData && typeof scheduleData === 'object' && !('scheduleId' in scheduleData)) {
        const data = scheduleData as Record<string, unknown>;
        const fallbackId = (data.id as string) || (data.contentId as string) || randomUUID();
        this.log('warn', 'scheduler.response.schema_mismatch_without_id', {
          fallbackScheduleId: fallbackId,
        });
        return { ...data, scheduleId: fallbackId } as Schedule;
      }
      throw parseError;
    }
  }

  static async create(
    config: Partial<ContentSchedulerConfig> = {}
  ): Promise<ContentSchedulerClient> {
    const finalConfig = { ...config };
    if (!finalConfig.baseURL) {
      try {
        const parameterManager = new ParameterManager(process.env.AWS_REGION || 'us-east-1');
        const environment = getCurrentEnvironment();
        finalConfig.baseURL = await parameterManager.getServiceUrl(
          'CONTENT_SCHEDULER_URL',
          environment
        );
        baseLogger.info('Content Scheduler URL retrieved from SSM', {
          baseURL: finalConfig.baseURL,
          source: 'ssm',
        });
      } catch (ssmError) {
        baseLogger.warn('Content Scheduler SSM lookup failed, trying fallback URLs', {
          error: ssmError instanceof Error ? ssmError.message : String(ssmError),
        });
        const fallbackUrl =
          process.env.CONTENT_SCHEDULER_FUNCTION_URL ||
          process.env.SCHEDULER_API_URL ||
          process.env.CONTENT_SCHEDULER_URL;
        if (fallbackUrl) {
          finalConfig.baseURL = fallbackUrl;
          baseLogger.warn('Using Content Scheduler fallback URL', { baseURL: fallbackUrl });
        } else {
          baseLogger.error('Content Scheduler URL not found in SSM or environment variables');
          throw new Error('Unable to resolve Content Scheduler service URL');
        }
      }
    }

    if (!finalConfig.baseURL) {
      throw new Error('baseURL is required for ContentSchedulerClient');
    }
    return new ContentSchedulerClient(finalConfig as ContentSchedulerConfig);
  }

  async createSchedule(data: CreateScheduleInput): Promise<Schedule> {
    return createScheduleOperation(this, data);
  }

  async publishNow(data: PublishNowInput): Promise<Schedule> {
    return publishNowOperation(this, data);
  }

  async updateSchedule(id: string, data: UpdateScheduleInput): Promise<Schedule> {
    return updateScheduleOperation(this, id, data);
  }

  async deleteSchedule(id: string, options?: { userId?: string }): Promise<void> {
    return deleteScheduleOperation(this, id, options);
  }

  async getSchedule(id: string): Promise<Schedule> {
    return getScheduleOperation(this, id);
  }

  async listSchedules(
    params: ListSchedulesParams = { limit: 20, offset: 0 }
  ): Promise<ScheduleList> {
    return listSchedulesOperation(this, params);
  }

  async cancelSchedule(id: string): Promise<Schedule> {
    return cancelScheduleOperation(this, id);
  }

  async reschedule(
    id: string,
    newTime: Date,
    requiredFields: { brandId: string; contentId: string; userId: string; platform?: string }
  ): Promise<Schedule> {
    return rescheduleOperation(this, id, newTime, requiredFields);
  }

  async getSchedulesByBrand(
    brandId: string,
    params: Omit<ListSchedulesParams, 'brandId'> = { limit: 20, offset: 0 }
  ): Promise<ScheduleList> {
    return getSchedulesByBrandOperation(this, brandId, params);
  }

  async getUpcomingSchedules(brandId: string, limit = 10): Promise<Schedule[]> {
    return getUpcomingSchedulesOperation(this, brandId, limit);
  }

  async getSchedulingStats(brandId: string): Promise<{
    scheduled: number;
    published: number;
    failed: number;
    cancelled: number;
    processing: number;
  }> {
    return getSchedulingStatsOperation(this, brandId);
  }

  async healthCheck(): Promise<boolean> {
    return healthCheckOperation(this);
  }

  getCircuitBreakerStats() {
    return this.circuitBreaker.stats;
  }

  private generateRequestId(): string {
    return generateRequestId();
  }

  private log(
    level: 'info' | 'warn' | 'error' | 'debug',
    event: string,
    details: ErrorDetails
  ): void {
    log(this, level, event, details);
  }

  private safeSize(data: unknown): number {
    return safeSize(data);
  }
}

export function createSchedulerClient(config: ContentSchedulerConfig): ContentSchedulerClient {
  return new ContentSchedulerClient(config);
}

export default ContentSchedulerClient;
