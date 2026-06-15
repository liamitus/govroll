import { readFileSync, readdirSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Guards the timing contract between the GitHub Actions ingest workflow (the
 * caller) and the cron route handlers (the callee).
 *
 * This is a regression test for a real outage class: PR #138 raised
 * fetch-bills' `maxDuration` to 300s so backlog catch-up could finish a window,
 * but the workflow still severed the connection at `curl --max-time 65`. Every
 * long run then failed with a false `curl (28)` timeout even though the
 * function was working correctly server-side — the two values had drifted
 * apart because they live in different files. These assertions fail loudly the
 * next time they drift, instead of letting it surface as flaky red cron runs.
 *
 * The invariant, from the outside in:
 *
 *   job timeout-minutes * 60  >=  curl --max-time  >=  any route maxDuration
 *
 * plus a ceiling: no route may declare more than Vercel's 300s platform cap.
 */

const REPO_ROOT = process.cwd();
const WORKFLOW = path.join(REPO_ROOT, ".github/workflows/ingest.yml");
const CRON_DIR = path.join(REPO_ROOT, "src/app/api/cron");

// Vercel Hobby + Fluid Compute caps a single function at 300s.
const VERCEL_MAX_DURATION_CAP = 300;

function readWorkflow(): string {
  return readFileSync(WORKFLOW, "utf8");
}

/** The curl `--max-time N` (seconds) used to invoke every ingest endpoint. */
function curlMaxTime(workflow: string): number {
  const m = workflow.match(/--max-time\s+(\d+)/);
  expect(m, "workflow must set an explicit curl --max-time").not.toBeNull();
  return Number(m![1]);
}

/**
 * The longest `timeout-minutes` declared in the workflow, in seconds. The curl
 * runs inside the `ping` job, which carries the larger of the two job timeouts
 * (the `resolve` job is a 1-minute no-op), so the max is the budget the curl
 * actually runs under.
 */
function maxJobTimeoutSeconds(workflow: string): number {
  const all = [...workflow.matchAll(/timeout-minutes:\s*(\d+)/g)].map((m) =>
    Number(m[1]),
  );
  expect(all.length, "workflow must declare timeout-minutes").toBeGreaterThan(
    0,
  );
  return Math.max(...all) * 60;
}

/** Every cron route that declares `export const maxDuration = N`. */
function routeMaxDurations(): Array<{ route: string; maxDuration: number }> {
  return readdirSync(CRON_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const file = path.join(CRON_DIR, d.name, "route.ts");
      let src: string;
      try {
        src = readFileSync(file, "utf8");
      } catch {
        return null; // no route.ts in this dir
      }
      const m = src.match(/export const maxDuration\s*=\s*(\d+)/);
      return m ? { route: d.name, maxDuration: Number(m[1]) } : null;
    })
    .filter((x): x is { route: string; maxDuration: number } => x !== null);
}

describe("ingest cron timing contract", () => {
  it("curl --max-time covers every route's declared maxDuration", () => {
    const maxTime = curlMaxTime(readWorkflow());
    const routes = routeMaxDurations();
    // Sanity: we actually found the long-running routes, so the test has teeth.
    expect(routes.length).toBeGreaterThan(0);

    for (const { route, maxDuration } of routes) {
      expect(
        maxDuration,
        `${route} declares maxDuration=${maxDuration}s but the workflow curl ` +
          `--max-time is only ${maxTime}s — long runs will fail with curl (28) ` +
          `even though the function succeeds. Raise --max-time in ingest.yml.`,
      ).toBeLessThanOrEqual(maxTime);
    }
  });

  it("the job timeout outlasts the curl --max-time", () => {
    const workflow = readWorkflow();
    const maxTime = curlMaxTime(workflow);
    const jobTimeout = maxJobTimeoutSeconds(workflow);
    expect(
      jobTimeout,
      `job timeout (${jobTimeout}s) must exceed curl --max-time (${maxTime}s), ` +
        `otherwise the job is killed just before a full-budget run responds.`,
    ).toBeGreaterThan(maxTime);
  });

  it("no route exceeds Vercel's 300s platform cap", () => {
    for (const { route, maxDuration } of routeMaxDurations()) {
      expect(
        maxDuration,
        `${route} declares maxDuration=${maxDuration}s, above Vercel's ` +
          `${VERCEL_MAX_DURATION_CAP}s cap — it will be force-killed with a 504.`,
      ).toBeLessThanOrEqual(VERCEL_MAX_DURATION_CAP);
    }
  });
});
