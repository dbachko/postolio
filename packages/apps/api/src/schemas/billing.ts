import { z } from 'zod';

export const creditPackSchema = z.enum(['starter', 'standard', 'bulk']);

export const createCheckoutSessionSchema = z.object({
  priceId: z.string().min(1),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

export const createCreditCheckoutSchema = z.object({
  brandId: z.string().min(1),
  creditPack: creditPackSchema,
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

export const listInvoicesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10).optional(),
  startingAfter: z.string().min(1).optional(),
});

export const createPortalSessionSchema = z.object({
  returnUrl: z.string().url().optional(),
});

export type CreditPack = z.infer<typeof creditPackSchema>;
