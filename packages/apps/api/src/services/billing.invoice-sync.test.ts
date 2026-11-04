import { beforeEach, describe, expect, it, vi } from 'vitest';

const { billingPaymentUpsert } = vi.hoisted(() => ({ billingPaymentUpsert: vi.fn() }));

vi.mock('../config/database.js', () => ({
  prisma: {
    billingSubscription: { findUnique: vi.fn().mockResolvedValue(null) },
    billingInvoice: { upsert: vi.fn().mockResolvedValue({ id: 'local_invoice' }) },
    billingPayment: { upsert: billingPaymentUpsert },
  },
}));
vi.mock('./notifications.js', () => ({ notificationsService: { emitEvent: vi.fn() } }));
vi.mock('./billing.sync.js', () => ({
  findOrCreateBillingCustomerByStripeId: vi.fn().mockResolvedValue({ id: 'cus', userId: 'u1' }),
}));

import { upsertInvoiceFromStripe } from './billing.invoice-sync.js';

function clientWithPayments(data: unknown[]) {
  const list = vi.fn().mockResolvedValue({ data });
  return { client: { requireStripe: () => ({ invoicePayments: { list } }) }, list };
}

const invoice = { id: 'in_1', customer: 'cus_1', amount_paid: 500, currency: 'usd' } as any;

describe('upsertInvoiceFromStripe payment linking', () => {
  beforeEach(() => billingPaymentUpsert.mockClear());

  it('fetches payments when the webhook payload does not include them', async () => {
    const { client, list } = clientWithPayments([
      { status: 'canceled', payment: { payment_intent: 'pi_old' } },
      { status: 'paid', payment: { payment_intent: 'pi_paid', charge: 'ch_1' } },
    ]);

    await upsertInvoiceFromStripe(client, invoice, 'invoice.paid');

    expect(list).toHaveBeenCalledWith({ invoice: 'in_1', limit: 100 });
    const args = billingPaymentUpsert.mock.calls[0][0];
    expect(args.where).toEqual({ stripePaymentIntentId: 'pi_paid' });
    expect(args.create.stripeChargeId).toBe('ch_1');
  });

  it('uses top-level fields from endpoints pinned to an older API version', async () => {
    const { client, list } = clientWithPayments([]);

    await upsertInvoiceFromStripe(
      client,
      { ...invoice, payment_intent: 'pi_legacy', charge: { id: 'ch_legacy' } },
      'invoice.paid'
    );

    expect(list).not.toHaveBeenCalled();
    expect(billingPaymentUpsert.mock.calls[0][0].create.stripeChargeId).toBe('ch_legacy');
  });

  it('records nothing for invoices without a payment', async () => {
    const { client } = clientWithPayments([]);

    await upsertInvoiceFromStripe(client, invoice, 'invoice.paid');

    expect(billingPaymentUpsert).not.toHaveBeenCalled();
  });
});
