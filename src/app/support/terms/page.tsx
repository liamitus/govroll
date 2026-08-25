import Link from "next/link";

export const metadata = {
  title: "Contribution Terms — Govroll",
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-10">
      <header className="space-y-2">
        <Link
          href="/support"
          className="text-sapphire-deep text-sm hover:underline"
        >
          Back to Support
        </Link>
        <h1 className="text-4xl font-bold">Contribution Terms</h1>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">About your contribution</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          Govroll is an independent civic transparency project supported
          entirely by reader contributions. Your contribution helps cover the
          infrastructure, data, and AI costs that keep the platform running and
          free to use.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Tax status</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          Govroll is not currently a registered 501(c)(3) organization.
          Contributions are{" "}
          <strong className="text-ink">not tax-deductible</strong> for U.S.
          federal income tax purposes. You should not claim your contribution as
          a charitable deduction.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">
          Who receives your contribution
        </h2>
        <p className="text-ink-muted text-base leading-relaxed">
          Contributions are processed by Stripe and received by Govroll, the
          operator of this platform.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">One-time contributions</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          Your card will be charged once for the amount you select. You will
          receive an email receipt within a few minutes.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Recurring contributions</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          If you choose to support Govroll monthly, your card will be charged
          the same amount on the same day each month until you cancel. You can
          cancel at any time by replying to any receipt email or emailing{" "}
          <span className="text-ink font-medium">support@govroll.com</span>.
          Cancellations take effect immediately and no further charges will be
          made. Canceling does not refund prior months.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Display of your contribution</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          By default, contributions are shown anonymously on Govroll&apos;s{" "}
          <Link
            href="/made-possible-by"
            className="text-sapphire-deep hover:underline"
          >
            Made possible by
          </Link>{" "}
          page. If you choose to be listed by name or to dedicate your
          contribution in honor of someone, the name you provide may be
          displayed publicly after a brief moderation review. You can change how
          your contribution is displayed — or remove it from public display
          entirely — at any time from your account page or by contacting us.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Refund policy</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          All contributions to Govroll are considered final and non-refundable,
          with two exceptions:
        </p>
        <ol className="text-ink-muted list-decimal space-y-2 pl-5 text-base leading-relaxed">
          <li>
            <strong className="text-ink">Input errors.</strong> If you
            accidentally contributed the wrong amount, made a duplicate
            contribution, or contributed in error, email{" "}
            <span className="text-ink font-medium">support@govroll.com</span>{" "}
            within 14 days of the charge and we will refund the transaction in
            full.
          </li>
          <li>
            <strong className="text-ink">Unauthorized charges.</strong> If a
            charge was made without your authorization, contact us immediately
            and we will refund the charge and take appropriate steps to prevent
            recurrence.
          </li>
        </ol>
        <p className="text-ink-muted text-base leading-relaxed">
          Refunds are processed through Stripe and typically appear on your
          statement within 5&ndash;10 business days. Recurring contributions can
          be canceled at any time and will stop future charges immediately. Past
          monthly charges are subject to the same 14-day window above.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Name display and moderation</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          Govroll&apos;s Made possible by page celebrates the people who fund
          this platform. To keep that space focused on individual supporters
          rather than organizations or political messaging, the following rules
          apply:
        </p>
        <ul className="text-ink-muted list-disc space-y-1 pl-5 text-base leading-relaxed">
          <li>
            <strong className="text-ink">Personal names only.</strong> We do not
            display names of companies, organizations, political parties,
            political campaigns, or advocacy groups.
          </li>
          <li>
            <strong className="text-ink">Tribute dedications</strong> (&ldquo;In
            honor of [name]&rdquo;) must also be personal names — a family
            member, a teacher, a friend. Not a company, campaign, or official.
          </li>
          <li>
            <strong className="text-ink">
              No public figures without consent.
            </strong>{" "}
            We decline names of sitting politicians, candidates, and prominent
            public figures to avoid any implication of endorsement.
          </li>
          <li>
            No slurs, harassment, impersonation, URLs, or promotional content.
          </li>
        </ul>
        <p className="text-ink-muted text-base leading-relaxed">
          Submitted names are reviewed by a combination of automated moderation
          and human review. If a name cannot be used, your contribution will
          still be processed — it will simply be displayed anonymously, and we
          will contact you if you would like to submit a different name.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Your data</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          We store: your contribution amount, the date, the payment method
          identifier provided by Stripe, and (optionally) the email address and
          display name you provide. We do not store your full card number. We do
          not share your contribution data with third parties except as required
          to process the payment (Stripe) or respond to lawful legal requests.
        </p>
        <p className="text-ink-muted text-base leading-relaxed">
          You can request removal of your name from public display, or deletion
          of your contribution record entirely (subject to legal record-keeping
          requirements), at any time by contacting{" "}
          <span className="text-ink font-medium">support@govroll.com</span>.
        </p>
      </section>
    </div>
  );
}
