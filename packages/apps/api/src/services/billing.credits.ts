import type { Prisma } from '@postolio/database';
import type Stripe from 'stripe';
import { prisma } from '../config/database.js';
import { topUpAiCredits } from './ai-credits.js';
import { notificationsService } from './notifications.js';
import type { CreditPack } from '../schemas/billing.js';
import { CREDIT_PACKS } from './billing.shared.js';
import { ensureBillingCustomer, findOrCreateBillingCustomerByStripeId } from './billing.sync.js';

type BillingServiceLike = any;

function resolveStripeCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined
): string | null {
  if (!customer) {
    return null;
  }
  if (typeof customer === 'string') {
    return customer;
  }
  return customer.id || null;
}

function buildPaymentMethodPayload(paymentMethod: Stripe.PaymentMethod) {
  return {
    type: paymentMethod.type || 'card',
    cardBrand: paymentMethod.card?.brand || null,
    cardLastFour: paymentMethod.card?.last4 || null,
    cardExpMonth: paymentMethod.card?.exp_month || null,
    cardExpYear: paymentMethod.card?.exp_year || null,
  };
}

export async function handlePaymentMethodAttached(
  client: BillingServiceLike,
  paymentMethod: Stripe.PaymentMethod
) {
  const stripeCustomerId = resolveStripeCustomerId(paymentMethod.customer);
  if (!stripeCustomerId) {
    return;
  }

  const billingCustomer = await findOrCreateBillingCustomerByStripeId(client, stripeCustomerId);
  if (!billingCustomer) {
    return;
  }

  const paymentMethodPayload = buildPaymentMethodPayload(paymentMethod);
  await prisma.billingPaymentMethod.upsert({
    where: { stripePaymentMethodId: paymentMethod.id },
    update: {
      customerId: billingCustomer.id,
      ...paymentMethodPayload,
    },
    create: {
      customerId: billingCustomer.id,
      stripePaymentMethodId: paymentMethod.id,
      ...paymentMethodPayload,
    },
  });
}

export async function handlePaymentMethodDetached(paymentMethod: Stripe.PaymentMethod) {
  await prisma.billingPaymentMethod.deleteMany({
    where: { stripePaymentMethodId: paymentMethod.id },
  });
}

export async function handleTrialWillEnd(
  client: BillingServiceLike,
  subscription: Stripe.Subscription
) {
  const stripeCustomerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
  const billingCustomer = await findOrCreateBillingCustomerByStripeId(client, stripeCustomerId);
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

function parseCreditTopupSession(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId || '';
  const brandId = session.metadata?.brandId || '';
  const creditPack = (session.metadata?.creditPack || '') as CreditPack;
  const credits = Number.parseInt(session.metadata?.credits || '', 10);
  if (!userId || !brandId || !creditPack || !Number.isFinite(credits) || credits <= 0) {
    return null;
  }
  return { userId, brandId, creditPack, credits };
}

async function upsertCreditTopupPayment(params: {
  stripePaymentIntentId: string;
  billingCustomerId: string;
  brandId: string;
  amount: number;
  currency: string;
  sessionId: string;
  creditPack: CreditPack;
  credits: number;
}) {
  await prisma.billingPayment.upsert({
    where: { stripePaymentIntentId: params.stripePaymentIntentId },
    update: {
      customerId: params.billingCustomerId,
      brandId: params.brandId,
      amount: params.amount,
      currency: params.currency,
      status: 'succeeded',
      idempotencyKey: params.sessionId,
      creditsGranted: params.credits,
      metadata: {
        source: 'credit_topup',
        checkoutSessionId: params.sessionId,
        creditPack: params.creditPack,
      } as Prisma.InputJsonValue,
    },
    create: {
      customerId: params.billingCustomerId,
      brandId: params.brandId,
      stripePaymentIntentId: params.stripePaymentIntentId,
      amount: params.amount,
      currency: params.currency,
      status: 'succeeded',
      idempotencyKey: params.sessionId,
      creditsGranted: params.credits,
      metadata: {
        source: 'credit_topup',
        checkoutSessionId: params.sessionId,
        creditPack: params.creditPack,
      } as Prisma.InputJsonValue,
    },
  });
}

async function resolveBillingCustomerForCreditTopup(params: {
  client: BillingServiceLike;
  session: Stripe.Checkout.Session;
  userId: string;
}) {
  const stripeCustomerId = resolveStripeCustomerId(params.session.customer);
  if (stripeCustomerId) {
    return findOrCreateBillingCustomerByStripeId(params.client, stripeCustomerId, params.userId);
  }
  return ensureBillingCustomer(params.client, params.userId);
}

function resolvePaymentIntentId(session: Stripe.Checkout.Session): string {
  if (typeof session.payment_intent === 'string') {
    return session.payment_intent;
  }
  return `checkout_session_${session.id}`;
}

export async function handleCreditTopupCheckout(
  client: BillingServiceLike,
  session: Stripe.Checkout.Session
) {
  const parsed = parseCreditTopupSession(session);
  if (!parsed) {
    client.logger.warn('Skipping credit top-up because session metadata is incomplete', {
      sessionId: session.id,
      userId: session.metadata?.userId,
      brandId: session.metadata?.brandId,
      creditPack: session.metadata?.creditPack,
      creditsRaw: session.metadata?.credits,
    });
    return;
  }

  const brand = await prisma.brand.findFirst({
    where: { id: parsed.brandId, userId: parsed.userId },
    select: { id: true, name: true },
  });
  if (!brand) {
    client.logger.warn('Skipping credit top-up because brand ownership verification failed', {
      sessionId: session.id,
      userId: parsed.userId,
      brandId: parsed.brandId,
    });
    return;
  }

  const billingCustomer = await resolveBillingCustomerForCreditTopup({
    client,
    session,
    userId: parsed.userId,
  });
  if (!billingCustomer) {
    client.logger.warn('No billing customer found for credit top-up', {
      sessionId: session.id,
      userId: parsed.userId,
    });
    return;
  }

  const stripePaymentIntentId = resolvePaymentIntentId(session);
  const existingPayment = await prisma.billingPayment.findUnique({
    where: { stripePaymentIntentId },
    select: { id: true, status: true },
  });
  if (existingPayment?.status === 'succeeded') {
    return;
  }

  await upsertCreditTopupPayment({
    stripePaymentIntentId,
    billingCustomerId: billingCustomer.id,
    brandId: brand.id,
    amount: session.amount_total ?? CREDIT_PACKS[parsed.creditPack].defaultUsdAmountCents,
    currency: session.currency || 'usd',
    sessionId: session.id,
    creditPack: parsed.creditPack,
    credits: parsed.credits,
  });

  await topUpAiCredits({
    brandId: brand.id,
    credits: parsed.credits,
    note: `Credit pack purchase: ${CREDIT_PACKS[parsed.creditPack].label} (${parsed.credits} credits)`,
  });

  await notificationsService.emitEvent({
    userId: parsed.userId,
    brandId: brand.id,
    type: 'billing.credit_topup_succeeded',
    category: 'billing',
    severity: 'info',
    title: 'Credits added',
    body: `${parsed.credits} AI credits were added to ${brand.name}.`,
    linkUrl: '/settings/billing',
  });
}
