import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About — Govroll",
  description:
    "Govroll is an independent civic transparency platform making legislation accessible to everyday people.",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-10">
      <header className="space-y-3">
        <p className="text-ink-muted flex items-center gap-2 text-[11px] font-bold tracking-[0.18em] uppercase">
          <span className="brand-node" aria-hidden="true" />
          About
        </p>
        <h1 className="text-4xl font-bold tracking-tight">
          Making legislation accessible to everyday people.
        </h1>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Our mission</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          Govroll is an independent civic transparency platform. We believe
          everyone should be able to see what Congress is doing — what bills are
          moving, how their representatives vote, and what proposed legislation
          actually means — without needing a law degree or hours of free time.
        </p>
        <p className="text-ink-muted text-base leading-relaxed">
          We use AI to summarize complex legislation in plain language and
          surface the information that matters most: the bills your
          representatives are voting on, the ones gaining momentum, and the ones
          that affect your daily life.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">How it works</h2>
        <ul className="text-ink-muted list-disc space-y-2 pl-5 text-base leading-relaxed">
          <li>
            <strong className="text-ink">Legislative data</strong> is sourced
            from{" "}
            <a
              href="https://congress.gov"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sapphire-deep underline underline-offset-2"
            >
              congress.gov
            </a>{" "}
            and the Congressional API. Bill text, vote records, and
            representative information come directly from official government
            sources.
          </li>
          <li>
            <strong className="text-ink">AI summaries</strong> are generated to
            help you understand what bills do in plain language. These summaries
            are informational and may contain errors — always refer to the
            official bill text for authoritative information.
          </li>
          <li>
            <strong className="text-ink">Representative lookup</strong> uses
            your address to identify your elected officials. Your address stays
            on your device and is never sent to our servers.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Nonpartisan commitment</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          Govroll does not endorse candidates, political parties, or positions
          on legislation. We present legislative data and voting records as they
          are. Our goal is to inform, not to persuade.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">How it&apos;s funded</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          Govroll is supported entirely by{" "}
          <Link
            href="/support"
            className="text-sapphire-deep underline underline-offset-2"
          >
            reader contributions
          </Link>
          . No ads, no corporate sponsors, no paywalls. Infrastructure, data,
          and AI costs are covered by the people who use and believe in the
          platform.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Who built this</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          Govroll is built and maintained by{" "}
          <a
            href="https://howellandgibbs.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sapphire-deep underline underline-offset-2"
          >
            Howell &amp; Gibbs
          </a>
          , a studio that believes civic tools should be free, open, and
          accessible to everyone.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Open source</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          Govroll is open source on{" "}
          <a
            href="https://github.com/howellandgibbs/govroll"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sapphire-deep underline underline-offset-2"
          >
            GitHub
          </a>
          . Bugs, feature requests, and roadmap work happen in the open — you
          can browse or file anything on the public{" "}
          <a
            href="https://github.com/howellandgibbs/govroll/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sapphire-deep underline underline-offset-2"
          >
            issue tracker
          </a>
          . This instance is focused on the U.S. Congress, but the code
          isn&apos;t tied to any one country. If you&apos;d like to bring the
          same kind of civic transparency to your own parliament, legislature,
          or government, clone the repo and tailor it to your data sources and
          institutions. Pull requests, forks, and country-specific deployments
          are all welcome.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Get in touch</h2>
        <p className="text-ink-muted text-base leading-relaxed">
          Have feedback, found a bug, or have a question?{" "}
          <Link
            href="/contact"
            className="text-sapphire-deep underline underline-offset-2"
          >
            Reach out
          </Link>
          . We&apos;d love to hear from you.
        </p>
      </section>
    </div>
  );
}
