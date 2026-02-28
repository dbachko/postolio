import type { Prisma } from '@postolio/database';
import type Stripe from 'stripe';
import type { CreditPack } from '../schemas/billing.js';

export const CREDIT_PACKS: Record<
  CreditPack,
  { credits: number; envVar: string; label: string; defaultUsdAmountCents: number }
> = {
  starter: {
    credits: 500,
    envVar: 'STRIPE_PRICE_CREDITS_STARTER',
    label: 'Starter',
    defaultUsdAmountCents: 500,
  },
  standard: {
    credits: 2000,
    envVar: 'STRIPE_PRICE_CREDITS_STANDARD',
    label: 'Standard',
    defaultUsdAmountCents: 2000,
  },
  bulk: {
    credits: 5000,
    envVar: 'STRIPE_PRICE_CREDITS_BULK',
    label: 'Bulk',
    defaultUsdAmountCents: 5000,
  },
};

export const PRO_ACCESS_STATUSES = new Set(['active', 'trialing', 'past_due']);

export function asHttpError(message: string, statusCode: number): Error {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = statusCode;
  return error;
}

export function toDate(unixSeconds: number | null | undefined): Date | null {
  if (!unixSeconds || !Number.isFinite(unixSeconds)) {
    return null;
  }
  return new Date(unixSeconds * 1000);
}

export function toMetadataJson(
  metadata: Stripe.Metadata | Record<string, string> | null | undefined
): Prisma.InputJsonValue {
  return (metadata || {}) as Prisma.InputJsonValue;
}

export type SubscriptionDto = {
  id: string;
  stripeSubscriptionId: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  trialStart: string | null;
  trialEnd: string | null;
  quantity: number;
  price: {
    stripePriceId: string;
    unitAmount: number;
    currency: string;
    interval: string | null;
    productName: string;
  };
};

export type InvoiceDto = {
  stripeInvoiceId: string;
  number: string | null;
  status: string;
  currency: string;
  total: number;
  amountPaid: number;
  amountDue: number;
  paidAt: string | null;
  invoicePdfUrl: string | null;
  hostedInvoiceUrl: string | null;
  createdAt: string;
};
