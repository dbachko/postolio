import type Stripe from 'stripe';
import { logger as baseLogger } from '@postolio/logger';
import { getStripeClient } from './stripe.js';
import type { CreditPack } from '../schemas/billing.js';
import { asHttpError, type InvoiceDto } from './billing.shared.js';
import {
  createCreditCheckoutSession,
  createPortalSession,
  createSubscriptionCheckoutSession,
  constructWebhookEvent,
  getSubscription,
  listInvoices,
  processWebhookEventPublic,
  reactivateSubscription,
  cancelSubscription,
} from './billing.public.js';

export type { SubscriptionDto, InvoiceDto } from './billing.shared.js';

class BillingService {
  readonly logger = baseLogger.child({ module: 'billing-service' });

  requireStripe() {
    const stripe = getStripeClient();
    if (!stripe) {
      throw asHttpError('Billing is not configured on this environment.', 503);
    }
    return stripe;
  }

  getFrontendUrl() {
    return (
      process.env.APP_URL?.trim() || process.env.FRONTEND_URL?.trim() || 'http://localhost:5173'
    );
  }

  idempotency(action: string, key: string) {
    const bucket = Math.floor(Date.now() / 60_000);
    return `${action}:${key}:${bucket}`;
  }

  async createSubscriptionCheckoutSession(params: {
    userId: string;
    priceId: string;
    successUrl?: string;
    cancelUrl?: string;
  }) {
    return createSubscriptionCheckoutSession(this, params);
  }

  async createCreditCheckoutSession(params: {
    userId: string;
    brandId: string;
    creditPack: CreditPack;
    successUrl?: string;
    cancelUrl?: string;
  }) {
    return createCreditCheckoutSession(this, params);
  }

  async getSubscription(userId: string) {
    return getSubscription(this, userId);
  }

  async cancelSubscription(userId: string) {
    return cancelSubscription(this, userId);
  }

  async reactivateSubscription(userId: string) {
    return reactivateSubscription(this, userId);
  }

  async listInvoices(
    userId: string,
    limit = 10,
    startingAfter?: string
  ): Promise<{
    invoices: InvoiceDto[];
    hasMore: boolean;
  }> {
    return listInvoices(userId, limit, startingAfter);
  }

  async createPortalSession(userId: string, returnUrl?: string) {
    return createPortalSession(this, userId, returnUrl);
  }

  constructWebhookEvent(rawBody: string, signature: string): Stripe.Event {
    return constructWebhookEvent(this, rawBody, signature);
  }

  async processWebhookEvent(event: Stripe.Event) {
    return processWebhookEventPublic(this, event);
  }
}

export const billingService = new BillingService();
