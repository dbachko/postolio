import { FastifyPluginAsync } from 'fastify';

import { campaignService, type CampaignConfig } from '../services/campaign.js';
import { CampaignStatus } from '@postolio/database';
// import { campaignJobService } from '../services/campaign-jobs.js';
import { pauseResumeRateLimiter, campaignRateLimiter } from '../services/rate-limiter.js';
import { validateBody, validateQuery } from '../middleware/validation.js';
import { z } from 'zod';
import { validateCampaignUpdateRequest } from '../utils/campaign-validation.js';
import { regenerationService } from '../services/regeneration-queue.js';
import { TimezoneService } from '../services/timezone.js';
import {
  AnalyzeGoalSchema,
  GenerateStrategySchema,
  analyzeGoal as analyzeGoalSvc,
  generateStrategy as generateStrategySvc,
} from '../services/campaign-strategy.js';
import { suggestGoals, ensureGoals, storeUserGoals } from '../services/goal-suggester.js';
import { storeUserThemes } from '../services/theme-suggester.js';
import type { CampaignType } from '../services/goal-templates.js';

import { getDatabaseClient } from '../config/database.js';
import { campaignSlidingWindowService } from '../services/campaign-sliding-window.js';

const prisma = getDatabaseClient();

interface PreviewCampaignBody {
  configId: string;
  exampleCount?: number;
}

const campaignRoutes: FastifyPluginAsync = async (fastify) => {
  const sanitizeGoalsValue = (val: unknown): string | string[] | undefined => {
    if (Array.isArray(val)) {
      const arr = (val as unknown[])
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return arr.length ? arr : undefined;
    }
    if (typeof val === 'string') {
      const t = val.trim();
      return t.length ? t : undefined;
    }
    return undefined;
  };
  const toGoalArray = (val: unknown): string[] => {
    if (Array.isArray(val)) {
      return (val as unknown[])
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    if (typeof val === 'string') {
      return val
        .split(/[\n;]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return [];
  };
  const toThemeArray = (val: unknown): string[] => {
    if (Array.isArray(val)) {
      return (val as unknown[])
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    if (typeof val === 'string') {
      return val
        .split(/[\n;,]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return [];
  };
  const ConfigureSchema = z.object({
    name: z
      .string()
      .min(1)
      .optional()
      .or(z.literal(''))
      .transform((val) => (val === '' ? undefined : val)), // Transform empty string to undefined for auto-generation
    brandId: z.string().min(1),
    campaignType: z
      .enum(['promotional', 'educational', 'seasonal', 'thought_leadership', 'custom'])
      .optional(),
    duration: z.object({ start: z.string().min(1), end: z.string().min(1) }),
    frequency: z.string().min(1),
    themes: z.array(z.string()).min(1),
    // Style is optional; brand profile projection now drives tone/voice
    style: z.string().optional(),
    postingTime: z.string().regex(/^\d{2}:\d{2}$/),
    priority: z.number().int().min(1).max(10).optional(),
    // Accept goals as single string or array from the wizard; normalize later
    goals: z.union([z.string().max(2000), z.array(z.string()).min(1)]).optional(),
    seasonalityAssist: z.boolean().optional(),
    promotionDetails: z
      .object({
        discountPercentage: z.number().int().min(0).max(100).optional(),
        promoCode: z.string().max(64).optional(),
        limitedQuantity: z.boolean().optional(),
      })
      .optional(),
    // Optional content pillars (manual input in Phase 1)
    contentPillars: z
      .object({
        pillars: z
          .array(
            z.object({
              name: z.string().min(1),
              percentage: z.number().min(0).max(100),
              themes: z.array(z.string()).optional(),
            })
          )
          .min(1),
      })
      .optional(),
  });

  type ConfigureBody = z.infer<typeof ConfigureSchema>;

  // Configure campaign (RESTful: POST /)
  fastify.post<{ Body: ConfigureBody }>(
    '/',
    {
      preHandler: [
        fastify.authenticate,
        async (request) => {
          // Sanitize goals without using `any` by mutating the same reference
          const rawUnknown = request.body as ConfigureBody;
          if (rawUnknown && typeof rawUnknown === 'object') {
            const container = rawUnknown as ConfigureBody & { goals?: unknown };
            if (Object.prototype.hasOwnProperty.call(container, 'goals')) {
              const sanitized = sanitizeGoalsValue(container.goals);
              if (sanitized === undefined) delete container.goals;
              else container.goals = sanitized;
            }
          }
        },
        validateBody(ConfigureSchema),
      ],
    },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const body = request.body;
        const userProvidedGoals = toGoalArray(body.goals);

        // Gate campaign creation until Instagram is connected
        // 1) Verify brand ownership
        const brandForConnCheck = await prisma.brand.findFirst({
          where: { id: body.brandId, userId },
          select: { id: true },
        });
        if (!brandForConnCheck) {
          return reply.code(404).send({ error: 'Brand not found or access denied' });
        }

        // 2) Check if Instagram is connected via SocialAccount
        const instagramAccount = await prisma.socialAccount.findFirst({
          where: {
            brandId: body.brandId,
            platform: 'instagram',
          },
        });
        if (!instagramAccount) {
          return reply.code(400).send({
            error: 'Instagram not connected for this brand',
            code: 'INSTAGRAM_NOT_CONNECTED',
            help: 'Connect an Instagram Business account to enable campaign creation.',
          });
        }

        // Token validity checks intentionally omitted here; only connection presence is required

        // Get brand's timezone for proper date interpretation
        // If brand doesn't have a timezone set, fall back to user's detected timezone
        let brandTimezone = await TimezoneService.getBrandTimezone(body.brandId);

        // If brand timezone is UTC (default) and we have user's timezone from header, use that
        if (brandTimezone === 'UTC') {
          const detectedTimezone = await TimezoneService.detectTimezone(request, userId);
          if (detectedTimezone !== 'UTC') {
            brandTimezone = detectedTimezone;

            // Save the detected timezone to BOTH brand and user for future use
            await Promise.all([
              // Update brand timezone
              prisma.brand.update({
                where: { id: body.brandId },
                data: { postingTimezone: detectedTimezone },
              }),
              // Update user timezone as auto-detected (if not already set)
              prisma.user.update({
                where: {
                  id: userId,
                  // Only update if user doesn't have a manually set timezone
                  OR: [{ timezone: null }, { timezone: 'UTC' }, { timezoneAutoDetected: true }],
                },
                data: {
                  timezone: detectedTimezone,
                  timezoneAutoDetected: true,
                },
              }),
            ]);
            console.log(
              `Auto-detected and saved timezone ${detectedTimezone} for user ${userId} and brand ${body.brandId}`
            );
          }
        }

        console.log(
          `Campaign configuration using timezone: ${brandTimezone} for brand ${body.brandId}`
        );

        // Auto-generate goals if none provided (Lazy Defaults approach)
        let finalGoals: string | string[] | undefined = body.goals;
        if (
          body.campaignType &&
          (!finalGoals || (Array.isArray(finalGoals) && finalGoals.length === 0))
        ) {
          try {
            // Convert string goals to array format for ensureGoals
            const goalsArray: string[] | undefined = Array.isArray(finalGoals)
              ? finalGoals
              : typeof finalGoals === 'string'
                ? [finalGoals]
                : undefined;

            const generatedGoals = await ensureGoals({
              goals: goalsArray,
              campaignType: body.campaignType as CampaignType,
              brandId: body.brandId,
            });
            finalGoals = generatedGoals;
            console.log(`Auto-generated ${generatedGoals.length} goals for campaign`, {
              brandId: body.brandId,
              campaignType: body.campaignType,
              goals: generatedGoals,
            });
          } catch (error) {
            console.error('Failed to auto-generate goals, proceeding without goals', { error });
          }
        }

        // Convert date strings to Date objects with timezone awareness
        const goalsText = Array.isArray(finalGoals) ? finalGoals.join('; ') : finalGoals;

        const config: CampaignConfig = {
          name: body.name,
          brandId: body.brandId,
          duration: {
            start: TimezoneService.parseTimezoneAwareDate(body.duration.start, brandTimezone),
            end: TimezoneService.parseTimezoneAwareDate(body.duration.end, brandTimezone),
          },
          frequency: body.frequency,
          themes: body.themes,
          ...(body.style && body.style.trim().length > 0 ? { style: body.style } : {}),
          postingTime: body.postingTime,
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          // Wizard-enhanced fields
          ...(body.campaignType ? { campaignType: body.campaignType } : {}),
          ...(body.promotionDetails ? { urgencyTactics: body.promotionDetails } : {}),
          ...(body.contentPillars ? { contentPillars: body.contentPillars } : {}),
          ...(goalsText ? { goals: goalsText } : {}),
          ...(body.seasonalityAssist !== undefined
            ? { seasonalityAssist: body.seasonalityAssist }
            : {}),
        };

        // Validate campaign configuration
        const validationErrors = campaignService.validateCampaignConfig(config);

        if (validationErrors.length > 0) {
          return reply.code(400).send({
            error: 'Validation failed',
            details: validationErrors,
          });
        }

        // Create campaign, passing the detected timezone
        const campaign = await campaignService.configureCampaign(config, userId, brandTimezone);

        if (userProvidedGoals.length) {
          await storeUserGoals(body.brandId, userProvidedGoals);
        }
        if (Array.isArray(body.themes) && body.themes.length) {
          await storeUserThemes(body.brandId, toThemeArray(body.themes));
        }

        return reply.code(201).send({
          success: true,
          campaign: {
            id: campaign.id,
            name: campaign.name,
            brandId: campaign.brandId,
            status: campaign.status,
            config: campaign.config,
            createdAt: campaign.createdAt,
            brand: campaign.brand,
          },
        });
      } catch (error) {
        console.error('Campaign configuration error:', error);

        if (error instanceof Error) {
          if (error.message.includes('Authentication')) {
            return reply.code(401).send({ error: error.message });
          }
          if (
            error.message.includes('Brand not found') ||
            error.message.includes('access denied')
          ) {
            return reply.code(404).send({ error: 'Brand not found or access denied' });
          }
          if (error.message.includes('start date') || error.message.includes('end date')) {
            return reply.code(400).send({ error: error.message });
          }
        }

        return reply.code(500).send({
          error: 'Failed to configure campaign. Please try again.',
        });
      }
    }
  );

  // Generate campaign preview
  fastify.post<{ Body: PreviewCampaignBody }>(
    '/preview',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { configId, exampleCount = 3 } = request.body;

        if (!configId) {
          return reply.code(400).send({ error: 'Campaign ID is required' });
        }

        if (exampleCount < 1 || exampleCount > 10) {
          return reply.code(400).send({ error: 'Example count must be between 1 and 10' });
        }

        const preview = await campaignService.generateCampaignPreview(
          configId,
          userId,
          exampleCount
        );

        return reply.send({
          success: true,
          preview,
        });
      } catch (error) {
        console.error('Campaign preview error:', error);

        if (error instanceof Error) {
          if (error.message.includes('Authentication')) {
            return reply.code(401).send({ error: error.message });
          }
          if (error.message.includes('not found') || error.message.includes('access denied')) {
            return reply.code(404).send({ error: 'Campaign not found or access denied' });
          }
          if (error.message.includes('style profile')) {
            return reply.code(400).send({ error: error.message });
          }
        }

        return reply.code(500).send({
          error: 'Failed to generate campaign preview. Please try again.',
        });
      }
    }
  );

  // Analyze natural-language campaign goal (Phase 2)
  fastify.post<{ Body: z.infer<typeof AnalyzeGoalSchema> }>(
    '/analyze-goal',
    { preHandler: [fastify.authenticate, validateBody(AnalyzeGoalSchema)] },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const body = request.body;

        // Verify brand ownership
        const brand = await prisma.brand.findFirst({ where: { id: body.brandId, userId } });
        if (!brand) return reply.code(403).send({ error: 'Access denied' });

        const result = await analyzeGoalSvc(body);
        return reply.send({ success: true, analysis: result });
      } catch (error) {
        request.log.error({ error }, 'analyze-goal failed');
        return reply.code(500).send({ error: 'Failed to analyze goal' });
      }
    }
  );

  // Generate AI strategy (Phase 2)
  // Generate strategy (RESTful path)
  fastify.post<{ Body: z.infer<typeof GenerateStrategySchema> }>(
    '/strategy',
    {
      preHandler: [
        fastify.authenticate,
        async (request) => {
          const rawUnknown = request.body as unknown;
          if (rawUnknown && typeof rawUnknown === 'object') {
            const container = rawUnknown as Record<string, unknown> & { goals?: unknown };
            if (Object.prototype.hasOwnProperty.call(container, 'goals')) {
              const sanitized = sanitizeGoalsValue(container.goals);
              if (sanitized === undefined) delete container.goals;
              else container.goals = sanitized;
            }
          }
        },
        validateBody(GenerateStrategySchema),
      ],
    },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const body = request.body;

        // Verify brand ownership
        const brand = await prisma.brand.findFirst({ where: { id: body.brandId, userId } });
        if (!brand) return reply.code(403).send({ error: 'Access denied' });

        const strategy = await generateStrategySvc(body);
        return reply.send({ success: true, strategy });
      } catch (error) {
        request.log.error({ error }, 'generate-strategy failed');
        return reply.code(500).send({ error: 'Failed to generate strategy' });
      }
    }
  );

  // Suggest campaign goals (AI-powered suggestions)
  const SuggestGoalsSchema = z.object({
    brandId: z.string().min(1),
    campaignType: z.enum([
      'promotional',
      'educational',
      'seasonal',
      'thought_leadership',
      'custom',
    ]),
    limit: z
      .string()
      .optional()
      .transform((val) => (val ? parseInt(val, 10) : undefined))
      .refine((val) => val === undefined || (val >= 1 && val <= 20), {
        message: 'Limit must be between 1 and 20',
      }),
  });

  fastify.get<{ Querystring: z.infer<typeof SuggestGoalsSchema> }>(
    '/suggest-goals',
    { preHandler: [fastify.authenticate, validateQuery(SuggestGoalsSchema)] },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { brandId, campaignType, limit } = request.query;

        // Verify brand ownership
        const brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
        if (!brand) return reply.code(403).send({ error: 'Access denied' });

        // Get goal suggestions
        const suggestions = await suggestGoals({
          brandId,
          campaignType: campaignType as CampaignType,
          limit,
        });

        return reply.send({
          success: true,
          suggestions,
        });
      } catch (error) {
        request.log.error({ error }, 'suggest-goals failed');
        return reply.code(500).send({ error: 'Failed to suggest goals' });
      }
    }
  );

  // Campaign drafts feature removed intentionally (frontend no longer uses it)

  // Start campaign (REST: /:id/start)
  fastify.post<{ Params: { id: string } }>(
    '/:id/start',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id: campaignId } = request.params;

        const result = await campaignService.startCampaign(campaignId, userId);

        if (!result.success) {
          if (result.error?.includes('not found') || result.error?.includes('access denied')) {
            return reply.code(404).send({ error: result.error });
          }
          if (result.error?.includes('style profile')) {
            return reply.code(400).send({ error: result.error });
          }
          return reply.code(400).send({ error: result.error || 'Failed to start campaign' });
        }

        // Maintain sliding window after start (generate next posts to keep window full)
        try {
          await campaignSlidingWindowService.maintainWindow(campaignId);
        } catch (e) {
          request.log.warn({ err: e }, 'Sliding window generation after start failed');
        }

        return reply.send({
          success: true,
          campaign: result.campaign,
          scheduledPosts: result.scheduledPosts,
          message: `Campaign started successfully. ${result.scheduledPosts} posts have been scheduled.`,
        });
      } catch (error) {
        console.error('Campaign start error:', error);

        if (error instanceof Error) {
          if (error.message.includes('Authentication')) {
            return reply.code(401).send({ error: error.message });
          }
        }

        return reply.code(500).send({
          error: 'Failed to start campaign. Please try again.',
        });
      }
    }
  );

  // Fill sliding window for a campaign (manual trigger)
  fastify.post<{ Params: { id: string } }>(
    '/:id/fill-window',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id: campaignId } = request.params;

        if (!campaignId) {
          return reply.code(400).send({ error: 'Campaign ID is required' });
        }

        // Verify ownership
        const campaign = await prisma.campaign.findFirst({
          where: { id: campaignId, brand: { userId } },
          select: { id: true, status: true },
        });
        if (!campaign)
          return reply.code(404).send({ error: 'Campaign not found or access denied' });

        if (campaign.status !== 'active') {
          return reply
            .code(400)
            .send({ error: 'Only active campaigns can fill the scheduling window.' });
        }

        const res = await campaignSlidingWindowService.maintainWindow(campaignId, 3);
        return reply.send({ success: res.success, generated: res.generated, message: res.message });
      } catch (error) {
        request.log.error({ error }, 'fill-window failed');
        return reply.code(500).send({ error: 'Failed to fill sliding window' });
      }
    }
  );

  // Get campaign details
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id } = request.params;

        if (!id) {
          return reply.code(400).send({ error: 'Campaign ID is required' });
        }

        const campaign = await campaignService.getCampaign(id, userId);

        return reply.send({
          success: true,
          campaign,
        });
      } catch (error) {
        console.error('Get campaign error:', error);

        if (error instanceof Error) {
          if (error.message.includes('Authentication')) {
            return reply.code(401).send({ error: error.message });
          }
          if (error.message.includes('not found') || error.message.includes('access denied')) {
            return reply.code(404).send({ error: 'Campaign not found or access denied' });
          }
        }

        return reply.code(500).send({
          error: 'Failed to retrieve campaign details. Please try again.',
        });
      }
    }
  );

  // Update campaign configuration
  interface UpdateCampaignBody {
    status?: 'active' | 'paused' | 'completed' | 'draft';
    themes?: string[];
    style?: string;
    frequency?: string;
    postingTime?: string;
    duration?: { start: string; end: string };
    priority?: number;
  }
  fastify.put<{ Params: { id: string }; Body: UpdateCampaignBody }>(
    '/:id',
    {
      preHandler: [
        fastify.authenticate,
        async (request) => {
          const rawUnknown = request.body as unknown;
          if (rawUnknown && typeof rawUnknown === 'object') {
            const container = rawUnknown as Record<string, unknown> & { goals?: unknown };
            if (Object.prototype.hasOwnProperty.call(container, 'goals')) {
              const sanitized = sanitizeGoalsValue(container.goals);
              if (sanitized === undefined) delete container.goals;
              else container.goals = sanitized;
            }
          }
        },
      ],
    },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id } = request.params;

        if (!id) {
          return reply.code(400).send({ error: 'Campaign ID is required' });
        }

        // Validate request schema
        const validation = validateCampaignUpdateRequest(request.body);
        if (!validation.valid) {
          return reply.code(400).send({
            error: 'Invalid request data',
            details: validation.errors.map((err) => ({
              field: err.field,
              message: err.message,
              ...(err.value !== undefined ? { value: err.value } : {}),
            })),
          });
        }

        const updates = validation.sanitizedData!;

        const campaignMeta = await prisma.campaign.findFirst({
          where: { id, brand: { userId } },
          select: { brandId: true },
        });

        if (!campaignMeta) {
          return reply.code(404).send({ error: 'Campaign not found or access denied' });
        }

        const updatedGoalList = toGoalArray(updates.goals);
        const normalizedGoals: string | undefined =
          updatedGoalList.length > 0 ? updatedGoalList.join('; ') : undefined;
        if (normalizedGoals) {
          updates.goals = normalizedGoals;
          await storeUserGoals(campaignMeta.brandId, updatedGoalList);
        } else if (updates.goals !== undefined) {
          delete updates.goals;
        }

        const updatedThemes = toThemeArray(updates.themes as unknown);
        if (updatedThemes.length > 0) {
          updates.themes = updatedThemes;
          await storeUserThemes(campaignMeta.brandId, updatedThemes);
        } else if (updates.themes !== undefined) {
          updates.themes = undefined;
        }

        // Apply rate limiting for pause/resume operations
        if (updates.status && ['paused', 'active'].includes(updates.status)) {
          const rateLimitCheck = await pauseResumeRateLimiter.checkRateLimit(userId);
          if (!rateLimitCheck.allowed) {
            reply.header('X-RateLimit-Limit', 20);
            reply.header('X-RateLimit-Remaining', rateLimitCheck.remaining);
            reply.header(
              'X-RateLimit-Reset',
              Math.floor(rateLimitCheck.resetTime.getTime() / 1000)
            );
            reply.header('Retry-After', rateLimitCheck.retryAfter || 300);

            return reply.code(429).send({
              error: 'Too many pause/resume requests',
              message: `Rate limit exceeded. Try again in ${rateLimitCheck.retryAfter || 300} seconds.`,
              retryAfter: rateLimitCheck.retryAfter || 300,
            });
          }
        } else {
          // Apply general campaign rate limiting for other updates
          const rateLimitCheck = await campaignRateLimiter.checkRateLimit(userId);
          if (!rateLimitCheck.allowed) {
            reply.header('X-RateLimit-Limit', 10);
            reply.header('X-RateLimit-Remaining', rateLimitCheck.remaining);
            reply.header(
              'X-RateLimit-Reset',
              Math.floor(rateLimitCheck.resetTime.getTime() / 1000)
            );
            reply.header('Retry-After', rateLimitCheck.retryAfter || 60);

            return reply.code(429).send({
              error: 'Too many campaign requests',
              message: `Rate limit exceeded. Try again in ${rateLimitCheck.retryAfter || 60} seconds.`,
              retryAfter: rateLimitCheck.retryAfter || 60,
            });
          }
        }

        // Choose the appropriate update method based on the type of update
        type UpdateResult = {
          success: boolean;
          message?: string;
          campaign?: unknown;
        };
        type RegenResult = {
          campaign: unknown;
          regenerationTriggered: boolean;
          regenerationReason?: string;
          message?: string;
        };
        let rawResult: UpdateResult | RegenResult;
        const { goals: rawGoals, ...restUpdates } = updates as typeof updates & {
          goals?: string | string[];
        };
        const goalsField = typeof rawGoals === 'string' ? rawGoals : undefined;
        const updatesForService: typeof restUpdates & { goals?: string } = {
          ...restUpdates,
          ...(goalsField ? { goals: goalsField } : {}),
        };

        const statusVal = updatesForService.status as CampaignStatus | undefined;
        if (statusVal && ['paused', 'active'].includes(statusVal)) {
          rawResult = await campaignService.updateCampaign(id, userId, {
            ...updatesForService,
            status: statusVal,
          });
        } else {
          const { status: _ignoredStatus, ...rest } = updatesForService; // status handled only by direct update path
          void _ignoredStatus;
          rawResult = await campaignService.updateCampaignWithRegeneration(id, rest, userId);
        }

        const unified =
          (rawResult as UpdateResult).success !== undefined
            ? {
                success: (rawResult as UpdateResult).success,
                campaign: (rawResult as UpdateResult).campaign,
                message: (rawResult as UpdateResult).message || 'Campaign updated successfully',
                regenerationTriggered: false,
                regenerationReason: undefined,
              }
            : {
                success: true,
                campaign: (rawResult as RegenResult).campaign,
                message: (rawResult as RegenResult).message || 'Campaign updated successfully',
                regenerationTriggered: (rawResult as RegenResult).regenerationTriggered,
                regenerationReason: (rawResult as RegenResult).regenerationReason,
              };

        return reply.send(unified);
      } catch (error) {
        console.error('Update campaign error:', error);

        if (error instanceof Error) {
          if (error.message.includes('Authentication')) {
            return reply.code(401).send({ error: error.message });
          }
          if (error.message.includes('not found') || error.message.includes('access denied')) {
            return reply.code(404).send({ error: 'Campaign not found or access denied' });
          }
          if (
            error.message.includes('cannot be updated') ||
            error.message.includes('already active')
          ) {
            return reply.code(400).send({ error: error.message });
          }
          if (error.message.includes('Invalid status transition')) {
            return reply.code(400).send({ error: error.message });
          }
        }

        return reply.code(500).send({
          error: 'Failed to update campaign. Please try again.',
        });
      }
    }
  );

  // List user's campaigns (REST: GET /)
  fastify.get<{ Querystring: { brandId?: string } }>(
    '/',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { brandId } = request.query;

        // Build where clause - filter by brandId if provided, otherwise show all user's campaigns
        const whereClause: { brand: { userId: string }; brandId?: string } = {
          brand: {
            userId,
          },
        };

        if (brandId) {
          // Verify the user owns this brand before filtering
          const brand = await prisma.brand.findFirst({
            where: {
              id: brandId,
              userId,
            },
          });

          if (!brand) {
            return reply.code(404).send({ error: 'Brand not found or access denied' });
          }

          whereClause.brandId = brandId;
        }

        const campaigns = await prisma.campaign.findMany({
          where: whereClause,
          include: {
            brand: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        });

        // Aggregate content counts by status for returned campaign list
        const campaignIds = campaigns.map((c) => c.id);
        const statusCounts = campaignIds.length
          ? await prisma.content.groupBy({
              by: ['campaignId', 'status'],
              where: { campaignId: { in: campaignIds } },
              _count: { _all: true },
            })
          : [];

        const countsMap = new Map<
          string,
          { total: number; scheduled: number; published: number; draft: number }
        >();
        for (const id of campaignIds) {
          countsMap.set(id, { total: 0, scheduled: 0, published: 0, draft: 0 });
        }
        for (const row of statusCounts as Array<{
          campaignId: string;
          status: string;
          _count: { _all: number };
        }>) {
          const entry = countsMap.get(row.campaignId);
          if (!entry) continue;
          entry.total += row._count._all;
          if (row.status === 'scheduled') entry.scheduled += row._count._all;
          if (row.status === 'published') entry.published += row._count._all;
          if (row.status === 'draft') entry.draft += row._count._all;
        }

        return reply.send({
          success: true,
          campaigns: campaigns.map((campaign) => ({
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            brandId: campaign.brandId,
            brand: campaign.brand,
            color: (campaign as any).color || null,
            contentCount: countsMap.get(campaign.id)?.total ?? 0,
            scheduledCount: countsMap.get(campaign.id)?.scheduled ?? 0,
            publishedCount: countsMap.get(campaign.id)?.published ?? 0,
            config: campaign.config,
            createdAt: campaign.createdAt,
            startedAt: campaign.startedAt,
            completedAt: campaign.completedAt,
          })),
        });
      } catch (error) {
        console.error('List campaigns error:', error);

        if (error instanceof Error) {
          if (error.message.includes('Authentication')) {
            return reply.code(401).send({ error: error.message });
          }
        }

        return reply.code(500).send({
          error: 'Failed to retrieve campaigns. Please try again.',
        });
      }
    }
  );

  // Delete campaign (only if not started)
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id } = request.params;

        if (!id) {
          return reply.code(400).send({ error: 'Campaign ID is required' });
        }

        // Check if campaign exists and user owns it
        const campaign = await prisma.campaign.findFirst({
          where: {
            id,
            brand: {
              userId,
            },
          },
          include: {
            _count: {
              select: {
                content: true,
              },
            },
          },
        });

        if (!campaign) {
          return reply.code(404).send({ error: 'Campaign not found or access denied' });
        }

        // Only allow deletion of campaigns that haven't been started
        const deletableStatuses = ['draft', 'preview', 'creating', 'failed'];
        if (!deletableStatuses.includes(campaign.status)) {
          return reply.code(400).send({
            error: `Cannot delete campaigns with status '${campaign.status}'. Only campaigns with status: ${deletableStatuses.join(', ')} can be deleted.`,
          });
        }

        // Delete the campaign (this will also delete related content due to cascade)
        await prisma.campaign.delete({
          where: { id },
        });

        return reply.send({
          success: true,
          message: 'Campaign deleted successfully',
          deletedCampaign: {
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            contentCount: campaign._count.content,
          },
        });
      } catch (error) {
        console.error('Delete campaign error:', error);

        if (error instanceof Error) {
          if (error.message.includes('Authentication')) {
            return reply.code(401).send({ error: error.message });
          }
        }

        return reply.code(500).send({
          error: 'Failed to delete campaign. Please try again.',
        });
      }
    }
  );

  // Update campaign priority
  fastify.put<{
    Params: { id: string };
    Body: { priority: number };
  }>('/:id/priority', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const { id } = request.params;
      const { priority } = request.body;

      if (!id) {
        return reply.code(400).send({ error: 'Campaign ID is required' });
      }

      if (typeof priority !== 'number' || priority < 1 || priority > 10) {
        return reply.code(400).send({ error: 'Priority must be a number between 1 and 10' });
      }

      const updatedCampaign = await campaignService.updateCampaignPriority(id, priority, userId);

      return reply.send({
        success: true,
        message: 'Campaign priority updated successfully',
        campaign: updatedCampaign,
      });
    } catch (error) {
      console.error('Update campaign priority error:', error);

      if (error instanceof Error) {
        if (error.message.includes('Authentication') || error.message.includes('access denied')) {
          return reply.code(401).send({ error: error.message });
        }
        if (error.message.includes('not found')) {
          return reply.code(404).send({ error: error.message });
        }
      }

      return reply.code(500).send({
        error: 'Failed to update campaign priority. Please try again.',
      });
    }
  });

  // Get campaign coordination summary
  fastify.get('/coordination', { preHandler: fastify.authenticate }, async (request, reply) => {
    try {
      const userId = request.user!.id;
      const coordination = await campaignService.getCampaignCoordination(userId);

      return reply.send({
        success: true,
        coordination,
      });
    } catch (error) {
      console.error('Get campaign coordination error:', error);

      if (error instanceof Error) {
        if (error.message.includes('Authentication')) {
          return reply.code(401).send({ error: error.message });
        }
      }

      return reply.code(500).send({
        error: 'Failed to get campaign coordination. Please try again.',
      });
    }
  });

  // Regenerate campaign content (simplified without rollback)
  interface RegenerateContentBody {
    themes?: string[];
    style?: string;
    contentIds?: string[];
  }
  fastify.post<{ Params: { id: string }; Body: RegenerateContentBody }>(
    '/:id/regenerate',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { id: campaignId } = request.params;
        const { themes, style, contentIds } = request.body;

        // Get campaign and verify ownership
        const campaign = await prisma.campaign.findUnique({
          where: { id: campaignId },
          include: {
            brand: true,
            content: true,
          },
        });

        if (!campaign) {
          return reply.code(404).send({ error: 'Campaign not found' });
        }

        if (campaign.brand.userId !== userId) {
          return reply.code(403).send({ error: 'Access denied' });
        }

        // Determine which content to regenerate
        const targetContentIds =
          contentIds && contentIds.length > 0 ? contentIds : campaign.content.map((c) => c.id);

        if (targetContentIds.length === 0) {
          return reply.code(400).send({ error: 'No content to regenerate' });
        }

        // Start regeneration job
        const regenerationJob = await regenerationService.startRegeneration(
          campaignId,
          targetContentIds,
          userId,
          { themes, style }
        );

        return reply.send({
          success: true,
          data: regenerationJob,
        });
      } catch (error) {
        console.error('Content regeneration error:', error);
        return reply.code(500).send({
          error: 'Failed to start content regeneration. Please try again.',
        });
      }
    }
  );

  // Get regeneration job progress
  fastify.get<{ Params: { jobId: string } }>(
    '/regeneration-jobs/:jobId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { jobId } = request.params;

        const progress = await regenerationService.getJobProgress(jobId, userId);

        if (!progress) {
          return reply.code(404).send({ error: 'Job not found' });
        }

        return reply.send({
          success: true,
          data: progress,
        });
      } catch (error) {
        console.error('Get job progress error:', error);
        return reply.code(500).send({
          error: 'Failed to get job progress. Please try again.',
        });
      }
    }
  );

  // Cancel regeneration job
  fastify.delete<{ Params: { jobId: string } }>(
    '/regeneration-jobs/:jobId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      try {
        const userId = request.user!.id;
        const { jobId } = request.params;

        const cancelled = await regenerationService.cancelJob(jobId, userId);

        if (!cancelled) {
          return reply.code(404).send({ error: 'Job not found or already completed' });
        }

        return reply.send({
          success: true,
          message: 'Job cancelled successfully',
        });
      } catch (error) {
        console.error('Cancel job error:', error);
        return reply.code(500).send({
          error: 'Failed to cancel job. Please try again.',
        });
      }
    }
  );
};

export default campaignRoutes;
