/**
 * Midjourney API Mock for Testing
 * Provides consistent mock responses for all Midjourney API calls
 */
export declare const mockMidjourneyResponse: {
    success: boolean;
    messageId: string;
    uri: string;
    status: string;
    progress: string;
    content: string;
};
export declare const mockMidjourneyProgress: {
    success: boolean;
    messageId: string;
    status: string;
    progress: string;
    uri: null;
};
export declare const mockMidjourneyError: {
    success: boolean;
    error: string;
    messageId: null;
    status: string;
};
export declare class MockMidjourney {
    imagine(prompt: string, options?: any): Promise<{
        success: boolean;
        error: string;
        messageId: null;
        status: string;
    } | {
        content: string;
        success: boolean;
        messageId: string;
        uri: string;
        status: string;
        progress: string;
    }>;
    upscale(messageId: string, index: number): Promise<{
        success: boolean;
        messageId: string;
        uri: string;
        status: string;
        progress: string;
    }>;
    getResult(messageId: string): Promise<{
        success: boolean;
        messageId: string;
        status: string;
        progress: string;
        uri: null;
    } | {
        messageId: string;
        success: boolean;
        uri: string;
        status: string;
        progress: string;
        content: string;
    }>;
    info(): Promise<{
        success: boolean;
        subscription: string;
        job_mode: string;
        visibility: string;
        fast_time_remaining: string;
        lifetime_usage: string;
        relaxed_usage: string;
    }>;
}
export declare const mockMidjourney: MockMidjourney;
