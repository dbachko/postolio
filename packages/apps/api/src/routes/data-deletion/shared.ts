import type { FastifyBaseLogger } from 'fastify';

export const DELETION_REASONS = {
  not_using: "I'm not using the service anymore",
  too_expensive: "It's too expensive",
  missing_features: "It's missing features I need",
  privacy_concerns: 'I have privacy concerns',
  switching_service: "I'm switching to another service",
  other: 'Other reason',
} as const;

export type DeletionReason = keyof typeof DELETION_REASONS;

export interface DeletionRequest {
  email: string;
  userId?: string;
  reason?: DeletionReason;
  source: 'user' | 'meta' | 'legal';
  verificationToken?: string;
}

export interface MetaDeletionCallback {
  signed_request: string;
}

export interface DeletionSurvey {
  reason: DeletionReason;
  feedback?: string;
}

export function isDeletionReason(value: unknown): value is DeletionReason {
  return typeof value === 'string' && value in DELETION_REASONS;
}

export function logRouteError(
  logger: FastifyBaseLogger,
  error: unknown,
  contextMessage: string
): void {
  const message = error instanceof Error ? error.message : 'An unknown error occurred';
  logger.error({ message }, contextMessage);
}
