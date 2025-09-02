/**
 * Event Schema Registry for Postolio Platform
 * Centralized event contract definitions for all services
 */
import { z } from 'zod';
export declare const EventMetadataSchema: z.ZodObject<{
    userId: z.ZodString;
    brandId: z.ZodString;
    correlationId: z.ZodString;
    causationId: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodString;
    version: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export declare const PlatformEventSchema: z.ZodObject<{
    id: z.ZodString;
    source: z.ZodEnum<{
        "postolio.scheduler": "postolio.scheduler";
        "postolio.token": "postolio.token";
        "postolio.content": "postolio.content";
        "postolio.platform": "postolio.platform";
        "postolio.campaign": "postolio.campaign";
        "postolio.analytics": "postolio.analytics";
    }>;
    type: z.ZodString;
    timestamp: z.ZodString;
    data: z.ZodRecord<z.ZodString, z.ZodAny>;
    metadata: z.ZodObject<{
        userId: z.ZodString;
        brandId: z.ZodString;
        correlationId: z.ZodString;
        causationId: z.ZodOptional<z.ZodString>;
        timestamp: z.ZodString;
        version: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const ContentCreatedEventSchema: z.ZodObject<{
    id: z.ZodString;
    timestamp: z.ZodString;
    metadata: z.ZodObject<{
        userId: z.ZodString;
        brandId: z.ZodString;
        correlationId: z.ZodString;
        causationId: z.ZodOptional<z.ZodString>;
        timestamp: z.ZodString;
        version: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    source: z.ZodLiteral<"postolio.content">;
    type: z.ZodLiteral<"content.created">;
    data: z.ZodObject<{
        contentId: z.ZodString;
        brandId: z.ZodString;
        caption: z.ZodString;
        hashtags: z.ZodArray<z.ZodString>;
        mediaUrl: z.ZodOptional<z.ZodString>;
        campaignId: z.ZodOptional<z.ZodString>;
        status: z.ZodEnum<{
            draft: "draft";
            scheduled: "scheduled";
            published: "published";
        }>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const ContentUpdatedEventSchema: z.ZodObject<{
    id: z.ZodString;
    timestamp: z.ZodString;
    metadata: z.ZodObject<{
        userId: z.ZodString;
        brandId: z.ZodString;
        correlationId: z.ZodString;
        causationId: z.ZodOptional<z.ZodString>;
        timestamp: z.ZodString;
        version: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    source: z.ZodLiteral<"postolio.content">;
    type: z.ZodLiteral<"content.updated">;
    data: z.ZodObject<{
        contentId: z.ZodString;
        brandId: z.ZodString;
        updates: z.ZodObject<{
            caption: z.ZodOptional<z.ZodString>;
            hashtags: z.ZodOptional<z.ZodArray<z.ZodString>>;
            mediaUrl: z.ZodOptional<z.ZodString>;
            status: z.ZodOptional<z.ZodEnum<{
                draft: "draft";
                scheduled: "scheduled";
                published: "published";
            }>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const ContentDeletedEventSchema: z.ZodObject<{
    id: z.ZodString;
    timestamp: z.ZodString;
    metadata: z.ZodObject<{
        userId: z.ZodString;
        brandId: z.ZodString;
        correlationId: z.ZodString;
        causationId: z.ZodOptional<z.ZodString>;
        timestamp: z.ZodString;
        version: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    source: z.ZodLiteral<"postolio.content">;
    type: z.ZodLiteral<"content.deleted">;
    data: z.ZodObject<{
        contentId: z.ZodString;
        brandId: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const ScheduleCreatedEventSchema: z.ZodObject<{
    id: z.ZodString;
    timestamp: z.ZodString;
    metadata: z.ZodObject<{
        userId: z.ZodString;
        brandId: z.ZodString;
        correlationId: z.ZodString;
        causationId: z.ZodOptional<z.ZodString>;
        timestamp: z.ZodString;
        version: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    source: z.ZodLiteral<"postolio.scheduler">;
    type: z.ZodLiteral<"schedule.created">;
    data: z.ZodObject<{
        scheduleId: z.ZodString;
        contentId: z.ZodString;
        brandId: z.ZodString;
        platform: z.ZodEnum<{
            instagram: "instagram";
            tiktok: "tiktok";
            facebook: "facebook";
            linkedin: "linkedin";
        }>;
        scheduledAt: z.ZodString;
        timezone: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const ScheduleUpdatedEventSchema: z.ZodObject<{
    id: z.ZodString;
    timestamp: z.ZodString;
    metadata: z.ZodObject<{
        userId: z.ZodString;
        brandId: z.ZodString;
        correlationId: z.ZodString;
        causationId: z.ZodOptional<z.ZodString>;
        timestamp: z.ZodString;
        version: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    source: z.ZodLiteral<"postolio.scheduler">;
    type: z.ZodLiteral<"schedule.updated">;
    data: z.ZodObject<{
        scheduleId: z.ZodString;
        updates: z.ZodObject<{
            scheduledAt: z.ZodOptional<z.ZodString>;
            content: z.ZodOptional<z.ZodObject<{
                caption: z.ZodOptional<z.ZodString>;
                hashtags: z.ZodOptional<z.ZodArray<z.ZodString>>;
                mediaUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const ScheduleCanceledEventSchema: z.ZodObject<{
    id: z.ZodString;
    timestamp: z.ZodString;
    metadata: z.ZodObject<{
        userId: z.ZodString;
        brandId: z.ZodString;
        correlationId: z.ZodString;
        causationId: z.ZodOptional<z.ZodString>;
        timestamp: z.ZodString;
        version: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    source: z.ZodLiteral<"postolio.scheduler">;
    type: z.ZodLiteral<"schedule.canceled">;
    data: z.ZodObject<{
        scheduleId: z.ZodString;
        contentId: z.ZodString;
        brandId: z.ZodString;
        reason: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const ScheduleReadyEventSchema: z.ZodObject<{
    id: z.ZodString;
    timestamp: z.ZodString;
    metadata: z.ZodObject<{
        userId: z.ZodString;
        brandId: z.ZodString;
        correlationId: z.ZodString;
        causationId: z.ZodOptional<z.ZodString>;
        timestamp: z.ZodString;
        version: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    source: z.ZodLiteral<"postolio.scheduler">;
    type: z.ZodLiteral<"schedule.ready">;
    data: z.ZodObject<{
        scheduleId: z.ZodString;
        contentId: z.ZodString;
        brandId: z.ZodString;
        userId: z.ZodString;
        platform: z.ZodEnum<{
            instagram: "instagram";
            tiktok: "tiktok";
            facebook: "facebook";
            linkedin: "linkedin";
        }>;
        content: z.ZodObject<{
            caption: z.ZodString;
            hashtags: z.ZodArray<z.ZodString>;
            mediaUrl: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const PostPublishedEventSchema: z.ZodObject<{
    id: z.ZodString;
    timestamp: z.ZodString;
    metadata: z.ZodObject<{
        userId: z.ZodString;
        brandId: z.ZodString;
        correlationId: z.ZodString;
        causationId: z.ZodOptional<z.ZodString>;
        timestamp: z.ZodString;
        version: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    source: z.ZodLiteral<"postolio.platform">;
    type: z.ZodLiteral<"post.published">;
    data: z.ZodObject<{
        scheduleId: z.ZodString;
        contentId: z.ZodString;
        brandId: z.ZodString;
        platform: z.ZodEnum<{
            instagram: "instagram";
            tiktok: "tiktok";
            facebook: "facebook";
            linkedin: "linkedin";
        }>;
        platformPostId: z.ZodString;
        permalink: z.ZodString;
        publishedAt: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const PostFailedEventSchema: z.ZodObject<{
    id: z.ZodString;
    timestamp: z.ZodString;
    metadata: z.ZodObject<{
        userId: z.ZodString;
        brandId: z.ZodString;
        correlationId: z.ZodString;
        causationId: z.ZodOptional<z.ZodString>;
        timestamp: z.ZodString;
        version: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    source: z.ZodLiteral<"postolio.platform">;
    type: z.ZodLiteral<"post.failed">;
    data: z.ZodObject<{
        scheduleId: z.ZodString;
        contentId: z.ZodString;
        brandId: z.ZodString;
        platform: z.ZodEnum<{
            instagram: "instagram";
            tiktok: "tiktok";
            facebook: "facebook";
            linkedin: "linkedin";
        }>;
        error: z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
            retryable: z.ZodBoolean;
        }, z.core.$strip>;
        attemptNumber: z.ZodNumber;
        nextRetryAt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const CampaignCreatedEventSchema: z.ZodObject<{
    id: z.ZodString;
    timestamp: z.ZodString;
    metadata: z.ZodObject<{
        userId: z.ZodString;
        brandId: z.ZodString;
        correlationId: z.ZodString;
        causationId: z.ZodOptional<z.ZodString>;
        timestamp: z.ZodString;
        version: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    source: z.ZodLiteral<"postolio.campaign">;
    type: z.ZodLiteral<"campaign.created">;
    data: z.ZodObject<{
        campaignId: z.ZodString;
        brandId: z.ZodString;
        name: z.ZodString;
        config: z.ZodObject<{
            duration: z.ZodNumber;
            frequency: z.ZodEnum<{
                daily: "daily";
                weekly: "weekly";
            }>;
            themes: z.ZodArray<z.ZodString>;
            priority: z.ZodNumber;
        }, z.core.$strip>;
        scheduleCount: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const CampaignStartedEventSchema: z.ZodObject<{
    id: z.ZodString;
    timestamp: z.ZodString;
    metadata: z.ZodObject<{
        userId: z.ZodString;
        brandId: z.ZodString;
        correlationId: z.ZodString;
        causationId: z.ZodOptional<z.ZodString>;
        timestamp: z.ZodString;
        version: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    source: z.ZodLiteral<"postolio.campaign">;
    type: z.ZodLiteral<"campaign.started">;
    data: z.ZodObject<{
        campaignId: z.ZodString;
        brandId: z.ZodString;
        startedAt: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const CampaignCompletedEventSchema: z.ZodObject<{
    id: z.ZodString;
    timestamp: z.ZodString;
    metadata: z.ZodObject<{
        userId: z.ZodString;
        brandId: z.ZodString;
        correlationId: z.ZodString;
        causationId: z.ZodOptional<z.ZodString>;
        timestamp: z.ZodString;
        version: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    source: z.ZodLiteral<"postolio.campaign">;
    type: z.ZodLiteral<"campaign.completed">;
    data: z.ZodObject<{
        campaignId: z.ZodString;
        brandId: z.ZodString;
        completedAt: z.ZodString;
        stats: z.ZodObject<{
            totalPosts: z.ZodNumber;
            publishedPosts: z.ZodNumber;
            failedPosts: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const TokenRefreshedEventSchema: z.ZodObject<{
    id: z.ZodString;
    timestamp: z.ZodString;
    metadata: z.ZodObject<{
        userId: z.ZodString;
        brandId: z.ZodString;
        correlationId: z.ZodString;
        causationId: z.ZodOptional<z.ZodString>;
        timestamp: z.ZodString;
        version: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    source: z.ZodLiteral<"postolio.token">;
    type: z.ZodLiteral<"token.refreshed">;
    data: z.ZodObject<{
        brandId: z.ZodString;
        platform: z.ZodEnum<{
            instagram: "instagram";
            tiktok: "tiktok";
            facebook: "facebook";
            linkedin: "linkedin";
        }>;
        expiresAt: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const TokenExpiredEventSchema: z.ZodObject<{
    id: z.ZodString;
    timestamp: z.ZodString;
    metadata: z.ZodObject<{
        userId: z.ZodString;
        brandId: z.ZodString;
        correlationId: z.ZodString;
        causationId: z.ZodOptional<z.ZodString>;
        timestamp: z.ZodString;
        version: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>;
    source: z.ZodLiteral<"postolio.token">;
    type: z.ZodLiteral<"token.expired">;
    data: z.ZodObject<{
        brandId: z.ZodString;
        platform: z.ZodEnum<{
            instagram: "instagram";
            tiktok: "tiktok";
            facebook: "facebook";
            linkedin: "linkedin";
        }>;
        expiredAt: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const EventSchemaRegistry: {
    readonly 'content.created': z.ZodObject<{
        id: z.ZodString;
        timestamp: z.ZodString;
        metadata: z.ZodObject<{
            userId: z.ZodString;
            brandId: z.ZodString;
            correlationId: z.ZodString;
            causationId: z.ZodOptional<z.ZodString>;
            timestamp: z.ZodString;
            version: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>;
        source: z.ZodLiteral<"postolio.content">;
        type: z.ZodLiteral<"content.created">;
        data: z.ZodObject<{
            contentId: z.ZodString;
            brandId: z.ZodString;
            caption: z.ZodString;
            hashtags: z.ZodArray<z.ZodString>;
            mediaUrl: z.ZodOptional<z.ZodString>;
            campaignId: z.ZodOptional<z.ZodString>;
            status: z.ZodEnum<{
                draft: "draft";
                scheduled: "scheduled";
                published: "published";
            }>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    readonly 'content.updated': z.ZodObject<{
        id: z.ZodString;
        timestamp: z.ZodString;
        metadata: z.ZodObject<{
            userId: z.ZodString;
            brandId: z.ZodString;
            correlationId: z.ZodString;
            causationId: z.ZodOptional<z.ZodString>;
            timestamp: z.ZodString;
            version: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>;
        source: z.ZodLiteral<"postolio.content">;
        type: z.ZodLiteral<"content.updated">;
        data: z.ZodObject<{
            contentId: z.ZodString;
            brandId: z.ZodString;
            updates: z.ZodObject<{
                caption: z.ZodOptional<z.ZodString>;
                hashtags: z.ZodOptional<z.ZodArray<z.ZodString>>;
                mediaUrl: z.ZodOptional<z.ZodString>;
                status: z.ZodOptional<z.ZodEnum<{
                    draft: "draft";
                    scheduled: "scheduled";
                    published: "published";
                }>>;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    readonly 'content.deleted': z.ZodObject<{
        id: z.ZodString;
        timestamp: z.ZodString;
        metadata: z.ZodObject<{
            userId: z.ZodString;
            brandId: z.ZodString;
            correlationId: z.ZodString;
            causationId: z.ZodOptional<z.ZodString>;
            timestamp: z.ZodString;
            version: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>;
        source: z.ZodLiteral<"postolio.content">;
        type: z.ZodLiteral<"content.deleted">;
        data: z.ZodObject<{
            contentId: z.ZodString;
            brandId: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
    readonly 'schedule.created': z.ZodObject<{
        id: z.ZodString;
        timestamp: z.ZodString;
        metadata: z.ZodObject<{
            userId: z.ZodString;
            brandId: z.ZodString;
            correlationId: z.ZodString;
            causationId: z.ZodOptional<z.ZodString>;
            timestamp: z.ZodString;
            version: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>;
        source: z.ZodLiteral<"postolio.scheduler">;
        type: z.ZodLiteral<"schedule.created">;
        data: z.ZodObject<{
            scheduleId: z.ZodString;
            contentId: z.ZodString;
            brandId: z.ZodString;
            platform: z.ZodEnum<{
                instagram: "instagram";
                tiktok: "tiktok";
                facebook: "facebook";
                linkedin: "linkedin";
            }>;
            scheduledAt: z.ZodString;
            timezone: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
    readonly 'schedule.updated': z.ZodObject<{
        id: z.ZodString;
        timestamp: z.ZodString;
        metadata: z.ZodObject<{
            userId: z.ZodString;
            brandId: z.ZodString;
            correlationId: z.ZodString;
            causationId: z.ZodOptional<z.ZodString>;
            timestamp: z.ZodString;
            version: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>;
        source: z.ZodLiteral<"postolio.scheduler">;
        type: z.ZodLiteral<"schedule.updated">;
        data: z.ZodObject<{
            scheduleId: z.ZodString;
            updates: z.ZodObject<{
                scheduledAt: z.ZodOptional<z.ZodString>;
                content: z.ZodOptional<z.ZodObject<{
                    caption: z.ZodOptional<z.ZodString>;
                    hashtags: z.ZodOptional<z.ZodArray<z.ZodString>>;
                    mediaUrl: z.ZodOptional<z.ZodString>;
                }, z.core.$strip>>;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    readonly 'schedule.canceled': z.ZodObject<{
        id: z.ZodString;
        timestamp: z.ZodString;
        metadata: z.ZodObject<{
            userId: z.ZodString;
            brandId: z.ZodString;
            correlationId: z.ZodString;
            causationId: z.ZodOptional<z.ZodString>;
            timestamp: z.ZodString;
            version: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>;
        source: z.ZodLiteral<"postolio.scheduler">;
        type: z.ZodLiteral<"schedule.canceled">;
        data: z.ZodObject<{
            scheduleId: z.ZodString;
            contentId: z.ZodString;
            brandId: z.ZodString;
            reason: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    readonly 'schedule.ready': z.ZodObject<{
        id: z.ZodString;
        timestamp: z.ZodString;
        metadata: z.ZodObject<{
            userId: z.ZodString;
            brandId: z.ZodString;
            correlationId: z.ZodString;
            causationId: z.ZodOptional<z.ZodString>;
            timestamp: z.ZodString;
            version: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>;
        source: z.ZodLiteral<"postolio.scheduler">;
        type: z.ZodLiteral<"schedule.ready">;
        data: z.ZodObject<{
            scheduleId: z.ZodString;
            contentId: z.ZodString;
            brandId: z.ZodString;
            userId: z.ZodString;
            platform: z.ZodEnum<{
                instagram: "instagram";
                tiktok: "tiktok";
                facebook: "facebook";
                linkedin: "linkedin";
            }>;
            content: z.ZodObject<{
                caption: z.ZodString;
                hashtags: z.ZodArray<z.ZodString>;
                mediaUrl: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    readonly 'post.published': z.ZodObject<{
        id: z.ZodString;
        timestamp: z.ZodString;
        metadata: z.ZodObject<{
            userId: z.ZodString;
            brandId: z.ZodString;
            correlationId: z.ZodString;
            causationId: z.ZodOptional<z.ZodString>;
            timestamp: z.ZodString;
            version: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>;
        source: z.ZodLiteral<"postolio.platform">;
        type: z.ZodLiteral<"post.published">;
        data: z.ZodObject<{
            scheduleId: z.ZodString;
            contentId: z.ZodString;
            brandId: z.ZodString;
            platform: z.ZodEnum<{
                instagram: "instagram";
                tiktok: "tiktok";
                facebook: "facebook";
                linkedin: "linkedin";
            }>;
            platformPostId: z.ZodString;
            permalink: z.ZodString;
            publishedAt: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
    readonly 'post.failed': z.ZodObject<{
        id: z.ZodString;
        timestamp: z.ZodString;
        metadata: z.ZodObject<{
            userId: z.ZodString;
            brandId: z.ZodString;
            correlationId: z.ZodString;
            causationId: z.ZodOptional<z.ZodString>;
            timestamp: z.ZodString;
            version: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>;
        source: z.ZodLiteral<"postolio.platform">;
        type: z.ZodLiteral<"post.failed">;
        data: z.ZodObject<{
            scheduleId: z.ZodString;
            contentId: z.ZodString;
            brandId: z.ZodString;
            platform: z.ZodEnum<{
                instagram: "instagram";
                tiktok: "tiktok";
                facebook: "facebook";
                linkedin: "linkedin";
            }>;
            error: z.ZodObject<{
                code: z.ZodString;
                message: z.ZodString;
                retryable: z.ZodBoolean;
            }, z.core.$strip>;
            attemptNumber: z.ZodNumber;
            nextRetryAt: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    readonly 'campaign.created': z.ZodObject<{
        id: z.ZodString;
        timestamp: z.ZodString;
        metadata: z.ZodObject<{
            userId: z.ZodString;
            brandId: z.ZodString;
            correlationId: z.ZodString;
            causationId: z.ZodOptional<z.ZodString>;
            timestamp: z.ZodString;
            version: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>;
        source: z.ZodLiteral<"postolio.campaign">;
        type: z.ZodLiteral<"campaign.created">;
        data: z.ZodObject<{
            campaignId: z.ZodString;
            brandId: z.ZodString;
            name: z.ZodString;
            config: z.ZodObject<{
                duration: z.ZodNumber;
                frequency: z.ZodEnum<{
                    daily: "daily";
                    weekly: "weekly";
                }>;
                themes: z.ZodArray<z.ZodString>;
                priority: z.ZodNumber;
            }, z.core.$strip>;
            scheduleCount: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>;
    readonly 'campaign.started': z.ZodObject<{
        id: z.ZodString;
        timestamp: z.ZodString;
        metadata: z.ZodObject<{
            userId: z.ZodString;
            brandId: z.ZodString;
            correlationId: z.ZodString;
            causationId: z.ZodOptional<z.ZodString>;
            timestamp: z.ZodString;
            version: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>;
        source: z.ZodLiteral<"postolio.campaign">;
        type: z.ZodLiteral<"campaign.started">;
        data: z.ZodObject<{
            campaignId: z.ZodString;
            brandId: z.ZodString;
            startedAt: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
    readonly 'campaign.completed': z.ZodObject<{
        id: z.ZodString;
        timestamp: z.ZodString;
        metadata: z.ZodObject<{
            userId: z.ZodString;
            brandId: z.ZodString;
            correlationId: z.ZodString;
            causationId: z.ZodOptional<z.ZodString>;
            timestamp: z.ZodString;
            version: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>;
        source: z.ZodLiteral<"postolio.campaign">;
        type: z.ZodLiteral<"campaign.completed">;
        data: z.ZodObject<{
            campaignId: z.ZodString;
            brandId: z.ZodString;
            completedAt: z.ZodString;
            stats: z.ZodObject<{
                totalPosts: z.ZodNumber;
                publishedPosts: z.ZodNumber;
                failedPosts: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strip>;
    }, z.core.$strip>;
    readonly 'token.refreshed': z.ZodObject<{
        id: z.ZodString;
        timestamp: z.ZodString;
        metadata: z.ZodObject<{
            userId: z.ZodString;
            brandId: z.ZodString;
            correlationId: z.ZodString;
            causationId: z.ZodOptional<z.ZodString>;
            timestamp: z.ZodString;
            version: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>;
        source: z.ZodLiteral<"postolio.token">;
        type: z.ZodLiteral<"token.refreshed">;
        data: z.ZodObject<{
            brandId: z.ZodString;
            platform: z.ZodEnum<{
                instagram: "instagram";
                tiktok: "tiktok";
                facebook: "facebook";
                linkedin: "linkedin";
            }>;
            expiresAt: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
    readonly 'token.expired': z.ZodObject<{
        id: z.ZodString;
        timestamp: z.ZodString;
        metadata: z.ZodObject<{
            userId: z.ZodString;
            brandId: z.ZodString;
            correlationId: z.ZodString;
            causationId: z.ZodOptional<z.ZodString>;
            timestamp: z.ZodString;
            version: z.ZodDefault<z.ZodString>;
        }, z.core.$strip>;
        source: z.ZodLiteral<"postolio.token">;
        type: z.ZodLiteral<"token.expired">;
        data: z.ZodObject<{
            brandId: z.ZodString;
            platform: z.ZodEnum<{
                instagram: "instagram";
                tiktok: "tiktok";
                facebook: "facebook";
                linkedin: "linkedin";
            }>;
            expiredAt: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
};
export type PlatformEvent = z.infer<typeof PlatformEventSchema>;
export type ContentCreatedEvent = z.infer<typeof ContentCreatedEventSchema>;
export type ContentUpdatedEvent = z.infer<typeof ContentUpdatedEventSchema>;
export type ContentDeletedEvent = z.infer<typeof ContentDeletedEventSchema>;
export type ScheduleCreatedEvent = z.infer<typeof ScheduleCreatedEventSchema>;
export type ScheduleUpdatedEvent = z.infer<typeof ScheduleUpdatedEventSchema>;
export type ScheduleCanceledEvent = z.infer<typeof ScheduleCanceledEventSchema>;
export type ScheduleReadyEvent = z.infer<typeof ScheduleReadyEventSchema>;
export type PostPublishedEvent = z.infer<typeof PostPublishedEventSchema>;
export type PostFailedEvent = z.infer<typeof PostFailedEventSchema>;
export type CampaignCreatedEvent = z.infer<typeof CampaignCreatedEventSchema>;
export type CampaignStartedEvent = z.infer<typeof CampaignStartedEventSchema>;
export type CampaignCompletedEvent = z.infer<typeof CampaignCompletedEventSchema>;
export type TokenRefreshedEvent = z.infer<typeof TokenRefreshedEventSchema>;
export type TokenExpiredEvent = z.infer<typeof TokenExpiredEventSchema>;
export declare function validateEvent(eventType: string, eventData: unknown): PlatformEvent;
export declare class EventBuilder {
    static createEvent<T extends keyof typeof EventSchemaRegistry>(type: T, data: any, metadata: z.infer<typeof EventMetadataSchema>): PlatformEvent;
    private static getSourceFromType;
}
