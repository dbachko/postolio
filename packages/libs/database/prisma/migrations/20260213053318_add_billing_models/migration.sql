-- CreateTable
CREATE TABLE "billing_customers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_products" (
    "id" TEXT NOT NULL,
    "stripeProductId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_prices" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "stripePriceId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "unitAmount" INTEGER NOT NULL,
    "interval" TEXT,
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "trialDays" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_subscriptions" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "priceId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "trialStart" TIMESTAMP(3),
    "trialEnd" TIMESTAMP(3),
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_payment_methods" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "stripePaymentMethodId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "cardBrand" TEXT,
    "cardLastFour" TEXT,
    "cardExpMonth" INTEGER,
    "cardExpYear" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_invoices" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "stripeInvoiceId" TEXT NOT NULL,
    "number" TEXT,
    "status" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "amountPaid" INTEGER NOT NULL DEFAULT 0,
    "amountDue" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3),
    "invoicePdfUrl" TEXT,
    "hostedInvoiceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_payments" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "brandId" TEXT,
    "stripePaymentIntentId" TEXT NOT NULL,
    "stripeChargeId" TEXT,
    "idempotencyKey" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "creditsGranted" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_webhook_events" (
    "id" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_customers_userId_key" ON "billing_customers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_customers_stripeCustomerId_key" ON "billing_customers"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "billing_customers_stripeCustomerId_idx" ON "billing_customers"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_products_stripeProductId_key" ON "billing_products"("stripeProductId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_prices_stripePriceId_key" ON "billing_prices"("stripePriceId");

-- CreateIndex
CREATE INDEX "billing_prices_stripePriceId_idx" ON "billing_prices"("stripePriceId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_subscriptions_stripeSubscriptionId_key" ON "billing_subscriptions"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "billing_subscriptions_customerId_idx" ON "billing_subscriptions"("customerId");

-- CreateIndex
CREATE INDEX "billing_subscriptions_stripeSubscriptionId_idx" ON "billing_subscriptions"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "billing_subscriptions_status_idx" ON "billing_subscriptions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payment_methods_stripePaymentMethodId_key" ON "billing_payment_methods"("stripePaymentMethodId");

-- CreateIndex
CREATE INDEX "billing_payment_methods_customerId_idx" ON "billing_payment_methods"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_invoices_stripeInvoiceId_key" ON "billing_invoices"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "billing_invoices_customerId_idx" ON "billing_invoices"("customerId");

-- CreateIndex
CREATE INDEX "billing_invoices_stripeInvoiceId_idx" ON "billing_invoices"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "billing_invoices_status_idx" ON "billing_invoices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payments_stripePaymentIntentId_key" ON "billing_payments"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payments_stripeChargeId_key" ON "billing_payments"("stripeChargeId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_payments_idempotencyKey_key" ON "billing_payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "billing_payments_customerId_idx" ON "billing_payments"("customerId");

-- CreateIndex
CREATE INDEX "billing_payments_status_idx" ON "billing_payments"("status");

-- CreateIndex
CREATE INDEX "billing_payments_brandId_idx" ON "billing_payments"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_webhook_events_stripeEventId_key" ON "billing_webhook_events"("stripeEventId");

-- CreateIndex
CREATE INDEX "billing_webhook_events_stripeEventId_idx" ON "billing_webhook_events"("stripeEventId");

-- CreateIndex
CREATE INDEX "billing_webhook_events_type_idx" ON "billing_webhook_events"("type");

-- CreateIndex
CREATE INDEX "billing_webhook_events_status_idx" ON "billing_webhook_events"("status");

-- AddForeignKey
ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_prices" ADD CONSTRAINT "billing_prices_productId_fkey" FOREIGN KEY ("productId") REFERENCES "billing_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "billing_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_priceId_fkey" FOREIGN KEY ("priceId") REFERENCES "billing_prices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payment_methods" ADD CONSTRAINT "billing_payment_methods_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "billing_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "billing_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "billing_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "billing_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
