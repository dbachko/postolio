import type { Prisma } from '@postolio/database';
import type Stripe from 'stripe';
import { prisma } from '../config/database.js';
import {
  handleCreditTopupCheckout,
  handlePaymentMethodAttached,
  handlePaymentMethodDetached,
  handleTrialWillEnd,
} from './billing.credits.js';
import { syncSubscriptionFromStripe } from './billing.sync.js';
import { upsertInvoiceFromStripe } from './billing.invoice-sync.js';

type BillingServiceLike = any;

async function ensureWebhookEventRecord(event: Stripe.Event) {
  const existing = await prisma.billingWebhookEvent.findUnique({
    where: { stripeEventId: event.id },
    select: { status: true },
  });
  if (existing?.status === 'processed') {
    return false;
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

  return true;
}

async function markWebhookEventStatus(
  eventId: string,
  status: 'processing' | 'processed' | 'failed',
  errorMessage?: string | null
) {
  await prisma.billingWebhookEvent.update({
    where: { stripeEventId: eventId },
    data: {
      status,
      ...(status === 'processed' ? { processedAt: new Date(), errorMessage: null } : {}),
      ...(status === 'failed' ? { errorMessage: errorMessage || 'Unknown error' } : {}),
    },
  });
}

async function dispatchWebhookEvent(client: BillingServiceLike, event: Stripe.Event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === 'subscription' && typeof session.subscription === 'string') {
        const stripe = client.requireStripe();
        const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription);
        await syncSubscriptionFromStripe(client, stripeSubscription);
      } else if (session.mode === 'payment' && session.metadata?.type === 'credit_topup') {
        await handleCreditTopupCheckout(client, session);
      }
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await syncSubscriptionFromStripe(client, event.data.object as Stripe.Subscription);
      return;
    case 'invoice.paid':
    case 'invoice.payment_failed':
      await upsertInvoiceFromStripe(client, event.data.object as Stripe.Invoice, event.type);
      return;
    case 'customer.subscription.trial_will_end':
      await handleTrialWillEnd(client, event.data.object as Stripe.Subscription);
      return;
    case 'payment_method.attached':
      await handlePaymentMethodAttached(client, event.data.object as Stripe.PaymentMethod);
      return;
    case 'payment_method.detached':
      await handlePaymentMethodDetached(event.data.object as Stripe.PaymentMethod);
      return;
    default:
      client.logger.debug('Unhandled Stripe webhook event', { eventType: event.type });
  }
}

export async function processWebhookEvent(client: BillingServiceLike, event: Stripe.Event) {
  const shouldProcess = await ensureWebhookEventRecord(event);
  if (!shouldProcess) {
    return;
  }

  await markWebhookEventStatus(event.id, 'processing');
  try {
    await dispatchWebhookEvent(client, event);
    await markWebhookEventStatus(event.id, 'processed');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markWebhookEventStatus(event.id, 'failed', message);
    throw error;
  }
}
