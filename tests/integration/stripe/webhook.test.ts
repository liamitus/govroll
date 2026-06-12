import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type Stripe from "stripe";
import { getTestPrisma } from "../db";
import { currentPeriod } from "@/lib/budget";

// Replace Stripe signature verification with a per-test stub so we can feed
// the handler arbitrary events. Everything else (prisma, budget, ai-gate,
// moderation) stays real and points at the integration test database.
const constructEventMock = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ webhooks: { constructEvent: constructEventMock } }),
}));

const { POST } = await import("@/app/api/stripe/webhook/route");

type EventInput = {
  id: string;
  type: string;
  object: Record<string, unknown>;
};

/** Build a minimal Stripe.Event whose `data.object` carries just the fields
 *  the webhook handlers read. */
function event(input: EventInput): Stripe.Event {
  return {
    id: input.id,
    type: input.type,
    data: { object: input.object },
  } as unknown as Stripe.Event;
}

function checkoutSession(over: Record<string, unknown> = {}): EventInput {
  return {
    id: "evt_checkout_1",
    type: "checkout.session.completed",
    object: {
      mode: "payment",
      amount_total: 5000,
      payment_intent: "pi_123",
      customer: "cus_123",
      currency: "usd",
      metadata: { govrollDisplayMode: "ANONYMOUS" },
      customer_details: {
        email: "donor@example.com",
        address: { state: "OH" },
      },
      ...over,
    },
  };
}

function renewalInvoice(
  id = "evt_inv_cycle_1",
  over: Record<string, unknown> = {},
): EventInput {
  return {
    id,
    type: "invoice.payment_succeeded",
    object: {
      billing_reason: "subscription_cycle",
      amount_paid: 5000,
      parent: { subscription_details: { subscription: "sub_123" } },
      ...over,
    },
  };
}

async function deliver(input: EventInput): Promise<Response> {
  constructEventMock.mockReturnValue(event(input));
  const req = new NextRequest("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: new Headers({ "stripe-signature": "t=1,v1=test" }),
    body: "{}", // raw body is irrelevant — constructEvent is stubbed
  });
  return POST(req);
}

function ledgerRow() {
  return getTestPrisma().budgetLedger.findUnique({
    where: { period: currentPeriod() },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
});

describe("POST /api/stripe/webhook — income integrity", () => {
  it("records a one-time donation's income exactly once", async () => {
    const res = await deliver(checkoutSession());
    expect(res.status).toBe(200);
    expect((await res.json()).received).toBe(true);

    const donations = await getTestPrisma().donation.findMany();
    expect(donations).toHaveLength(1);
    expect(donations[0].amountCents).toBe(5000);
    // Logged-out donor with an email gets a self-link token, created inside
    // the same transaction as the donation + income.
    expect(await getTestPrisma().donorLinkToken.count()).toBe(1);
    expect((await ledgerRow())?.incomeCents).toBe(5000);
  });

  it("dedupes a redelivered checkout event (no double income)", async () => {
    await deliver(checkoutSession());
    await deliver(checkoutSession()); // same payment_intent → Donation dedupe

    expect(await getTestPrisma().donation.count()).toBe(1);
    expect((await ledgerRow())?.incomeCents).toBe(5000);
  });

  it("skips the subscription_create invoice (checkout already counted it)", async () => {
    // The first charge of a new subscription arrives twice: once as
    // checkout.session.completed and once as invoice.payment_succeeded with
    // billing_reason subscription_create. Only the checkout side books it.
    const res = await deliver(
      renewalInvoice("evt_inv_create", {
        billing_reason: "subscription_create",
      }),
    );
    expect(res.status).toBe(200);

    // No income booked, and the event was never claimed (we return before
    // touching the ledger or the processed-events table).
    expect(await ledgerRow()).toBeNull();
    expect(await getTestPrisma().processedStripeEvent.count()).toBe(0);
  });

  it("books a renewal once and is idempotent on redelivery", async () => {
    const first = await deliver(renewalInvoice());
    expect(first.status).toBe(200);
    expect((await ledgerRow())?.incomeCents).toBe(5000);
    expect(await getTestPrisma().processedStripeEvent.count()).toBe(1);

    // Stripe's at-least-once delivery resends the SAME event id. It must be
    // acked without incrementing income again.
    const second = await deliver(renewalInvoice());
    expect(second.status).toBe(200);
    expect((await second.json()).received).toBe(true);
    expect((await ledgerRow())?.incomeCents).toBe(5000);
  });

  it("books two distinct renewals as separate income", async () => {
    await deliver(renewalInvoice("evt_inv_cycle_1"));
    await deliver(renewalInvoice("evt_inv_cycle_2"));

    expect((await ledgerRow())?.incomeCents).toBe(10000);
    expect(await getTestPrisma().processedStripeEvent.count()).toBe(2);
  });

  it("clears a grace flag when a renewal succeeds", async () => {
    await getTestPrisma().donation.create({
      data: {
        stripePaymentId: "sub_123",
        amountCents: 5000,
        isRecurring: true,
        recurringStatus: "GRACE",
      },
    });

    await deliver(renewalInvoice());

    const donation = await getTestPrisma().donation.findUnique({
      where: { stripePaymentId: "sub_123" },
    });
    expect(donation?.recurringStatus).toBe("ACTIVE");
    expect((await ledgerRow())?.incomeCents).toBe(5000);
  });
});
