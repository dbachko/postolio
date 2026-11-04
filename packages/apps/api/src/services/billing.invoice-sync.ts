import type { Prisma } from '@postolio/database';
import type Stripe from 'stripe';
import { prisma } from '../config/database.js';
import { notificationsService } from './notifications.js';
import { toDate } from './billing.shared.js';
import { findOrCreateBillingCustomerByStripeId } from './billing.sync.js';

type BillingServiceLike = any;

function resolveStripeReferenceId(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

function resolveInvoiceSubscriptionId(invoiceAny: any): string | null {
  return resolveStripeReferenceId(
    invoiceAny.parent?.subscription_details?.subscription ?? invoiceAny.subscription
  );
}

type InvoicePaymentRefs = {
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
};

function pickInvoicePayment(payments: any[] | undefined) {
  return payments?.find((entry) => entry?.status === 'paid') ?? payments?.[0];
}

/**
 * Current Stripe API versions removed `payment_intent`/`charge` from invoices and only
 * include `payments` when expanded, which webhook payloads never are, so fetch them.
 * The top-level fields still arrive on webhook endpoints pinned to an older API version.
 */
async function resolveInvoicePaymentRefs(
  client: BillingServiceLike,
  invoiceAny: any,
  invoiceId: string
): Promise<InvoicePaymentRefs> {
  if (invoiceAny.payment_intent) {
    return {
      stripePaymentIntentId: resolveStripeReferenceId(invoiceAny.payment_intent),
      stripeChargeId: resolveStripeReferenceId(invoiceAny.charge),
    };
  }

  const payments =
    invoiceAny.payments?.data ??
    (await client.requireStripe().invoicePayments.list({ invoice: invoiceId, limit: 100 })).data;
  const payment = pickInvoicePayment(payments)?.payment;
  return {
    stripePaymentIntentId: resolveStripeReferenceId(payment?.payment_intent),
    stripeChargeId: resolveStripeReferenceId(payment?.charge),
  };
}

function buildInvoiceRecordData(
  invoiceAny: any,
  billingCustomerId: string,
  localSubscriptionId: string | null
) {
  return {
    customerId: billingCustomerId,
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
  };
}

async function resolveLocalSubscriptionId(stripeSubscriptionId: string | null) {
  if (!stripeSubscriptionId) {
    return null;
  }
  const localSubscription = await prisma.billingSubscription.findUnique({
    where: { stripeSubscriptionId },
    select: { id: true },
  });
  return localSubscription?.id || null;
}

async function upsertInvoicePayment(params: {
  stripePaymentIntentId: string;
  stripeChargeId: string | null;
  billingCustomerId: string;
  invoiceAny: any;
  invoiceId: string;
  eventType: string;
}) {
  await prisma.billingPayment.upsert({
    where: { stripePaymentIntentId: params.stripePaymentIntentId },
    update: {
      customerId: params.billingCustomerId,
      amount: params.invoiceAny.amount_paid ?? params.invoiceAny.total ?? 0,
      currency: params.invoiceAny.currency || 'usd',
      status: params.eventType === 'invoice.payment_failed' ? 'failed' : 'succeeded',
      metadata: {
        source: 'invoice',
        stripeInvoiceId: params.invoiceId,
      } as Prisma.InputJsonValue,
    },
    create: {
      customerId: params.billingCustomerId,
      stripePaymentIntentId: params.stripePaymentIntentId,
      stripeChargeId: params.stripeChargeId,
      amount: params.invoiceAny.amount_paid ?? params.invoiceAny.total ?? 0,
      currency: params.invoiceAny.currency || 'usd',
      status: params.eventType === 'invoice.payment_failed' ? 'failed' : 'succeeded',
      metadata: {
        source: 'invoice',
        stripeInvoiceId: params.invoiceId,
      } as Prisma.InputJsonValue,
    },
  });
}

async function emitInvoiceNotification(userId: string, eventType: string) {
  if (eventType === 'invoice.payment_failed') {
    await notificationsService.emitEvent({
      userId,
      type: 'billing.payment_failed',
      category: 'billing',
      severity: 'error',
      title: 'Payment failed',
      body: 'Your latest payment failed. Update your payment method to keep Pro features active.',
      linkUrl: '/settings/billing',
    });
    return;
  }
  if (eventType === 'invoice.paid') {
    await notificationsService.emitEvent({
      userId,
      type: 'billing.invoice_paid',
      category: 'billing',
      severity: 'info',
      title: 'Invoice paid',
      body: 'Your latest invoice was paid successfully.',
      linkUrl: '/settings/billing',
    });
  }
}

export async function upsertInvoiceFromStripe(
  client: BillingServiceLike,
  invoice: Stripe.Invoice,
  eventType: string
) {
  const invoiceAny = invoice as any;
  const invoiceId = (invoice as any).id as string | undefined;
  if (!invoiceId) {
    return null;
  }

  const stripeCustomerId = resolveStripeReferenceId(invoice.customer);
  if (!stripeCustomerId) {
    return null;
  }

  const billingCustomer = await findOrCreateBillingCustomerByStripeId(client, stripeCustomerId);
  if (!billingCustomer) {
    return null;
  }

  const stripeSubscriptionId = resolveInvoiceSubscriptionId(invoiceAny);
  const localSubscriptionId = await resolveLocalSubscriptionId(stripeSubscriptionId);
  const invoiceRecordData = buildInvoiceRecordData(
    invoiceAny,
    billingCustomer.id,
    localSubscriptionId
  );

  const localInvoice = await prisma.billingInvoice.upsert({
    where: { stripeInvoiceId: invoiceId },
    update: invoiceRecordData,
    create: {
      ...invoiceRecordData,
      stripeInvoiceId: invoiceId,
    },
  });

  const { stripePaymentIntentId, stripeChargeId } = await resolveInvoicePaymentRefs(
    client,
    invoiceAny,
    invoiceId
  );
  if (stripePaymentIntentId) {
    await upsertInvoicePayment({
      stripePaymentIntentId,
      stripeChargeId,
      billingCustomerId: billingCustomer.id,
      invoiceAny,
      invoiceId,
      eventType,
    });
  }

  await emitInvoiceNotification(billingCustomer.userId, eventType);
  return localInvoice;
}
