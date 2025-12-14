import { StatusBroadcaster } from '../status-broadcaster.js';
import { campaignCreationService } from './campaign-creation.js';
import { campaignLifecycleService } from './campaign-lifecycle.js';
import { campaignRetrievalService } from './campaign-retrieval.js';
import {
  campaignUpdatesService,
  type CampaignUpdateData,
  type EditableCampaignFields,
} from './campaign-updates.js';
import type { CampaignConfig, CampaignPreview, CampaignStartResult } from './campaign-types.js';

export type { CampaignConfig, CampaignPreview, CampaignStartResult } from './campaign-types.js';

class CampaignService {
  private statusBroadcaster?: StatusBroadcaster;

  /**
   * Set the status broadcaster for real-time updates
   */
  setStatusBroadcaster(broadcaster: StatusBroadcaster): void {
    this.statusBroadcaster = broadcaster;
  }

  /**
   * Create and save campaign configuration
   */
  async configureCampaign(
    config: CampaignConfig,
    userId: string,
    overrideTimezone?: string
  ): Promise<Record<string, unknown>> {
    return campaignCreationService.configureCampaign(config, userId, overrideTimezone);
  }

  /**
   * Generate preview posts for a campaign
   */
  async generateCampaignPreview(
    campaignId: string,
    userId: string,
    exampleCount = 3
  ): Promise<CampaignPreview> {
    return campaignCreationService.generateCampaignPreview(campaignId, userId, exampleCount);
  }

  /**
   * Start campaign - generate all content and schedule posts
   */
  async startCampaign(campaignId: string, userId: string): Promise<CampaignStartResult> {
    return campaignLifecycleService.startCampaign(campaignId, userId);
  }

  /**
   * Get campaign details
   */
  async getCampaign(campaignId: string, userId: string): Promise<Record<string, unknown> | null> {
    return campaignRetrievalService.getCampaign(campaignId, userId);
  }

  /**
   * Update campaign configuration
   */
  async updateCampaign(
    campaignId: string,
    userId: string,
    updates: {
      name?: string;
      themes?: string[];
      style?: string;
      frequency?: string;
      postingTime?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
    }
  ): Promise<{
    success: boolean;
    message?: string;
    campaign?: Record<string, unknown> | null;
  }> {
    return campaignUpdatesService.updateCampaign(campaignId, userId, updates);
  }

  async pauseCampaign(campaignId: string, userId: string): Promise<Record<string, unknown>> {
    return campaignLifecycleService.pauseCampaign(campaignId, userId);
  }

  async resumeCampaign(campaignId: string, userId: string): Promise<Record<string, unknown>> {
    return campaignLifecycleService.resumeCampaign(campaignId, userId);
  }

  /**
   * Update campaign status with validation (for non-pause/resume operations)
   */
  async updateCampaignStatus(
    campaignId: string,
    userId: string,
    newStatus: string
  ): Promise<{
    success: boolean;
    campaign: Record<string, unknown> | null;
    oldStatus?: string;
    message: string;
  }> {
    return campaignLifecycleService.updateCampaignStatus(campaignId, userId, newStatus);
  }

  /**
   * Update campaign priority and check for new conflicts
   */
  async updateCampaignPriority(
    campaignId: string,
    newPriority: number,
    userId: string
  ): Promise<{
    success: boolean;
    campaign: Record<string, unknown> | null;
    conflicts?: number;
  }> {
    return campaignUpdatesService.updateCampaignPriority(campaignId, newPriority, userId);
  }

  /**
   * Get campaign coordination summary for a user
   */
  async getCampaignCoordination(userId: string): Promise<{
    activeCampaigns: number;
    resourceAllocation: unknown;
    campaignsByPriority: Record<number, number>;
    conflicts: number;
  }> {
    return campaignRetrievalService.getCampaignCoordination(userId);
  }

  /**
   * Validate campaign configuration
   */
  validateCampaignConfig(config: CampaignConfig): string[] {
    return campaignCreationService.validateCampaignConfig(config);
  }

  /**
   * Validate field editability based on campaign status and field types
   */
  async validateFieldEditability(
    campaignId: string,
    fieldsToUpdate: EditableCampaignFields,
    userId: string
  ): Promise<{ valid: boolean; errors: { field: string; message: string }[] }> {
    return campaignUpdatesService.validateFieldEditability(campaignId, fieldsToUpdate, userId);
  }

  /**
   * Update campaign with automatic content regeneration when needed
   */
  async updateCampaignWithRegeneration(
    campaignId: string,
    updateData: CampaignUpdateData,
    userId: string
  ): Promise<{
    campaign: Record<string, unknown>;
    regenerationTriggered: boolean;
    regenerationReason?: string;
    message?: string;
  }> {
    return campaignUpdatesService.updateCampaignWithRegeneration(campaignId, updateData, userId);
  }

  /**
   * Start an edit session for concurrent edit detection
   */
  async startEditSession(
    campaignId: string,
    userId: string,
    customStartTime?: Date
  ): Promise<void> {
    return campaignRetrievalService.startEditSession(campaignId, userId, customStartTime);
  }

  /**
   * Check for concurrent edits within the 5-minute window
   */
  async checkConcurrentEdit(
    campaignId: string,
    userId: string
  ): Promise<{
    hasConflict: boolean;
    conflictUser?: string;
    warningMessage?: string;
  }> {
    return campaignRetrievalService.checkConcurrentEdit(campaignId, userId);
  }
}

export const campaignService = new CampaignService();
