import type { Prisma } from '@postolio/database';
import type Stripe from 'stripe';
import { prisma } from '../config/database.js';
import {
  asHttpError,
  PRO_ACCESS_STATUSES,
  toDate,
  toMetadataJson,
  type SubscriptionDto,
} from './billing.shared.js';

type BillingServiceLike = any;

function tierFromSubscriptionStatus(status: string) {
  return PRO_ACCESS_STATUSES.has(status) ? 'pro' : 'free';
}

export async function ensureBillingCustomer(client: BillingServiceLike, userId: string) {
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

  const stripe = client.requireStripe();
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

export async function findOrCreateBillingCustomerByStripeId(
  client: BillingServiceLike,
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

  const stripe = client.requireStripe();
  let userId = fallbackUserId || null;
  let email = '';
  try {
    const stripeCustomer = await stripe.customers.retrieve(stripeCustomerId);
    if (stripeCustomer && !('deleted' in stripeCustomer)) {
      userId = userId || stripeCustomer.metadata?.userId || null;
      email = stripeCustomer.email || '';
    }
  } catch (error) {
    client.logger.warn('Failed to retrieve stripe customer for backfill', {
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

async function resolvePriceProductSnapshot(client: BillingServiceLike, price: Stripe.Price) {
  const stripeProductId =
    typeof price.product === 'string' ? price.product : (price.product?.id ?? null);
  if (!stripeProductId) {
    return null;
  }

  const embeddedProduct = extractEmbeddedPriceProduct(price);
  if (embeddedProduct) {
    return buildProductSnapshot(stripeProductId, embeddedProduct);
  }

  const stripe = client.requireStripe();
  const fallbackSnapshot = buildProductSnapshot(stripeProductId, null);
  try {
    const product = await stripe.products.retrieve(stripeProductId);
    if (product && !('deleted' in product)) {
      return buildProductSnapshot(stripeProductId, product);
    }
  } catch (error) {
    client.logger.warn('Failed to sync Stripe product metadata', {
      stripeProductId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return fallbackSnapshot;
}

function extractEmbeddedPriceProduct(price: Stripe.Price): Stripe.Product | null {
  if (typeof price.product === 'string' || !price.product || 'deleted' in price.product) {
    return null;
  }
  return price.product;
}

function buildProductSnapshot(
  stripeProductId: string,
  product: Pick<Stripe.Product, 'name' | 'description' | 'active' | 'metadata'> | null
) {
  const defaultName = `Stripe product ${stripeProductId}`;
  return {
    stripeProductId,
    productName: product?.name || defaultName,
    productDescription: product?.description || null,
    productActive: product ? Boolean(product.active) : true,
    productMetadata: product ? toMetadataJson(product.metadata) : ({} as Prisma.InputJsonValue),
  };
}

async function upsertLocalPrice(price: Stripe.Price, productId: string) {
  const interval = price.type === 'recurring' ? (price.recurring?.interval ?? null) : null;
  const intervalCount = price.type === 'recurring' ? (price.recurring?.interval_count ?? 1) : 1;
  const trialDays =
    price.type === 'recurring' ? (price.recurring?.trial_period_days ?? null) : null;

  return prisma.billingPrice.upsert({
    where: { stripePriceId: price.id },
    update: {
      productId,
      currency: price.currency || 'usd',
      unitAmount: price.unit_amount ?? 0,
      interval,
      intervalCount,
      trialDays,
      active: Boolean(price.active),
      metadata: toMetadataJson(price.metadata),
    },
    create: {
      productId,
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
}

async function syncCatalogForPrice(
  client: BillingServiceLike,
  price: Stripe.Price | null | undefined
) {
  if (!price?.id) {
    return null;
  }

  const snapshot = await resolvePriceProductSnapshot(client, price);
  if (!snapshot) {
    return null;
  }

  const localProduct = await prisma.billingProduct.upsert({
    where: { stripeProductId: snapshot.stripeProductId },
    update: {
      name: snapshot.productName,
      description: snapshot.productDescription,
      active: snapshot.productActive,
      metadata: snapshot.productMetadata,
    },
    create: {
      stripeProductId: snapshot.stripeProductId,
      name: snapshot.productName,
      description: snapshot.productDescription,
      active: snapshot.productActive,
      metadata: snapshot.productMetadata,
    },
    select: { id: true },
  });

  const localPrice = await upsertLocalPrice(price, localProduct.id);
  return localPrice.id;
}

function resolveSubscriptionCustomerId(subscription: Stripe.Subscription): string {
  if (typeof subscription.customer === 'string') {
    return subscription.customer;
  }
  return subscription.customer.id;
}

function resolveSubscriptionQuantity(subscription: Stripe.Subscription): number {
  return subscription.items?.data?.[0]?.quantity ?? 1;
}

function buildSubscriptionRecordData(params: {
  subscription: Stripe.Subscription;
  billingCustomerId: string;
  localPriceId: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}) {
  const { subscription } = params;
  return {
    customerId: params.billingCustomerId,
    priceId: params.localPriceId,
    status: subscription.status,
    currentPeriodStart: params.currentPeriodStart,
    currentPeriodEnd: params.currentPeriodEnd,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    canceledAt: toDate(subscription.canceled_at),
    trialStart: toDate(subscription.trial_start),
    trialEnd: toDate(subscription.trial_end),
    quantity: resolveSubscriptionQuantity(subscription),
    metadata: toMetadataJson(subscription.metadata),
  };
}

export async function syncSubscriptionFromStripe(
  client: BillingServiceLike,
  subscription: Stripe.Subscription
) {
  const subscriptionAny = subscription as any;
  const stripeCustomerId = resolveSubscriptionCustomerId(subscription);
  const billingCustomer = await findOrCreateBillingCustomerByStripeId(client, stripeCustomerId);
  if (!billingCustomer) {
    client.logger.warn('Skipping subscription sync because customer is not linked to a user', {
      stripeCustomerId,
      stripeSubscriptionId: subscription.id,
    });
    return null;
  }

  const subscriptionPrice = subscription.items?.data?.[0]?.price || null;
  const localPriceId = await syncCatalogForPrice(client, subscriptionPrice);
  if (!localPriceId) {
    throw asHttpError('Unable to sync Stripe price for subscription.', 502);
  }

  const currentPeriodStart = toDate(subscriptionAny.current_period_start) ?? new Date();
  const currentPeriodEnd = toDate(subscriptionAny.current_period_end) ?? new Date();
  const subscriptionRecordData = buildSubscriptionRecordData({
    subscription,
    billingCustomerId: billingCustomer.id,
    localPriceId,
    currentPeriodStart,
    currentPeriodEnd,
  });
  const local = await prisma.billingSubscription.upsert({
    where: { stripeSubscriptionId: subscription.id },
    update: subscriptionRecordData,
    create: {
      ...subscriptionRecordData,
      stripeSubscriptionId: subscription.id,
    },
  });

  const tier = tierFromSubscriptionStatus(subscription.status);
  await prisma.user.update({
    where: { id: billingCustomer.userId },
    data: { subscriptionTier: tier },
  });
  return local;
}

export function toSubscriptionDto(
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
