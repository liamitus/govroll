import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — Govroll",
  description: "Terms governing use of the Govroll platform.",
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-10">
      <header className="space-y-2">
        <p className="text-ink-muted text-[11px] font-bold tracking-[0.18em] uppercase">
          Legal
        </p>
        <h1 className="text-4xl font-bold">Terms of Service</h1>
        <p className="text-ink-muted text-sm">Last updated: April 11, 2026</p>
      </header>

      <p className="text-ink-muted text-base leading-relaxed">
        These Terms of Service (&ldquo;Terms&rdquo;) govern your use of Govroll
        (the &ldquo;Service&rdquo;), operated at govroll.com. By accessing or
        using Govroll, you agree to be bound by these Terms. If you do not
        agree, do not use the Service.
      </p>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">1. Description of the Service</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          Govroll is a civic transparency platform that displays U.S.
          congressional legislation, voting records, and representative
          information sourced from official government data. We use artificial
          intelligence to generate plain-language summaries of bills and provide
          tools for civic engagement including comments and discussions.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">
          2. Important disclaimers about information accuracy
        </h2>
        <div className="border-rule bg-paper space-y-2 border p-4">
          <p className="text-ink text-base leading-relaxed font-medium">
            Please read this section carefully.
          </p>
          <ul className="text-ink-muted list-disc space-y-2 pl-5 text-base leading-relaxed">
            <li>
              <strong className="text-ink">
                AI-generated content may contain errors.
              </strong>{" "}
              Bill summaries and other AI-generated text are produced by
              automated systems and are provided for informational convenience
              only. They may be incomplete, inaccurate, or out of date. Always
              refer to the official bill text on{" "}
              <a
                href="https://congress.gov"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sapphire-deep underline underline-offset-2"
              >
                congress.gov
              </a>{" "}
              for authoritative information.
            </li>
            <li>
              <strong className="text-ink">
                Not legal, political, or professional advice.
              </strong>{" "}
              Nothing on Govroll constitutes legal advice, political
              recommendation, or professional guidance. Do not rely on Govroll
              as your sole source of information for any decision.
            </li>
            <li>
              <strong className="text-ink">
                Data may lag or differ from official sources.
              </strong>{" "}
              Legislative data is updated periodically from government APIs.
              There may be delays between when Congress takes action and when
              that action appears on Govroll. Vote tallies, bill statuses, and
              other data may temporarily differ from official records.
            </li>
            <li>
              <strong className="text-ink">Not a government website.</strong>{" "}
              Govroll is an independent project. It is not affiliated with,
              endorsed by, or operated by the U.S. government, Congress, or any
              government agency.
            </li>
          </ul>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">3. User accounts</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          You may browse Govroll without an account. Creating an account allows
          you to participate in discussions and make contributions. You are
          responsible for maintaining the security of your account credentials.
          You must provide accurate information when creating an account and
          must not impersonate others.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">4. User-generated content</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          When you post comments or other content on Govroll, you grant us a
          non-exclusive, royalty-free, worldwide license to display, distribute,
          and moderate that content in connection with the Service. You retain
          ownership of your content.
        </p>
        <p className="text-ink-muted text-base leading-relaxed">
          You agree not to post content that is:
        </p>
        <ul className="text-ink-muted list-disc space-y-1 pl-5 text-base leading-relaxed">
          <li>Threatening, harassing, or abusive toward others.</li>
          <li>Spam, advertising, or promotional material.</li>
          <li>Illegal or that encourages illegal activity.</li>
          <li>Impersonating another person or entity.</li>
          <li>Infringing on the intellectual property rights of others.</li>
        </ul>
        <p className="text-ink-muted text-base leading-relaxed">
          We reserve the right to remove content and suspend or terminate
          accounts that violate these guidelines, at our sole discretion.
          Content moderation is performed using a combination of automated AI
          systems and human review.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">5. Contributions</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          Financial contributions to Govroll are governed by our{" "}
          <Link
            href="/support/terms"
            className="text-sapphire-deep underline underline-offset-2"
          >
            Contribution Terms
          </Link>
          , which cover tax status, refunds, recurring billing, and display of
          contributor names.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">6. Intellectual property</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          U.S. government works — including bill text, vote records, and
          congressional data — are in the public domain and are not subject to
          copyright. Govroll&apos;s original content, design, code, and
          AI-generated summaries are protected by applicable intellectual
          property laws. You may not reproduce, distribute, or create derivative
          works from our original content without permission.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">7. Prohibited uses</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          You agree not to:
        </p>
        <ul className="text-ink-muted list-disc space-y-1 pl-5 text-base leading-relaxed">
          <li>Use the Service for any unlawful purpose.</li>
          <li>
            Attempt to gain unauthorized access to any part of the Service.
          </li>
          <li>Interfere with or disrupt the Service or its infrastructure.</li>
          <li>
            Scrape or harvest data from the Service in a way that burdens our
            systems.
          </li>
          <li>
            Use the Service to misrepresent legislative information or create
            misleading content.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">8. Limitation of liability</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          To the fullest extent permitted by law, Govroll and its operator are
          provided &ldquo;as is&rdquo; without warranties of any kind, whether
          express or implied. We do not warrant that the Service will be
          uninterrupted, error-free, or that information displayed will be
          accurate or complete.
        </p>
        <p className="text-ink-muted text-base leading-relaxed">
          In no event shall Govroll or its operator be liable for any indirect,
          incidental, special, consequential, or punitive damages arising from
          your use of or inability to use the Service, including but not limited
          to reliance on AI-generated summaries or legislative data displayed on
          the platform.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">9. Indemnification</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          You agree to indemnify and hold harmless Govroll and its operator from
          any claims, damages, losses, or expenses (including reasonable
          attorney&apos;s fees) arising from your use of the Service, your
          violation of these Terms, or your violation of any rights of another.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">10. Termination</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          We may suspend or terminate your access to the Service at any time,
          with or without cause, and with or without notice. You may delete your
          account at any time from your{" "}
          <Link
            href="/account"
            className="text-sapphire-deep underline underline-offset-2"
          >
            account settings
          </Link>
          .
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">11. Governing law</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          These Terms are governed by the laws of the State of New York, without
          regard to conflict of law principles. Any disputes arising under these
          Terms shall be resolved in the state or federal courts located in New
          York County, New York.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">12. Changes to these Terms</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          We may update these Terms from time to time. If we make material
          changes, we will update the date at the top of this page. Your
          continued use of Govroll after changes are posted constitutes
          acceptance of the updated Terms.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">13. Contact</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          Questions about these Terms? Contact us at{" "}
          <a
            href="mailto:support@govroll.com"
            className="text-sapphire-deep underline underline-offset-2"
          >
            support@govroll.com
          </a>
          .
        </p>
      </section>
    </div>
  );
}
