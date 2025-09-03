import { z } from 'zod';
export declare const PublishRequestSchema: z.ZodObject<{
    userId: z.ZodString;
    brandId: z.ZodString;
    platform: z.ZodEnum<{}>;
    contentId: z.ZodString;
    scheduleId: z.ZodOptional<z.ZodString>;
    content: z.ZodObject<{
        caption: z.ZodString;
        mediaUrl: z.ZodOptional<z.ZodString>;
        mediaType: z.ZodOptional<z.ZodEnum<{}>>;
        hashtags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        mentions: z.ZodOptional<z.ZodArray<z.ZodString>>;
        location: z.ZodOptional<z.ZodObject<{
            latitude: z.ZodNumber;
            longitude: z.ZodNumber;
            name: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    scheduledAt: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    idempotencyKey: z.ZodString;
}, z.core.$strip>;
export type PublishRequest = z.infer<typeof PublishRequestSchema>;
export declare const PostPublishedEventSchema: z.ZodObject<{
    userId: z.ZodString;
    brandId: z.ZodString;
    contentId: z.ZodString;
    platform: z.ZodString;
    postId: z.ZodString;
    permalink: z.ZodString;
    publishedAt: z.ZodString;
}, z.core.$strip>;
export declare const PostFailedEventSchema: z.ZodObject<{
    userId: z.ZodString;
    brandId: z.ZodString;
    contentId: z.ZodString;
    platform: z.ZodString;
    error: z.ZodString;
    errorCode: z.ZodOptional<z.ZodString>;
    retryable: z.ZodBoolean;
    failedAt: z.ZodString;
}, z.core.$strip>;
export declare class ValidationError extends Error {
    errors: z.ZodError;
    constructor(errors: z.ZodError);
}
export declare function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T;
export declare const TokenRecordSchema: z.ZodObject<{
    pk: z.ZodString;
    sk: z.ZodString;
    platform: z.ZodEnum<{}>;
    encryptedAccessToken: z.ZodString;
    encryptedRefreshToken: z.ZodOptional<z.ZodString>;
    expiresAt: z.ZodNumber;
    lastRefreshed: z.ZodString;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    ttl: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type TokenRecord = z.infer<typeof TokenRecordSchema>;
export declare const ScheduleRequestSchema: z.ZodObject<{
    userId: z.ZodString;
    brandId: z.ZodString;
    contentId: z.ZodString;
    platform: z.ZodEnum<{}>;
    scheduledAt: z.ZodString;
    content: z.ZodObject<{
        caption: z.ZodString;
        mediaUrl: z.ZodOptional<z.ZodString>;
        hashtags: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
}, z.core.$strip>;
export type ScheduleRequest = z.infer<typeof ScheduleRequestSchema>;
export declare const ApiResponseSchema: <T extends z.ZodType>(dataSchema: T) => z.ZodObject<{
    success: z.ZodBoolean;
    data: z.ZodOptional<T>;
    error: z.ZodOptional<z.ZodObject<{
        message: z.ZodString;
        code: z.ZodOptional<z.ZodString>;
        details: z.ZodOptional<z.ZodAny>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ApiResponse<T> = {
    success: boolean;
    data?: T;
    error?: {
        message: string;
        code?: string;
        details?: any;
    };
};
