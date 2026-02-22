import type { Prisma } from '@postolio/database';
import type Stripe from 'stripe';
import { logger as baseLogger } from '@postolio/logger';
import { prisma } from '../config/database.js';
import { topUpAiCredits } from './ai-credits.js';
import { notificationsService } from './notifications.js';
import { getStripeClient } from './stripe.js';
import type { CreditPack } from '../schemas/billing.js';

const logger = baseLogger.child({ module: 'billing-service' });

const CREDIT_PACKS: Record<
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

const PRO_ACCESS_STATUSES = new Set(['active', 'trialing', 'past_due']);

function asHttpError(message: string, statusCode: number): Error {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = statusCode;
  return error;
}

function toDate(unixSeconds: number | null | undefined): Date | null {
  if (!unixSeconds || !Number.isFinite(unixSeconds)) {
    return null;
  }
  return new Date(unixSeconds * 1000);
}

function toMetadataJson(
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

class BillingService {
  private requireStripe() {
    const stripe = getStripeClient();
    if (!stripe) {
      throw asHttpError('Billing is not configured on this environment.', 503);
    }
    return stripe;
  }

  private getFrontendUrl() {
    return (
      process.env.APP_URL?.trim() || process.env.FRONTEND_URL?.trim() || 'http://localhost:5173'
    );
  }

  private idempotency(action: string, key: string) {
    const bucket = Math.floor(Date.now() / 60_000);
    return `${action}:${key}:${bucket}`;
  }

  private tierFromSubscriptionStatus(status: string) {
    return PRO_ACCESS_STATUSES.has(status) ? 'pro' : 'free';
  }

  private async ensureBillingCustomer(userId: string) {
    const existing = await prisma.billingCustomer.findUnique({
      where: { userId },
      select: { id: true, userId: true, stripeCustomerId: true, email: true, currency: true },
    });
    if (existing) {
      return existing;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) {
      throw asHttpError('User not found.', 404);
    }

    const stripe = this.requireStripe();
    const stripeCustomer = await stripe.customers.create({
      email: user.email,
      metadata: { userId: user.id },
    });

    if (!stripeCustomer.id) {
      throw asHttpError('Failed to create Stripe customer.', 502);
    }

    return prisma.billingCustomer.create({
      data: {
        userId: user.id,
        stripeCustomerId: stripeCustomer.id,
        email: user.email,
        currency: 'usd',
      },
      select: { id: true, userId: true, stripeCustomerId: true, email: true, currency: true },
    });
  }

  private async findOrCreateBillingCustomerByStripeId(
    stripeCustomerId: string,
    fallbackUserId?: string
  ) {
    const existing = await prisma.billingCustomer.findUnique({
      where: { stripeCustomerId },
      select: { id: true, userId: true, stripeCustomerId: true, email: true, currency: true },
    });
    if (existing) {
      return existing;
    }

    const stripe = this.requireStripe();
    let userId = fallbackUserId || null;
    let email = '';

    try {
      const stripeCustomer = await stripe.customers.retrieve(stripeCustomerId);
      if (stripeCustomer && !('deleted' in stripeCustomer)) {
        userId = userId || stripeCustomer.metadata?.userId || null;
        email = stripeCustomer.email || '';
      }
    } catch (error) {
      logger.warn('Failed to retrieve stripe customer for backfill', {
        stripeCustomerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (!userId) {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) {
      return null;
    }

    return prisma.billingCustomer.upsert({
      where: { userId: user.id },
      update: {
        stripeCustomerId,
        email: email || user.email,
      },
      create: {
        userId: user.id,
        stripeCustomerId,
        email: email || user.email,
        currency: 'usd',
      },
      select: { id: true, userId: true, stripeCustomerId: true, email: true, currency: true },
    });
  }

  private async syncCatalogForPrice(price: Stripe.Price | null | undefined) {
    if (!price?.id) {
      return null;
    }

    const stripe = this.requireStripe();
    const stripeProductId =
      typeof price.product === 'string' ? price.product : (price.product?.id ?? null);
    if (!stripeProductId) {
      return null;
    }

    let productName = `Stripe product ${stripeProductId}`;
    let productDescription: string | null = null;
    let productActive = true;
    let productMetadata: Prisma.InputJsonValue = {};

    if (typeof price.product !== 'string' && price.product && !('deleted' in price.product)) {
      productName = price.product.name || productName;
      productDescription = price.product.description || null;
      productActive = Boolean(price.product.active);
      productMetadata = toMetadataJson(price.product.metadata);
    } else {
      try {
        const product = await stripe.products.retrieve(stripeProductId);
        if (product && !('deleted' in product)) {
          productName = product.name || productName;
          productDescription = product.description || null;
          productActive = Boolean(product.active);
          productMetadata = toMetadataJson(product.metadata);
        }
      } catch (error) {
        logger.warn('Failed to sync Stripe product metadata', {
          stripeProductId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const localProduct = await prisma.billingProduct.upsert({
      where: { stripeProductId },
      update: {
        name: productName,
        description: productDescription,
        active: productActive,
        metadata: productMetadata,
      },
      create: {
        stripeProductId,
        name: productName,
        description: productDescription,
        active: productActive,
        metadata: productMetadata,
      },
      select: { id: true },
    });

    const interval = price.type === 'recurring' ? (price.recurring?.interval ?? null) : null;
    const intervalCount = price.type === 'recurring' ? (price.recurring?.interval_count ?? 1) : 1;
    const trialDays =
      price.type === 'recurring' ? (price.recurring?.trial_period_days ?? null) : null;

    const localPrice = await prisma.billingPrice.upsert({
      where: { stripePriceId: price.id },
      update: {
        productId: localProduct.id,
        currency: price.currency || 'usd',
        unitAmount: price.unit_amount ?? 0,
        interval,
        intervalCount,
        trialDays,
        active: Boolean(price.active),
        metadata: toMetadataJson(price.metadata),
      },
      create: {
        productId: localProduct.id,
        stripePriceId: price.id,
        currency: price.currency || 'usd',
        unitAmount: price.unit_amount ?? 0,
        interval,
        intervalCount,
        trialDays,
        active: Boolean(price.active),
        metadata: toMetadataJson(price.metadata),
      },
      select: { id: true },
    });

    return localPrice.id;
  }

  private async syncSubscriptionFromStripe(subscription: Stripe.Subscription) {
    const subscriptionAny = subscription as any;
    const stripeCustomerId =
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

    const billingCustomer = await this.findOrCreateBillingCustomerByStripeId(stripeCustomerId);
    if (!billingCustomer) {
      logger.warn('Skipping subscription sync because customer is not linked to a user', {
        stripeCustomerId,
        stripeSubscriptionId: subscription.id,
      });
      return null;
    }

    const subscriptionPrice = subscription.items?.data?.[0]?.price || null;
    const localPriceId = await this.syncCatalogForPrice(subscriptionPrice);
    if (!localPriceId) {
      throw asHttpError('Unable to sync Stripe price for subscription.', 502);
    }

    const currentPeriodStart = toDate(subscriptionAny.current_period_start) ?? new Date();
    const currentPeriodEnd = toDate(subscriptionAny.current_period_end) ?? new Date();

    const local = await prisma.billingSubscription.upsert({
      where: { stripeSubscriptionId: subscription.id },
      update: {
        customerId: billingCustomer.id,
        priceId: localPriceId,
        status: subscription.status,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        canceledAt: toDate(subscription.canceled_at),
        trialStart: toDate(subscription.trial_start),
        trialEnd: toDate(subscription.trial_end),
        quantity: subscription.items?.data?.[0]?.quantity ?? 1,
        metadata: toMetadataJson(subscription.metadata),
      },
      create: {
        customerId: billingCustomer.id,
        priceId: localPriceId,
        stripeSubscriptionId: subscription.id,
        status: subscription.status,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        canceledAt: toDate(subscription.canceled_at),
        trialStart: toDate(subscription.trial_start),
        trialEnd: toDate(subscription.trial_end),
        quantity: subscription.items?.data?.[0]?.quantity ?? 1,
        metadata: toMetadataJson(subscription.metadata),
      },
    });

    const tier = this.tierFromSubscriptionStatus(subscription.status);
    await prisma.user.update({
      where: { id: billingCustomer.userId },
      data: { subscriptionTier: tier },
    });

    return local;
  }

  private async upsertInvoiceFromStripe(invoice: Stripe.Invoice, eventType: string) {
    const invoiceAny = invoice as any;
    const invoiceId = (invoice as any).id as string | undefined;
    if (!invoiceId) {
      return null;
    }

    const stripeCustomerId =
      typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    if (!stripeCustomerId) {
      return null;
    }

    const billingCustomer = await this.findOrCreateBillingCustomerByStripeId(stripeCustomerId);
    if (!billingCustomer) {
      return null;
    }

    const stripeSubscriptionId =
      typeof invoiceAny.subscription === 'string'
        ? invoiceAny.subscription
        : invoiceAny.subscription?.id || null;
    let localSubscriptionId: string | null = null;
    if (stripeSubscriptionId) {
      const localSubscription = await prisma.billingSubscription.findUnique({
        where: { stripeSubscriptionId },
        select: { id: true },
      });
      localSubscriptionId = localSubscription?.id || null;
    }

    const localInvoice = await prisma.billingInvoice.upsert({
      where: { stripeInvoiceId: invoiceId },
      update: {
        customerId: billingCustomer.id,
        subscriptionId: localSubscriptionId,
        number: invoiceAny.number || null,
        status: invoiceAny.status || 'open',
        currency: invoiceAny.currency || 'usd',
        total: invoiceAny.total ?? 0,
        amountPaid: invoiceAny.amount_paid ?? 0,
        amountDue: invoiceAny.amount_due ?? 0,
        paidAt: toDate(invoiceAny.status_transitions?.paid_at),
        invoicePdfUrl: invoiceAny.invoice_pdf || null,
        hostedInvoiceUrl: invoiceAny.hosted_invoice_url || null,
      },
      create: {
        customerId: billingCustomer.id,
        subscriptionId: localSubscriptionId,
        stripeInvoiceId: invoiceId,
        number: invoiceAny.number || null,
        status: invoiceAny.status || 'open',
        currency: invoiceAny.currency || 'usd',
        total: invoiceAny.total ?? 0,
        amountPaid: invoiceAny.amount_paid ?? 0,
        amountDue: invoiceAny.amount_due ?? 0,
        paidAt: toDate(invoiceAny.status_transitions?.paid_at),
        invoicePdfUrl: invoiceAny.invoice_pdf || null,
        hostedInvoiceUrl: invoiceAny.hosted_invoice_url || null,
      },
    });

    const stripePaymentIntentId =
      typeof invoiceAny.payment_intent === 'string'
        ? invoiceAny.payment_intent
        : invoiceAny.payment_intent?.id || null;
    if (stripePaymentIntentId) {
      await prisma.billingPayment.upsert({
        where: { stripePaymentIntentId },
        update: {
          customerId: billingCustomer.id,
          amount: invoiceAny.amount_paid ?? invoiceAny.total ?? 0,
          currency: invoiceAny.currency || 'usd',
          status: eventType === 'invoice.payment_failed' ? 'failed' : 'succeeded',
          metadata: {
            source: 'invoice',
            stripeInvoiceId: invoiceId,
          } as Prisma.InputJsonValue,
        },
        create: {
          customerId: billingCustomer.id,
          stripePaymentIntentId,
          stripeChargeId:
            typeof invoiceAny.charge === 'string'
              ? invoiceAny.charge
              : invoiceAny.charge?.id || null,
          amount: invoiceAny.amount_paid ?? invoiceAny.total ?? 0,
          currency: invoiceAny.currency || 'usd',
          status: eventType === 'invoice.payment_failed' ? 'failed' : 'succeeded',
          metadata: {
            source: 'invoice',
            stripeInvoiceId: invoiceId,
          } as Prisma.InputJsonValue,
        },
      });
    }

    if (eventType === 'invoice.payment_failed') {
      await notificationsService.emitEvent({
        userId: billingCustomer.userId,
        type: 'billing.payment_failed',
        category: 'billing',
        severity: 'error',
        title: 'Payment failed',
        body: 'Your latest payment failed. Update your payment method to keep Pro features active.',
        linkUrl: '/settings/billing',
      });
    } else if (eventType === 'invoice.paid') {
      await notificationsService.emitEvent({
        userId: billingCustomer.userId,
        type: 'billing.invoice_paid',
        category: 'billing',
        severity: 'info',
        title: 'Invoice paid',
        body: 'Your latest invoice was paid successfully.',
        linkUrl: '/settings/billing',
      });
    }

    return localInvoice;
  }

  private async handlePaymentMethodAttached(paymentMethod: Stripe.PaymentMethod) {
    const stripeCustomerId =
      typeof paymentMethod.customer === 'string'
        ? paymentMethod.customer
        : paymentMethod.customer?.id || null;
    if (!stripeCustomerId) {
      return;
    }

    const billingCustomer = await this.findOrCreateBillingCustomerByStripeId(stripeCustomerId);
    if (!billingCustomer) {
      return;
    }

    await prisma.billingPaymentMethod.upsert({
      where: { stripePaymentMethodId: paymentMethod.id },
      update: {
        customerId: billingCustomer.id,
        type: paymentMethod.type || 'card',
        cardBrand: paymentMethod.card?.brand || null,
        cardLastFour: paymentMethod.card?.last4 || null,
        cardExpMonth: paymentMethod.card?.exp_month || null,
        cardExpYear: paymentMethod.card?.exp_year || null,
      },
      create: {
        customerId: billingCustomer.id,
        stripePaymentMethodId: paymentMethod.id,
        type: paymentMethod.type || 'card',
        cardBrand: paymentMethod.card?.brand || null,
        cardLastFour: paymentMethod.card?.last4 || null,
        cardExpMonth: paymentMethod.card?.exp_month || null,
        cardExpYear: paymentMethod.card?.exp_year || null,
      },
    });
  }

  private async handlePaymentMethodDetached(paymentMethod: Stripe.PaymentMethod) {
    await prisma.billingPaymentMethod.deleteMany({
      where: { stripePaymentMethodId: paymentMethod.id },
    });
  }

  private async handleTrialWillEnd(subscription: Stripe.Subscription) {
    const stripeCustomerId =
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    const billingCustomer = await this.findOrCreateBillingCustomerByStripeId(stripeCustomerId);
    if (!billingCustomer) {
      return;
    }

    await notificationsService.emitEvent({
      userId: billingCustomer.userId,
      type: 'billing.trial_ending',
      category: 'billing',
      severity: 'warning',
      title: 'Trial ending soon',
      body: 'Your trial is ending soon. Add a payment method to keep access.',
      linkUrl: '/settings/billing',
    });
  }

  private async handleCreditTopupCheckout(session: Stripe.Checkout.Session) {
    const userId = session.metadata?.userId || '';
    const brandId = session.metadata?.brandId || '';
    const creditPack = (session.metadata?.creditPack || '') as CreditPack;
    const credits = Number.parseInt(session.metadata?.credits || '', 10);

    if (!userId || !brandId || !creditPack || !Number.isFinite(credits) || credits <= 0) {
      logger.warn('Skipping credit top-up because session metadata is incomplete', {
        sessionId: session.id,
        userId,
        brandId,
        creditPack,
        creditsRaw: session.metadata?.credits,
      });
      return;
    }

    const brand = await prisma.brand.findFirst({
      where: { id: brandId, userId },
      select: { id: true, name: true },
    });
    if (!brand) {
      logger.warn('Skipping credit top-up because brand ownership verification failed', {
        sessionId: session.id,
        userId,
        brandId,
      });
      return;
    }

    const stripeCustomerId =
      typeof session.customer === 'string' ? session.customer : session.customer?.id || null;
    const billingCustomer = stripeCustomerId
      ? await this.findOrCreateBillingCustomerByStripeId(stripeCustomerId, userId)
      : await this.ensureBillingCustomer(userId);
    if (!billingCustomer) {
      logger.warn('No billing customer found for credit top-up', {
        sessionId: session.id,
        userId,
      });
      return;
    }

    const stripePaymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : `checkout_session_${session.id}`;

    const existingPayment = await prisma.billingPayment.findUnique({
      where: { stripePaymentIntentId },
      select: { id: true, status: true },
    });
    if (existingPayment?.status === 'succeeded') {
      return;
    }

    await prisma.billingPayment.upsert({
      where: { stripePaymentIntentId },
      update: {
        customerId: billingCustomer.id,
        brandId: brand.id,
        amount: session.amount_total ?? CREDIT_PACKS[creditPack].defaultUsdAmountCents,
        currency: session.currency || 'usd',
        status: 'succeeded',
        idempotencyKey: session.id,
        creditsGranted: credits,
        metadata: {
          source: 'credit_topup',
          checkoutSessionId: session.id,
          creditPack,
        } as Prisma.InputJsonValue,
      },
      create: {
        customerId: billingCustomer.id,
        brandId: brand.id,
        stripePaymentIntentId,
        amount: session.amount_total ?? CREDIT_PACKS[creditPack].defaultUsdAmountCents,
        currency: session.currency || 'usd',
        status: 'succeeded',
        idempotencyKey: session.id,
        creditsGranted: credits,
        metadata: {
          source: 'credit_topup',
          checkoutSessionId: session.id,
          creditPack,
        } as Prisma.InputJsonValue,
      },
    });

    await topUpAiCredits({
      brandId: brand.id,
      credits,
      note: `Credit pack purchase: ${CREDIT_PACKS[creditPack].label} (${credits} credits)`,
    });

    await notificationsService.emitEvent({
      userId,
      brandId: brand.id,
      type: 'billing.credit_topup_succeeded',
      category: 'billing',
      severity: 'info',
      title: 'Credits added',
      body: `${credits} AI credits were added to ${brand.name}.`,
      linkUrl: '/settings/billing',
    });
  }

  private toSubscriptionDto(
    subscription: Prisma.BillingSubscriptionGetPayload<{
      include: {
        price: {
          include: { product: true };
        };
      };
    }> | null
  ): SubscriptionDto | null {
    if (!subscription) {
      return null;
    }

    return {
      id: subscription.id,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart.toISOString(),
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      canceledAt: subscription.canceledAt ? subscription.canceledAt.toISOString() : null,
      trialStart: subscription.trialStart ? subscription.trialStart.toISOString() : null,
      trialEnd: subscription.trialEnd ? subscription.trialEnd.toISOString() : null,
      quantity: subscription.quantity,
      price: {
        stripePriceId: subscription.price.stripePriceId,
        unitAmount: subscription.price.unitAmount,
        currency: subscription.price.currency,
        interval: subscription.price.interval,
        productName: subscription.price.product.name,
      },
    };
  }

  async createSubscriptionCheckoutSession(params: {
    userId: string;
    priceId: string;
    successUrl?: string;
    cancelUrl?: string;
  }) {
    const stripe = this.requireStripe();
    const customer = await this.ensureBillingCustomer(params.userId);

    const successUrl =
      params.successUrl || `${this.getFrontendUrl()}/settings/billing?success=true`;
    const cancelUrl = params.cancelUrl || `${this.getFrontendUrl()}/pricing?canceled=true`;

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customer.stripeCustomerId,
        client_reference_id: params.userId,
        line_items: [{ price: params.priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: true,
        metadata: {
          type: 'subscription',
          userId: params.userId,
        },
      },
      {
        idempotencyKey: this.idempotency(
          'checkout_subscription',
          `${params.userId}:${params.priceId}`
        ),
      }
    );

    if (!session.url) {
      throw asHttpError('Failed to create checkout session URL.', 502);
    }

    return { sessionId: session.id, url: session.url };
  }

  async createCreditCheckoutSession(params: {
    userId: string;
    brandId: string;
    creditPack: CreditPack;
    successUrl?: string;
    cancelUrl?: string;
  }) {
    const stripe = this.requireStripe();
    const brand = await prisma.brand.findFirst({
      where: { id: params.brandId, userId: params.userId },
      select: { id: true },
    });
    if (!brand) {
      throw asHttpError('Brand not found.', 404);
    }

    const pack = CREDIT_PACKS[params.creditPack];
    const priceId = process.env[pack.envVar]?.trim();
    if (!priceId) {
      throw asHttpError(`Missing Stripe price config: ${pack.envVar}`, 500);
    }

    const customer = await this.ensureBillingCustomer(params.userId);
    const successUrl =
      params.successUrl || `${this.getFrontendUrl()}/settings/billing?credits=success`;
    const cancelUrl =
      params.cancelUrl || `${this.getFrontendUrl()}/settings/billing?credits=cancel`;

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer: customer.stripeCustomerId,
        client_reference_id: params.userId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          type: 'credit_topup',
          userId: params.userId,
          brandId: params.brandId,
          creditPack: params.creditPack,
          credits: String(pack.credits),
        },
      },
      {
        idempotencyKey: this.idempotency(
          'checkout_credits',
          `${params.userId}:${params.brandId}:${params.creditPack}`
        ),
      }
    );

    if (!session.url) {
      throw asHttpError('Failed to create credit checkout session URL.', 502);
    }

    return { sessionId: session.id, url: session.url };
  }

  async getSubscription(userId: string) {
    const [user, localSubscription] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { subscriptionTier: true },
      }),
      prisma.billingSubscription.findFirst({
        where: { customer: { userId } },
        orderBy: { updatedAt: 'desc' },
        include: {
          price: {
            include: { product: true },
          },
        },
      }),
    ]);

    return {
      tier: user?.subscriptionTier || 'free',
      subscription: this.toSubscriptionDto(localSubscription),
    };
  }

  async cancelSubscription(userId: string) {
    const stripe = this.requireStripe();
    const localSubscription = await prisma.billingSubscription.findFirst({
      where: {
        customer: { userId },
        status: { in: ['active', 'trialing', 'past_due'] },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!localSubscription) {
      throw asHttpError('No active subscription found.', 404);
    }

    const stripeSubscription = await stripe.subscriptions.update(
      localSubscription.stripeSubscriptionId,
      { cancel_at_period_end: true },
      {
        idempotencyKey: this.idempotency(
          'subscription_cancel',
          `${userId}:${localSubscription.stripeSubscriptionId}`
        ),
      }
    );

    await this.syncSubscriptionFromStripe(stripeSubscription);
    return this.getSubscription(userId);
  }

  async reactivateSubscription(userId: string) {
    const stripe = this.requireStripe();
    const localSubscription = await prisma.billingSubscription.findFirst({
      where: {
        customer: { userId },
        status: { in: ['active', 'trialing', 'past_due'] },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!localSubscription) {
      throw asHttpError('No active subscription found.', 404);
    }

    const stripeSubscription = await stripe.subscriptions.update(
      localSubscription.stripeSubscriptionId,
      { cancel_at_period_end: false },
      {
        idempotencyKey: this.idempotency(
          'subscription_reactivate',
          `${userId}:${localSubscription.stripeSubscriptionId}`
        ),
      }
    );

    await this.syncSubscriptionFromStripe(stripeSubscription);
    return this.getSubscription(userId);
  }

  async listInvoices(userId: string, limit = 10, startingAfter?: string) {
    const effectiveLimit = Math.min(Math.max(limit, 1), 100);

    let createdBefore: Date | null = null;
    if (startingAfter) {
      const cursor = await prisma.billingInvoice.findUnique({
        where: { stripeInvoiceId: startingAfter },
        select: { createdAt: true },
      });
      createdBefore = cursor?.createdAt || null;
    }

    const invoices = await prisma.billingInvoice.findMany({
      where: {
        customer: { userId },
        ...(createdBefore ? { createdAt: { lt: createdBefore } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: effectiveLimit + 1,
    });

    const hasMore = invoices.length > effectiveLimit;
    const sliced = invoices.slice(0, effectiveLimit);

    const dto: InvoiceDto[] = sliced.map((invoice) => ({
      stripeInvoiceId: invoice.stripeInvoiceId,
      number: invoice.number,
      status: invoice.status,
      currency: invoice.currency,
      total: invoice.total,
      amountPaid: invoice.amountPaid,
      amountDue: invoice.amountDue,
      paidAt: invoice.paidAt ? invoice.paidAt.toISOString() : null,
      invoicePdfUrl: invoice.invoicePdfUrl,
      hostedInvoiceUrl: invoice.hostedInvoiceUrl,
      createdAt: invoice.createdAt.toISOString(),
    }));

    return { invoices: dto, hasMore };
  }

  async createPortalSession(userId: string, returnUrl?: string) {
    const stripe = this.requireStripe();
    const customer = await this.ensureBillingCustomer(userId);
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.stripeCustomerId,
      return_url: returnUrl || `${this.getFrontendUrl()}/settings/billing`,
    });

    return { url: session.url };
  }

  constructWebhookEvent(rawBody: string, signature: string) {
    const stripe = this.requireStripe();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!webhookSecret) {
      throw asHttpError('STRIPE_WEBHOOK_SECRET is not configured.', 500);
    }
    return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  }

  async processWebhookEvent(event: Stripe.Event) {
    const existing = await prisma.billingWebhookEvent.findUnique({
      where: { stripeEventId: event.id },
      select: { status: true },
    });
    if (existing?.status === 'processed') {
      return;
    }

    if (existing) {
      await prisma.billingWebhookEvent.update({
        where: { stripeEventId: event.id },
        data: {
          status: 'pending',
          errorMessage: null,
          attempts: { increment: 1 },
          payload: event as unknown as Prisma.InputJsonValue,
        },
      });
    } else {
      await prisma.billingWebhookEvent.create({
        data: {
          stripeEventId: event.id,
          type: event.type,
          payload: event as unknown as Prisma.InputJsonValue,
          status: 'pending',
          attempts: 1,
        },
      });
    }

    await prisma.billingWebhookEvent.update({
      where: { stripeEventId: event.id },
      data: { status: 'processing' },
    });

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.mode === 'subscription' && typeof session.subscription === 'string') {
            const stripe = this.requireStripe();
            const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription);
            await this.syncSubscriptionFromStripe(stripeSubscription);
          } else if (session.mode === 'payment' && session.metadata?.type === 'credit_topup') {
            await this.handleCreditTopupCheckout(session);
          }
          break;
        }

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription;
          await this.syncSubscriptionFromStripe(subscription);
          break;
        }

        case 'invoice.paid':
        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice;
          await this.upsertInvoiceFromStripe(invoice, event.type);
          break;
        }

        case 'customer.subscription.trial_will_end': {
          const subscription = event.data.object as Stripe.Subscription;
          await this.handleTrialWillEnd(subscription);
          break;
        }

        case 'payment_method.attached': {
          const paymentMethod = event.data.object as Stripe.PaymentMethod;
          await this.handlePaymentMethodAttached(paymentMethod);
          break;
        }

        case 'payment_method.detached': {
          const paymentMethod = event.data.object as Stripe.PaymentMethod;
          await this.handlePaymentMethodDetached(paymentMethod);
          break;
        }

        default: {
          logger.debug('Unhandled Stripe webhook event', { eventType: event.type });
          break;
        }
      }

      await prisma.billingWebhookEvent.update({
        where: { stripeEventId: event.id },
        data: {
          status: 'processed',
          processedAt: new Date(),
          errorMessage: null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.billingWebhookEvent.update({
        where: { stripeEventId: event.id },
        data: {
          status: 'failed',
          errorMessage: message,
        },
      });
      throw error;
    }
  }
}

export const billingService = new BillingService();
