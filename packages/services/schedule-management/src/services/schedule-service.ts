/**
 * Schedule Service
 *
 * Thin facade over domain operations. Business workflows live in src/domain.
 */

import { getDynamoDBConfig } from '../config';
import { createScheduleOperation } from '../domain/schedule-create';
import { deleteScheduleOperation } from '../domain/schedule-delete';
import { healthCheckOperation } from '../domain/schedule-health';
import { publishNowOperation } from '../domain/schedule-publish-now';
import { getScheduleById, listSchedules } from '../domain/schedule-read';
import { updateScheduleOperation } from '../domain/schedule-update';
import type {
  ListSchedulesResult,
  PublishNowScheduleRequest,
  ScheduleRequest,
  ScheduleResult,
} from '../types/schedule';

export type {
  ListSchedulesResult,
  MediaAsset,
  PublishNowScheduleRequest,
  Schedule,
  ScheduleFailureContext,
  ScheduleOperation,
  ScheduleRequest,
  ScheduleResult,
} from '../types/schedule';

export class ScheduleService {
  private config = getDynamoDBConfig();

  async createSchedule(request: ScheduleRequest): Promise<ScheduleResult> {
    return createScheduleOperation({
      config: this.config,
      request,
      updateSchedule: (scheduleId, updateRequest) => this.updateSchedule(scheduleId, updateRequest),
    });
  }

  async publishNow(request: PublishNowScheduleRequest): Promise<ScheduleResult> {
    return publishNowOperation({
      config: this.config,
      request,
      getSchedule: (scheduleId) => this.getSchedule(scheduleId),
    });
  }

  async getSchedule(scheduleId: string): Promise<ScheduleResult> {
    return getScheduleById(this.config, scheduleId);
  }

  async listSchedules(queryParams: Record<string, string>): Promise<ListSchedulesResult> {
    return listSchedules(this.config, queryParams);
  }

  async updateSchedule(
    scheduleId: string,
    updateRequest: Partial<ScheduleRequest>
  ): Promise<ScheduleResult> {
    return updateScheduleOperation({
      config: this.config,
      scheduleId,
      updateRequest,
      getSchedule: (id) => this.getSchedule(id),
    });
  }

  async deleteSchedule(scheduleId: string): Promise<ScheduleResult> {
    return deleteScheduleOperation({
      config: this.config,
      scheduleId,
      getSchedule: (id) => this.getSchedule(id),
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; details: string }> {
    return healthCheckOperation(this.config);
  }
}
