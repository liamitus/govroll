-- Idempotency ledger for Stripe webhook delivery. Stripe delivers events
-- at-least-once and retries anything not acked with a 2xx (including on
-- timeout), so the same event.id can arrive multiple times. The webhook claims
-- the id here inside the same transaction that records the event's income, so
-- a duplicate delivery hits the primary key and is acked without
-- double-counting — while a mid-handler failure rolls the claim back and lets
-- Stripe's retry re-apply it.
--
-- Before this, the recurring-renewal path (invoice.payment_succeeded) created
-- no Donation row and so had no dedupe key at all: every redelivery of a
-- renewal invoice incremented incomeCents again. The first-charge/one-time
-- path keeps deduping on Donation.stripePaymentId.
CREATE TABLE "ProcessedStripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedStripeEvent_pkey" PRIMARY KEY ("id")
);

-- Project stance: RLS on every public-schema table (see
-- 20260430120000_enable_rls_on_new_tables). This table is written only by the
-- webhook through the service-role connection; no policies means no anon
-- access via PostgREST.
ALTER TABLE "ProcessedStripeEvent" ENABLE ROW LEVEL SECURITY;
