/**
 * Content Publishing Saga
 * Manages the distributed transaction for publishing content across platforms
 */
import { SagaContext } from '../patterns/saga-orchestrator';
export interface ContentPublishingContext extends SagaContext {
    contentId: string;
    scheduleId: string;
    platform: 'instagram' | 'facebook' | 'linkedin' | 'tiktok';
    content: {
        caption: string;
        hashtags: string[];
        mediaUrl?: string;
    };
    platformPostId?: string;
    permalink?: string;
}
export declare class ContentPublishingSaga {
    private saga;
    constructor();
    private configureSaga;
    /**
     * Execute the content publishing saga
     */
    execute(context: ContentPublishingContext): Promise<ContentPublishingContext>;
}
