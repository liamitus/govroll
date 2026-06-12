import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { recordIncome } from "@/lib/budget";
import { invalidateAiGateCache } from "@/lib/ai-gate";
import { moderateName } from "@/lib/moderation/pipeline";
import { generateCitizenId } from "@/lib/citizen-id";
import { randomBytes } from "crypto";
import { reportError } from "@/lib/error-reporting";

/** True for Prisma's unique/primary-key violation. The webhook uses it to
 *  detect a duplicate Stripe delivery racing on the ProcessedStripeEvent
 *  claim and ack it instead of 500ing. */
function isDuplicateKeyError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

/**
 * POST /api/stripe/webhook
 *
 * Single entry point for all Stripe webhook events. Handles:
 *   - checkout.session.completed  → create Donation row, run moderation, update budget
 *   - invoice.payment_succeeded   → recurring renewal income
 *   - customer.subscription.deleted → mark recurring as canceled
 *   - invoice.payment_failed      → start grace period
 */

export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const sig = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return NextResponse.json(
      { error: "Missing signature or webhook secret." },
      { status: 400 },
    );
  }

  let event: Stripe.Event;
  try {
    const rawBody = await request.text();
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Webhook signature verification failed:", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;

      case "invoice.payment_succeeded":
        await handleInvoiceSucceeded(
          event.data.object as Stripe.Invoice,
          event,
        );
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;

      case "invoice.payment_failed":
        await handleInvoiceFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        // Unhandled event type — ack it so Stripe doesn't retry
        break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(
      JSON.stringify({
        event: "webhook_error",
        route: "POST /api/stripe/webhook",
        eventType: event.type,
        error: msg,
        stack,
      }),
    );
    reportError(err, {
      route: "POST /api/stripe/webhook",
      eventType: event.type,
    });
    // Expose the message to Stripe so it shows up in the Dashboard's response
    // body. This endpoint is only reachable with a valid Stripe signature.
    return NextResponse.json(
      { error: "Webhook handler failed.", detail: msg },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}

// ── Event handlers ─────────────────────────────────────────────────

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const meta = session.metadata ?? {};
  const displayMode = (meta.govrollDisplayMode || "ANONYMOUS") as
    | "ANONYMOUS"
    | "NAMED"
    | "TRIBUTE";
  const displayNameRaw = meta.govrollDisplayNameRaw || null;
  const tributeNameRaw = meta.govrollTributeNameRaw || null;
  const userId = meta.govrollUserId || null;

  const isRecurring = session.mode === "subscription";
  const amountCents = session.amount_total ?? 0;

  // Dedupe — Stripe can send the same event twice
  const stripePaymentId = isRecurring
    ? (session.subscription as string)
    : (session.payment_intent as string);

  if (!stripePaymentId) {
    console.error("No payment/subscription ID in checkout session");
    return;
  }

  const existing = await prisma.donation.findUnique({
    where: { stripePaymentId },
  });
  if (existing) return; // Already processed

  // Get IP from the session for rate limiting (if available via metadata — Stripe doesn't expose client IP directly)
  // For now, moderation runs without IP-based rate limiting on the webhook path
  const ip = undefined;

  // Run moderation on display name
  const nameMod = await moderateName(
    displayMode === "NAMED" ? displayNameRaw : null,
    ip,
  );

  // Run moderation on tribute name separately
  const tributeMod = await moderateName(
    displayMode === "TRIBUTE" ? tributeNameRaw : null,
    ip,
  );

  // Use the worse moderation status between the two
  const finalStatus =
    nameMod.status === "REJECTED" || tributeMod.status === "REJECTED"
      ? "REJECTED"
      : nameMod.status === "FLAGGED" || tributeMod.status === "FLAGGED"
        ? "FLAGGED"
        : "APPROVED";

  const notes =
    [nameMod.notes, tributeMod.notes].filter(Boolean).join("; ") || null;

  // Extract region from billing address if available
  const regionCode = session.customer_details?.address?.state
    ? `US-${session.customer_details.address.state}`
    : null;

  // Ensure a Profile exists for the FK target. Authenticated donors may not
  // have touched any other authenticated endpoint yet, so the lazy upsert in
  // getAuthenticatedUser() hasn't run for them. Bootstrap the row here with
  // the email Stripe captured. If the userId is garbage, skip the association
  // rather than fail the whole webhook.
  let safeUserId: string | null = null;
  if (userId) {
    try {
      await prisma.profile.upsert({
        where: { id: userId },
        update: { email: session.customer_details?.email ?? undefined },
        create: {
          // Safe, non-user-controlled seed. getAuthenticatedUser() no longer
          // overwrites Profile.username on later requests, so a donor-first row
          // would otherwise stay "Anonymous" forever. The real display name is
          // set later through the moderated PATCH /api/account/username route.
          id: userId,
          username: generateCitizenId(userId),
          email: session.customer_details?.email ?? null,
        },
      });
      safeUserId = userId;
    } catch (err) {
      console.warn(
        JSON.stringify({
          event: "profile_upsert_failed",
          userId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  // Create the Donation row, its optional link token, and the income
  // increment in ONE transaction. The Donation row is this path's dedupe
  // key (the findUnique above short-circuits a retry), so it must not exist
  // without the matching income recorded — otherwise a crash between the two
  // would have the retry early-return and silently drop the income. Either
  // all three commit, or the retry redoes all three.
  await prisma.$transaction(async (tx) => {
    const donation = await tx.donation.create({
      data: {
        stripePaymentId,
        stripeCustomerId: (session.customer as string) ?? null,
        userId: safeUserId,
        amountCents,
        currency: session.currency ?? "usd",
        isRecurring,
        recurringStatus: isRecurring ? "ACTIVE" : null,
        displayMode,
        displayName:
          finalStatus === "APPROVED" ? (nameMod.displayName ?? null) : null,
        displayNameRaw,
        tributeName:
          finalStatus === "APPROVED" ? (tributeMod.displayName ?? null) : null,
        tributeNameRaw,
        moderationStatus: finalStatus,
        moderationNotes: notes,
        regionCode,
        email: session.customer_details?.email ?? null,
      },
    });

    // Link token so a logged-out donor can attach this to their account later.
    if (!userId && donation.email) {
      await tx.donorLinkToken.create({
        data: {
          donationId: donation.id,
          token: randomBytes(32).toString("hex"),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        },
      });
      // TODO: send email with link token (Phase 6)
    }

    await recordIncome(amountCents, { client: tx });
  });

  invalidateAiGateCache();
}

function getSubscriptionId(invoice: Stripe.Invoice): string | null {
  const sub = invoice.parent?.subscription_details?.subscription;
  if (!sub) return null;
  return typeof sub === "string" ? sub : sub.id;
}

async function handleInvoiceSucceeded(
  invoice: Stripe.Invoice,
  event: Stripe.Event,
) {
  // A brand-new subscription emits BOTH checkout.session.completed and this
  // invoice.payment_succeeded (billing_reason "subscription_create") for the
  // same first charge. handleCheckoutCompleted already recorded that income and
  // created the canonical Donation row, so recording it again here would
  // double-count the first month. Renewals arrive as "subscription_cycle".
  if (invoice.billing_reason === "subscription_create") return;

  // Recurring renewal — record income but don't create a new Donation row
  // (the original subscription Donation is the canonical record).
  const amountCents = invoice.amount_paid ?? 0;
  if (amountCents <= 0) return;

  const subscriptionId = getSubscriptionId(invoice);

  // Claim the event id and record the income in one transaction. This path
  // creates no Donation row, so ProcessedStripeEvent is its ONLY dedupe key:
  // Stripe delivers at-least-once and retries on timeout/5xx, so a redelivered
  // renewal would otherwise increment income again. A duplicate hits the
  // primary key, rolls back, and is acked below; a transient failure rolls the
  // claim back too, so the retry re-applies cleanly.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.processedStripeEvent.create({
        data: { id: event.id, type: event.type },
      });

      // Clear any grace/lapsed flag now that a renewal has succeeded.
      if (subscriptionId) {
        await tx.donation.updateMany({
          where: {
            stripePaymentId: subscriptionId,
            recurringStatus: { in: ["GRACE", "LAPSED"] },
          },
          data: { recurringStatus: "ACTIVE" },
        });
      }

      await recordIncome(amountCents, { client: tx });
    });
  } catch (err) {
    // Duplicate delivery — this event id was already processed. Ack it so
    // Stripe stops retrying instead of surfacing a 500.
    if (isDuplicateKeyError(err)) return;
    throw err;
  }

  invalidateAiGateCache();
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  await prisma.donation.updateMany({
    where: { stripePaymentId: subscription.id },
    data: { recurringStatus: "CANCELED" },
  });
}

async function handleInvoiceFailed(invoice: Stripe.Invoice) {
  // Start grace period — Stripe's smart retries will attempt recovery for ~2 weeks.
  // Don't immediately strip Sustainer status.
  const subscriptionId = getSubscriptionId(invoice);
  if (!subscriptionId) return;

  await prisma.donation.updateMany({
    where: {
      stripePaymentId: subscriptionId,
      recurringStatus: "ACTIVE",
    },
    data: { recurringStatus: "GRACE" },
  });
}
