import type { HttpRequest } from '../http/http';

export type CreditPack = 'starter' | 'standard' | 'bulk';

export interface BillingSubscription {
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
}

export interface BillingInvoice {
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
}

export class BillingClient {
  constructor(private request: HttpRequest) {}

  createCheckoutSession(input: { priceId: string; successUrl?: string; cancelUrl?: string }) {
    return this.request('/api/billing/checkout/subscription', {
      method: 'POST',
      body: JSON.stringify(input),
    }) as Promise<{ sessionId: string; url: string }>;
  }

  createCreditCheckout(input: {
    brandId: string;
    creditPack: CreditPack;
    successUrl?: string;
    cancelUrl?: string;
  }) {
    return this.request('/api/billing/checkout/credits', {
      method: 'POST',
      body: JSON.stringify(input),
    }) as Promise<{ sessionId: string; url: string }>;
  }

  getSubscription() {
    return this.request('/api/billing/subscription') as Promise<{
      tier: string;
      subscription: BillingSubscription | null;
    }>;
  }

  cancelSubscription() {
    return this.request('/api/billing/subscription/cancel', {
      method: 'POST',
      body: JSON.stringify({}),
    }) as Promise<{ tier: string; subscription: BillingSubscription | null }>;
  }

  reactivateSubscription() {
    return this.request('/api/billing/subscription/reactivate', {
      method: 'POST',
      body: JSON.stringify({}),
    }) as Promise<{ tier: string; subscription: BillingSubscription | null }>;
  }

  getInvoices(limit = 10, startingAfter?: string) {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (startingAfter) {
      params.set('startingAfter', startingAfter);
    }
    return this.request(`/api/billing/invoices?${params.toString()}`) as Promise<{
      invoices: BillingInvoice[];
      hasMore: boolean;
    }>;
  }

  createPortalSession(returnUrl?: string) {
    return this.request('/api/billing/portal', {
      method: 'POST',
      body: JSON.stringify(returnUrl ? { returnUrl } : {}),
    }) as Promise<{ url: string }>;
  }
}
