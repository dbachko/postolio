import Stripe from 'stripe';

let cachedStripeClient: Stripe | null | undefined;

export function getStripeClient(): Stripe | null {
  if (cachedStripeClient !== undefined) {
    return cachedStripeClient;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    console.warn('STRIPE_SECRET_KEY is not set; billing features are disabled.');
    cachedStripeClient = null;
    return cachedStripeClient;
  }

  try {
    cachedStripeClient = new Stripe(secretKey, {
      appInfo: {
        name: 'postolio-api',
      },
    });
  } catch (error) {
    console.error('Failed to initialize Stripe client:', error);
    cachedStripeClient = null;
  }

  return cachedStripeClient;
}

export function resetStripeClientCache(): void {
  cachedStripeClient = undefined;
}
