import type Stripe from 'stripe';
import { prisma } from '../config/database.js';
import type { CreditPack } from '../schemas/billing.js';
import { CREDIT_PACKS, asHttpError, type InvoiceDto } from './billing.shared.js';
import {
  ensureBillingCustomer,
  syncSubscriptionFromStripe,
  toSubscriptionDto,
} from './billing.sync.js';
import { processWebhookEvent } from './billing.webhooks.js';

type BillingServiceLike = any;

export async function createSubscriptionCheckoutSession(
  client: BillingServiceLike,
  params: {
    userId: string;
    priceId: string;
    successUrl?: string;
    cancelUrl?: string;
  }
) {
  const stripe = client.requireStripe();
  const customer = await ensureBillingCustomer(client, params.userId);
  const successUrl =
    params.successUrl || `${client.getFrontendUrl()}/settings/billing?success=true`;
  const cancelUrl = params.cancelUrl || `${client.getFrontendUrl()}/pricing?canceled=true`;

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'subscription',
      customer: customer.stripeCustomerId,
      client_reference_id: params.userId,
      line_items: [{ price: params.priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      subscription_data: {
        billing_mode: { type: 'classic' },
      },
      metadata: {
        type: 'subscription',
        userId: params.userId,
      },
    },
    {
      idempotencyKey: client.idempotency(
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

export async function createCreditCheckoutSession(
  client: BillingServiceLike,
  params: {
    userId: string;
    brandId: string;
    creditPack: CreditPack;
    successUrl?: string;
    cancelUrl?: string;
  }
) {
  const stripe = client.requireStripe();
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

  const customer = await ensureBillingCustomer(client, params.userId);
  const successUrl =
    params.successUrl || `${client.getFrontendUrl()}/settings/billing?credits=success`;
  const cancelUrl =
    params.cancelUrl || `${client.getFrontendUrl()}/settings/billing?credits=cancel`;

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
      idempotencyKey: client.idempotency(
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

export async function getSubscription(client: BillingServiceLike, userId: string) {
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
    subscription: toSubscriptionDto(localSubscription),
  };
}

export async function cancelSubscription(client: BillingServiceLike, userId: string) {
  const stripe = client.requireStripe();
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
      idempotencyKey: client.idempotency(
        'subscription_cancel',
        `${userId}:${localSubscription.stripeSubscriptionId}`
      ),
    }
  );
  await syncSubscriptionFromStripe(client, stripeSubscription);
  return getSubscription(client, userId);
}

export async function reactivateSubscription(client: BillingServiceLike, userId: string) {
  const stripe = client.requireStripe();
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
      idempotencyKey: client.idempotency(
        'subscription_reactivate',
        `${userId}:${localSubscription.stripeSubscriptionId}`
      ),
    }
  );
  await syncSubscriptionFromStripe(client, stripeSubscription);
  return getSubscription(client, userId);
}

export async function listInvoices(userId: string, limit = 10, startingAfter?: string) {
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

export async function createPortalSession(
  client: BillingServiceLike,
  userId: string,
  returnUrl?: string
) {
  const stripe = client.requireStripe();
  const customer = await ensureBillingCustomer(client, userId);
  const session = await stripe.billingPortal.sessions.create({
    customer: customer.stripeCustomerId,
    return_url: returnUrl || `${client.getFrontendUrl()}/settings/billing`,
  });
  return { url: session.url };
}

export function constructWebhookEvent(
  client: BillingServiceLike,
  rawBody: string,
  signature: string
): Stripe.Event {
  const stripe = client.requireStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    throw asHttpError('STRIPE_WEBHOOK_SECRET is not configured.', 500);
  }
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

export async function processWebhookEventPublic(client: BillingServiceLike, event: Stripe.Event) {
  return processWebhookEvent(client, event);
}
