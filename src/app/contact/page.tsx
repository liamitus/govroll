import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact — Govroll",
  description:
    "Report a bug, send feedback, or get in touch with the Govroll team.",
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-10">
      <header className="space-y-3">
        <p className="text-civic-gold star-accent text-sm tracking-widest uppercase">
          Contact
        </p>
        <h1 className="text-4xl font-bold tracking-tight">Get in touch</h1>
        <p className="text-muted-foreground text-base">
          Found a bug, have feedback, or just want to say hello? We&apos;d love
          to hear from you.
        </p>
      </header>

      <div className="grid gap-6">
        <section className="space-y-2 rounded-lg border p-5">
          <h2 className="text-xl font-semibold">Report a bug or inaccuracy</h2>
          <p className="text-muted-foreground text-base leading-relaxed">
            If something isn&apos;t working right or you&apos;ve spotted an
            inaccurate AI summary, bill status, or voting record, let us know.
            Include as much detail as you can — the bill, what looked wrong, and
            what you expected.
          </p>
          <p className="text-base">
            <a
              href="mailto:support@govroll.com?subject=Bug Report"
              className="text-primary underline underline-offset-2"
            >
              support@govroll.com
            </a>
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Prefer public tracking? File an issue on{" "}
            <a
              href="https://github.com/howellandgibbs/govroll/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground underline underline-offset-2"
            >
              GitHub
            </a>
            .
          </p>
        </section>

        <section className="space-y-2 rounded-lg border p-5">
          <h2 className="text-xl font-semibold">General feedback</h2>
          <p className="text-muted-foreground text-base leading-relaxed">
            Feature ideas, usability feedback, or thoughts on how Govroll can
            better serve you — all welcome.
          </p>
          <p className="text-base">
            <a
              href="mailto:feedback@govroll.com?subject=Feedback"
              className="text-primary underline underline-offset-2"
            >
              feedback@govroll.com
            </a>
          </p>
        </section>

        <section className="space-y-2 rounded-lg border p-5">
          <h2 className="text-xl font-semibold">Account &amp; billing</h2>
          <p className="text-muted-foreground text-base leading-relaxed">
            Questions about your account, contributions, refunds, or recurring
            billing? We typically respond within one business day.
          </p>
          <p className="text-base">
            <a
              href="mailto:support@govroll.com?subject=Account Question"
              className="text-primary underline underline-offset-2"
            >
              support@govroll.com
            </a>
          </p>
        </section>

        <section className="space-y-2 rounded-lg border p-5">
          <h2 className="text-xl font-semibold">Privacy &amp; data requests</h2>
          <p className="text-muted-foreground text-base leading-relaxed">
            To exercise your data rights — access, correction, or deletion — or
            to ask a question about our{" "}
            <Link
              href="/privacy"
              className="text-primary underline underline-offset-2"
            >
              privacy practices
            </Link>
            :
          </p>
          <p className="text-base">
            <a
              href="mailto:privacy@govroll.com?subject=Privacy Request"
              className="text-primary underline underline-offset-2"
            >
              privacy@govroll.com
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
