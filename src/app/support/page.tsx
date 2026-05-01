import {
  getBudgetSnapshot,
  getTypicalDonationCents,
  previousMonthSpendCents,
} from "@/lib/budget";
import { totalMonthlyCostCents } from "@/lib/site-costs";
import { prisma } from "@/lib/prisma";
import { DonateForm } from "./donate-form";
import { BudgetThermometer } from "./budget-thermometer";
import Link from "next/link";

export const metadata = {
  title: "Support Govroll — Keep Civic Tools Free",
  description:
    "Govroll is supported by citizens, not lobbyists. See exactly what it costs to run each month — and chip in if you want to.",
};

export const dynamic = "force-dynamic";
export const revalidate = 300; // 5 min cache

export default async function SupportPage() {
  const [snapshot, typicalCents, donorCount, lastMonthSpend] =
    await Promise.all([
      getBudgetSnapshot(),
      getTypicalDonationCents(),
      prisma.donation.count({
        where: { moderationStatus: { in: ["APPROVED", "PENDING"] } },
      }),
      previousMonthSpendCents(),
    ]);

  const totalCostCents = totalMonthlyCostCents(
    snapshot.spendCents,
    lastMonthSpend,
  );
  const funded = snapshot.incomeCents >= totalCostCents;

  return (
    <div className="mx-auto max-w-2xl space-y-10 px-4 py-10">
      {/* Hero */}
      <header className="space-y-3 text-center">
        <p className="text-civic-gold star-accent text-sm tracking-widest uppercase">
          Citizen-Supported
        </p>
        <h1 className="text-4xl font-bold tracking-tight">
          Govroll is supported by citizens,{" "}
          <span className="text-navy-light">not lobbyists.</span>
        </h1>
        <p className="text-muted-foreground mx-auto max-w-lg text-base">
          This site costs real money to run — hosting, database, AI&nbsp;APIs.
          No ads. No corporate sponsors. No paywalls. Just citizens chipping in
          to keep it free for everyone.
        </p>
      </header>

      {/* Budget thermometer */}
      <BudgetThermometer
        incomeCents={snapshot.incomeCents}
        spendCents={snapshot.spendCents}
        lastMonthSpendCents={lastMonthSpend}
        aiEnabled={snapshot.aiEnabled}
        period={snapshot.period}
      />

      {/* Context-sensitive message */}
      {funded ? (
        <p className="text-muted-foreground mx-auto max-w-md text-center text-base">
          Govroll is funded this month — thank you! Extra contributions help me
          work on this full-time, but please don&apos;t feel obligated.
        </p>
      ) : (
        <p className="text-muted-foreground mx-auto max-w-md text-center text-base">
          Donating is totally optional. When enough citizens chip in, AI
          features come back online for everyone — including you, for&nbsp;free.
        </p>
      )}

      {/* Donate form */}
      <DonateForm typicalDonationCents={typicalCents} donorCount={donorCount} />

      {/* Social proof */}
      {donorCount > 0 && (
        <p className="text-muted-foreground text-center text-sm">
          Join{" "}
          <Link
            href="/made-possible-by"
            className="text-primary hover:text-navy underline underline-offset-2"
          >
            {`${donorCount.toLocaleString("en-US")} citizen${donorCount !== 1 ? "s" : ""}`}
          </Link>{" "}
          keeping Govroll running.
        </p>
      )}

      {/* Other ways to help */}
      <p className="text-muted-foreground text-center text-base">
        Prefer contributing time instead of money? Govroll is open source —
        browse open{" "}
        <a
          href="https://github.com/liamitus/govroll/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:text-navy underline underline-offset-2"
        >
          issues on GitHub
        </a>
        .
      </p>

      {/* Legal disclosure */}
      <footer className="text-muted-foreground space-y-2 border-t pt-6 text-sm leading-relaxed">
        <p>
          Contributions are processed by Stripe and received by Govroll.
          Contributions are <strong>not tax-deductible</strong> for U.S. federal
          income tax purposes.
        </p>
        <p>
          Refunds are available within 14 days for accidental or duplicate
          charges. Recurring contributions can be canceled at any time.{" "}
          <Link
            href="/support/terms"
            className="hover:text-foreground underline"
          >
            Full terms
          </Link>
        </p>
      </footer>
    </div>
  );
}
