import { ServiceError } from '@postolio/errors';

export class NotFoundError extends ServiceError {
  constructor(message: string) {
    super({
      code: 'NOT_FOUND',
      message,
      retryable: false,
      userMessage: 'The requested resource was not found.',
    });
  }
}

export function getHttpStatusCodeForServiceError(error: ServiceError): number {
  switch (error.code) {
    case 'VALIDATION_FAILED':
      return 400;
    case 'RATE_LIMITED':
      return 429;
    case 'NOT_FOUND':
      return 404;
    default:
      return 500;
  }
}
