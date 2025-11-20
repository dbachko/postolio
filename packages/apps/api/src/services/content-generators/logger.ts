import { logger as baseLogger } from '@postolio/logger';

export const contentLogger = baseLogger.child({ module: 'content-generator' });
