/**
 * Schedule Request Validator
 *
 * Input validation for schedule requests.
 */

import {
  requireStringField,
  validateEnums,
  validateFirstComment,
  validateHashtags,
  validateImageMediaAssets,
  validateMetadata,
  validateOptionalString,
  validateScheduledAt,
  validateShareToFeed,
  validateThumbOffset,
} from './schedule-validation-helpers';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ScheduleRequest {
  contentId: string;
  brandId: string;
  userId: string;
  platform: string;
  scheduledAt: string;
  contentType: string;
  mediaType?: string;
  caption?: string;
  firstComment?: string;
  hashtags?: string[];
  metadata?: Record<string, unknown>;
  shareToFeed?: boolean;
}

export interface PublishNowRequest extends Omit<ScheduleRequest, 'scheduledAt'> {
  scheduledAt?: string;
}

export function validateScheduleRequest(request: Record<string, unknown>): ValidationResult {
  const errors = validateCreateRequest(request);
  return toValidationResult(errors);
}

export function validatePublishNowRequest(request: Record<string, unknown>): ValidationResult {
  const errors = validatePublishNowPayload(request);
  return toValidationResult(errors);
}

export function validateScheduleUpdateRequest(request: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  validateScheduledAt(request, errors, { required: false, mustBeFuture: true });
  validateOptionalString(request, 'caption', errors);
  validateFirstComment(request, errors);
  validateHashtags(request, errors);
  validateMetadata(request, errors);
  validateShareToFeed(request, errors);
  validateThumbOffset(request, errors);

  return toValidationResult(errors);
}

function validateCreateRequest(request: Record<string, unknown>): string[] {
  const errors: string[] = [];

  validateRequiredCreateFields(request, errors);
  validateScheduledAt(request, errors, { required: true, mustBeFuture: true });
  validateCommonOptionalFields(request, errors);
  validateEnums(request, errors);
  validateImageMediaAssets(request, errors);

  return errors;
}

function validatePublishNowPayload(request: Record<string, unknown>): string[] {
  const errors: string[] = [];

  validateRequiredCreateFields(request, errors);
  validateScheduledAt(request, errors, { required: false, mustBeFuture: false });
  validateCommonOptionalFields(request, errors);
  validateEnums(request, errors);
  validateImageMediaAssets(request, errors);

  return errors;
}

function validateRequiredCreateFields(request: Record<string, unknown>, errors: string[]): void {
  requireStringField(request, 'contentId', errors);
  requireStringField(request, 'brandId', errors);
  requireStringField(request, 'userId', errors);
  requireStringField(request, 'platform', errors);
  requireStringField(request, 'contentType', errors);
}

function validateCommonOptionalFields(request: Record<string, unknown>, errors: string[]): void {
  validateOptionalString(request, 'mediaType', errors);
  validateOptionalString(request, 'caption', errors);
  validateFirstComment(request, errors);
  validateHashtags(request, errors);
  validateMetadata(request, errors);
  validateShareToFeed(request, errors);
}

function toValidationResult(errors: string[]): ValidationResult {
  return {
    valid: errors.length === 0,
    errors,
  };
}
