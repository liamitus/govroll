import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Govroll",
  description:
    "How Govroll collects, uses, and protects your personal information.",
};

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
      <header className="border-rule space-y-3 border-b pb-10">
        <p className="text-ink-muted text-[11px] font-bold tracking-[0.18em] uppercase">
          Legal
        </p>
        <h1 className="text-ink text-4xl font-bold tracking-tight sm:text-5xl">
          Privacy Policy
        </h1>
        <p className="text-ink-muted text-base">Last updated: April 15, 2026</p>
      </header>

      <div className="text-ink-muted space-y-14 pt-10 text-base leading-7">
        <p>
          Govroll (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;)
          operates the website at{" "}
          <a
            href="https://govroll.com"
            className="text-ink decoration-rule hover:decoration-ink underline underline-offset-2"
          >
            govroll.com
          </a>
          . This policy explains what information we collect, how we use it, who
          we share it with, and the rights you have. We take a privacy-first
          approach: we collect the minimum we need to run the service, we do not
          sell data, and we do not run advertising or tracking.
        </p>

        <Section number="1" title="Information we collect">
          <Sub title="Information you provide directly">
            <ul className="marker:text-hollow list-disc space-y-2 pl-5">
              <Item label="Account information">
                email address and password when you create an account, or basic
                profile information (name, email, avatar) from Google or GitHub
                if you use social sign-in.
              </Item>
              <Item label="Display name">
                an optional username you choose for comments and discussions.
              </Item>
              <Item label="Comments">
                text and reactions you post in bill discussions.
              </Item>
              <Item label="AI chat questions">
                when you use the Ask-an-AI feature on a bill, the question you
                type and the conversation thread are saved to your account so
                you can return to it. The question text is also sent to our AI
                provider to generate the response (see section 4).
              </Item>
              <Item label="Donor name (optional)">
                if you make a contribution, you may choose to be listed publicly
                on our supporters page. Donations default to anonymous.
              </Item>
              <Item label="Payment information">
                payment details are collected and processed by Stripe. We do not
                receive or store full card numbers, CVVs, or bank credentials.
              </Item>
              <Item label="Correspondence">
                emails you send to{" "}
                <a
                  href="mailto:support@govroll.com"
                  className="text-ink decoration-rule hover:decoration-ink underline underline-offset-2"
                >
                  support@govroll.com
                </a>{" "}
                or related addresses.
              </Item>
            </ul>
          </Sub>

          <Sub title="Information stored on your device only">
            <ul className="marker:text-hollow list-disc space-y-2 pl-5">
              <Item label="Your address">
                when you enter your address to find your representatives, it is
                stored in your browser&apos;s local storage. It is not saved to
                any Govroll account or database. You can clear it at any time by
                changing your address or clearing your browser storage.
              </Item>
            </ul>
            <p className="pt-2">
              Looking up your representatives is a stateless server-side proxy.
              We would prefer to geocode directly in your browser, but the{" "}
              <a
                href="https://geocoding.geo.census.gov/"
                className="text-ink decoration-rule hover:decoration-ink underline underline-offset-2"
                target="_blank"
                rel="noopener noreferrer"
              >
                U.S. Census Bureau geocoder
              </a>{" "}
              — the public dataset that maps an address to a congressional
              district — does not accept direct browser calls. So we relay the
              request: your address is POSTed to our server, forwarded to the
              Census geocoder to resolve a state and district, and discarded
              when the request ends. It is held only in the memory of a single
              request and is not written to our database, application logs,
              analytics, or error alerts. Your browser keeps the one canonical
              copy. If a public geocoder ever supports direct browser calls, we
              will move this step fully client-side.
            </p>
          </Sub>

          <Sub title="Information collected automatically">
            <ul className="marker:text-hollow list-disc space-y-2 pl-5">
              <Item label="Authentication cookies">
                if you sign in, we set essential cookies to keep your session
                active. These are strictly necessary and cannot be disabled
                without signing out.
              </Item>
              <Item label="Server logs">
                our hosting provider (Vercel) records standard request metadata
                — IP address, user agent, URL, timestamp, response code — for
                security, abuse prevention, and operational purposes. These logs
                are retained for up to 30 days.
              </Item>
            </ul>
            <p className="pt-2">
              We do not use analytics trackers, advertising cookies, session
              replay tools, or third-party tracking pixels. Fonts are
              self-hosted, so no font-provider tracking occurs.
            </p>
          </Sub>
        </Section>

        <Section number="2" title="How we use your information">
          <ul className="marker:text-hollow list-disc space-y-2 pl-5">
            <li>
              To provide and maintain the service — account access, bill
              tracking, comments, and supporter attribution.
            </li>
            <li>To process contributions and send receipts through Stripe.</li>
            <li>To moderate public donor display names (see section 4).</li>
            <li>To respond to support requests and correspondence.</li>
            <li>
              To protect against fraud, abuse, rate-limit violations, and
              unauthorized access.
            </li>
            <li>
              To comply with legal obligations, subpoenas, or lawful process.
            </li>
          </ul>
          <p>
            We do not sell, rent, or share your personal information for
            advertising, marketing, or cross-context behavioral advertising
            purposes.
          </p>
        </Section>

        <Section number="3" title="Service providers">
          <p>
            We use the following third-party providers to operate Govroll. Each
            has its own privacy policy governing how it handles data.
          </p>
          <ul className="marker:text-hollow list-disc space-y-2 pl-5">
            <Item label="Vercel">
              website hosting, function execution, CDN, and request logging.
            </Item>
            <Item label="Supabase">
              managed Postgres database and authentication (including the Google
              and GitHub OAuth flows).
            </Item>
            <Item label="Stripe">
              payment processing for contributions. Governed by Stripe&apos;s
              privacy policy.
            </Item>
            <Item label="U.S. Census Bureau geocoding API">
              converts an address you provide into a state and congressional
              district. Governed by the Census Bureau&apos;s privacy notice.
            </Item>
            <Item label="Anthropic">
              primary AI provider. Generates plain-language bill summaries from
              publicly available bill text, and answers questions asked through
              the Ask-an-AI feature. For chat, the bill content, the question
              you typed, and the recent turns in that conversation are sent;
              your email, account ID, address, and other profile data are not.
            </Item>
            <Item label="OpenAI">
              used for two purposes: (1) screening user-submitted text — donor
              display names, usernames, and comments — via the free /moderations
              endpoint; and (2) as a secondary chat provider when Anthropic is
              unavailable. Only the specific text being moderated or the chat
              inputs described above are sent; no account identifier is
              attached.
            </Item>
            <Item label="Resend">
              sends transactional email — receipts, contact replies, and
              redacted operational error alerts to site staff. Error alerts do
              not include addresses, comment text, or account credentials.
            </Item>
          </ul>
          <p>
            We select providers with strong privacy practices and review this
            list periodically. If we add or remove a material provider, this
            page will be updated.
          </p>
        </Section>

        <Section number="4" title="Artificial intelligence">
          <p>We use AI for three narrow, server-side purposes:</p>
          <ul className="marker:text-hollow list-disc space-y-2 pl-5">
            <li>
              <strong className="text-ink font-semibold">
                Bill summaries:
              </strong>{" "}
              generating plain-language summaries of public bill text retrieved
              from congress.gov. No personal information is sent, and summaries
              are cached so the same bill is not reprocessed.
            </li>
            <li>
              <strong className="text-ink font-semibold">
                Ask-an-AI (bill chat):
              </strong>{" "}
              an authenticated feature that lets you ask questions about a
              specific bill. When you send a message, we transmit the bill text,
              your question, and up to the most recent ten turns of that
              conversation to the AI provider. We do not send your email, your
              account ID, your address, or any data from other bills. The
              conversation is saved to your account so you can return to it, and
              is permanently deleted when you delete your account. To cut cost
              and latency, we cache responses to first-turn questions keyed by a
              hash of the question and the bill; a matching cached response may
              be served to another user who asks the same question on the same
              bill. The cache entry contains the question text (not who asked
              it) and expires after 24 hours.
            </li>
            <li>
              <strong className="text-ink font-semibold">
                Content safety:
              </strong>{" "}
              screening user-submitted text — donor display names, usernames,
              and comments — for slurs, harassment, sexual content, violence,
              and other policy violations before publishing. Submissions that
              are flagged are rejected with a generic message and are not
              stored. A deterministic pre-filter (no AI) runs first to catch
              obvious issues instantly.
            </li>
          </ul>
          <p>
            AI-generated bill summaries are for informational purposes only and
            may contain inaccuracies — always consult the original bill text for
            authoritative content. We do not allow our providers to use your
            information to train their models, and we send only the specific
            piece of text needed for each task — nothing from your profile or
            from unrelated activity on the site.
          </p>
          <p>
            If the moderation service is temporarily unavailable, the
            deterministic deny-list still applies and the content may be posted
            pending review. Comments determined to violate our guidelines after
            the fact will be removed.
          </p>
        </Section>

        <Section number="5" title="Data retention and deletion">
          <p>
            Account data is retained while your account is active. You can
            delete your account at any time from your{" "}
            <Link
              href="/account"
              className="text-ink decoration-rule hover:decoration-ink underline underline-offset-2"
            >
              account settings
            </Link>
            . Deletion permanently removes your profile, display name, comment
            authorship, and your AI chat conversations. Comments may be retained
            in anonymized form (author attribution removed) so that surrounding
            discussion remains coherent; you can request full content removal by
            contacting us.
          </p>
          <p>
            Financial records related to contributions — including donor
            identity on attributed donations — are retained for the period
            required by U.S. tax and record-keeping law, typically seven years.
            Server logs are retained for up to 30 days. Cached AI chat responses
            expire after 24 hours. Your locally-stored address is cleared from
            your device whenever you clear it or your browser storage.
          </p>
        </Section>

        <Section number="6" title="Children's privacy">
          <p>
            Govroll is not directed to children under 13 and we do not knowingly
            collect personal information from children under 13. If you believe
            a child has provided us with personal information, please{" "}
            <Link
              href="/contact"
              className="text-ink decoration-rule hover:decoration-ink underline underline-offset-2"
            >
              contact us
            </Link>{" "}
            and we will promptly delete it.
          </p>
        </Section>

        <Section number="7" title="Your rights">
          <p>Depending on where you live, you may have the right to:</p>
          <ul className="marker:text-hollow list-disc space-y-2 pl-5">
            <li>Access the personal information we hold about you.</li>
            <li>Request correction of inaccurate information.</li>
            <li>Request deletion of your personal information.</li>
            <li>Object to or restrict processing of your information.</li>
            <li>
              Request portability of your data in a machine-readable format.
            </li>
            <li>
              Withdraw consent previously granted, where we rely on consent.
            </li>
          </ul>
          <p>
            To exercise any of these rights, email{" "}
            <a
              href="mailto:privacy@govroll.com"
              className="text-ink decoration-rule hover:decoration-ink underline underline-offset-2"
            >
              privacy@govroll.com
            </a>
            . We will respond within 30 days. We will not retaliate against you
            for exercising any of these rights.
          </p>

          <Sub title="California residents (CCPA / CPRA)">
            <p>
              If you are a California resident, you have additional rights under
              the California Consumer Privacy Act, as amended by the California
              Privacy Rights Act:
            </p>
            <ul className="marker:text-hollow mt-3 list-disc space-y-2 pl-5">
              <li>
                The right to know what categories and specific pieces of
                personal information we collect, use, and disclose.
              </li>
              <li>
                The right to delete personal information we have collected from
                you.
              </li>
              <li>The right to correct inaccurate personal information.</li>
              <li>
                The right to opt out of the sale or sharing of your personal
                information.{" "}
                <strong className="text-ink">
                  We do not sell or share personal information
                </strong>{" "}
                as those terms are defined under California law.
              </li>
              <li>
                The right to limit use of sensitive personal information. We do
                not collect sensitive personal information beyond what is
                strictly necessary to run your account.
              </li>
              <li>
                The right to non-discrimination for exercising these rights.
              </li>
            </ul>
            <p className="mt-3">
              The categories of personal information we collect are: identifiers
              (email, account ID), commercial information (donation history),
              internet activity (request logs), and user-generated content
              (comments, display name). We honor the Global Privacy Control
              (GPC) signal as a valid opt-out preference signal.
            </p>
          </Sub>
        </Section>

        <Section number="8" title="Security">
          <p>
            We use industry-standard safeguards to protect your data: encrypted
            connections (HTTPS/TLS) everywhere, managed authentication via
            Supabase, PCI-compliant payment processing via Stripe, access
            controls on administrative tooling, and least-privilege service
            credentials. No system is perfectly secure and we cannot guarantee
            absolute security. If we become aware of a breach affecting your
            personal information, we will notify you as required by applicable
            law.
          </p>
        </Section>

        <Section number="9" title="Legal disclosures">
          <p>
            We may disclose information when we believe, in good faith, that
            disclosure is required to (a) comply with applicable law, a
            subpoena, court order, or other lawful process; (b) protect the
            rights, property, or safety of Govroll, our users, or the public; or
            (c) investigate, prevent, or respond to suspected fraud, security
            incidents, or abuse. Where legally permitted, we will attempt to
            notify affected users before responding to a government request.
          </p>
        </Section>

        <Section number="10" title="Changes to this policy">
          <p>
            We may update this Privacy Policy from time to time. If we make
            material changes, we will update the date at the top of this page
            and, when practical, provide a more prominent notice (such as an
            in-product notification or an email to account holders). Your
            continued use of Govroll after changes are posted constitutes
            acceptance of the updated policy.
          </p>
        </Section>

        <Section number="11" title="Contact">
          <p>
            Questions about this Privacy Policy or our data practices? Email{" "}
            <a
              href="mailto:privacy@govroll.com"
              className="text-ink decoration-rule hover:decoration-ink underline underline-offset-2"
            >
              privacy@govroll.com
            </a>
            , or reach us through the{" "}
            <Link
              href="/contact"
              className="text-ink decoration-rule hover:decoration-ink underline underline-offset-2"
            >
              contact page
            </Link>
            .
          </p>
        </Section>
      </div>
    </article>
  );
}

function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="scroll-mt-24 space-y-4">
      <h2 className="text-ink flex items-baseline gap-3 text-2xl font-semibold tracking-tight">
        <span className="text-ink-muted text-xs font-semibold tracking-[0.2em] tabular-nums">
          {number.padStart(2, "0")}
        </span>
        <span>{title}</span>
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Sub({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 pt-2">
      <h3 className="text-ink-muted font-sans text-sm font-semibold tracking-[0.15em] uppercase">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Item({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <strong className="text-ink font-semibold">{label}:</strong> {children}
    </li>
  );
}
