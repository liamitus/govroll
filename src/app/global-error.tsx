"use client";

import { useEffect } from "react";

// global-error replaces the root layout, so globals.css (and the Roll Call
// token utilities) may not be loaded. Everything is inline-styled with the
// raw palette values: sand ground, ink type, sapphire-deep action.
const SAND = "#F2EDE3";
const PAPER = "#FBF8F2";
const INK = "#14161C";
const INK_MUTED = "#5C5F69";
const SAPPHIRE_DEEP = "#3258FF";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Report to error alerting endpoint (fire-and-forget)
    fetch("/api/errors/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        digest: error.digest,
        stack: error.stack,
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
          backgroundColor: SAND,
          color: INK,
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div
          style={{
            maxWidth: "28rem",
            padding: "3rem 2rem",
            textAlign: "center",
            backgroundColor: PAPER,
            // Errors get the dashed ink frame — never red.
            border: `1.5px dashed ${INK}`,
          }}
        >
          <p
            style={{
              margin: "0 0 1.5rem",
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: INK_MUTED,
            }}
          >
            Something went wrong
          </p>
          <h1
            style={{
              margin: "0 0 1.5rem",
              fontSize: "2.25rem",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: INK,
            }}
          >
            Unexpected error
          </h1>
          <p
            style={{
              margin: "0 0 1.5rem",
              fontSize: "1rem",
              lineHeight: 1.6,
              color: INK_MUTED,
            }}
          >
            We hit an unexpected problem. Please try again, or head back to the
            homepage.
          </p>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "1rem",
              paddingTop: "0.5rem",
            }}
          >
            <button
              onClick={reset}
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "0.5rem 1rem",
                fontSize: "1rem",
                fontWeight: 600,
                color: PAPER,
                backgroundColor: SAPPHIRE_DEEP,
                border: "none",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            {/* global-error.tsx is the last-resort boundary — React state is
                broken, so next/link can't be relied on. Use a plain anchor. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "0.5rem 1rem",
                fontSize: "1rem",
                fontWeight: 500,
                color: INK,
                textDecoration: "none",
                border: "1px solid #D3CCBE",
              }}
            >
              Go home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
