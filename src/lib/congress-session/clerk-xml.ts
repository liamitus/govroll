import { parseStringPromise } from "xml2js";
import type { Signal } from "./types";

/**
 * House Clerk floor-proceedings XML scraper.
 *
 * URL shape: https://clerk.house.gov/floor/YYYYMMDD.xml  (ET-local date)
 * Published every day the House is gaveled in; a 404 / empty body on a given
 * date is itself meaningful signal that the chamber didn't meet today.
 *
 * We never throw — every failure mode (404, 403, timeout, parse error,
 * unexpected shape) returns null so the waterfall can fall through to vote
 * recency and calendar.
 *
 * Shape (approximated from the Clerk's documented format):
 *   floor_summary
 *     legislative_day[] (usually one per file)
 *       floor_action[]
 *         @update-date-time  ISO-ish timestamp
 *         action_description (free text; includes "adjourned" etc.)
 *
 * Pro forma detection: the Clerk publishes an XML on pro-forma days too.
 * Those days have a very short action list whose text almost exclusively
 * mentions adjournment or procedural laying-before-the-House — no votes
 * or legislative debate. We use action count + keyword check.
 */

const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT = "Govroll/1.0 (+https://govroll.com; civic transparency)";

const RECENT_ACTION_THRESHOLD_MS = 30 * 60 * 1000; // 30 min

/** YYYYMMDD in US Eastern time. */
function easternYmd(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .replace(/-/g, "");
}

/** Hour-of-day (0-23) in US Eastern time. */
function etHour(now: Date): number {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hour12: false,
  }).format(now);
  return parseInt(h, 10);
}

export async function getHouseClerkSignal(
  now: Date = new Date(),
): Promise<Signal | null> {
  const ymd = easternYmd(now);
  const url = `https://clerk.house.gov/floor/${ymd}.xml`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let xml: string;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // clerk.house.gov serves Content-Type: text/xml and 406s requests that
      // ask for Accept: application/xml — keep this aligned with what the
      // server actually returns, or every cron call fails and we fall
      // through to "unknown" (the pill's "Status unavailable" state).
      headers: { "User-Agent": USER_AGENT, Accept: "text/xml" },
      // Revalidate per-invocation; cron runs every 10 min.
      cache: "no-store",
    });
    if (!res.ok) {
      // 404 = no proceedings published for today = almost certainly not in
      // session. Surface that as a positive signal rather than null so
      // the waterfall can short-circuit to calendar context.
      //
      // Before the House's typical noon ET gavel-in, the Clerk hasn't
      // written today's XML yet — a 404 then doesn't mean "recess", it
      // means "we haven't started". Soften the detail copy so citizens
      // don't read the morning pill as "Recess — no proceedings today".
      if (res.status === 404) {
        const detail =
          etHour(now) < 12
            ? "House has not yet gaveled in"
            : "No floor proceedings published today";
        return {
          status: "recess",
          observedAt: null,
          detail,
          source: "clerk_xml",
        };
      }
      return null;
    }
    xml = await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (!xml || xml.length < 40) return null;

  let parsed: unknown;
  try {
    parsed = await parseStringPromise(xml, {
      explicitArray: false,
      mergeAttrs: true,
    });
  } catch {
    return null;
  }

  const actions = extractActions(parsed);
  if (actions.length === 0) {
    return {
      status: "recess",
      observedAt: null,
      detail: "No floor actions published today",
      source: "clerk_xml",
    };
  }

  const sorted = [...actions].sort(
    (a, b) => a.time.getTime() - b.time.getTime(),
  );
  const latest = sorted[sorted.length - 1];

  if (isProForma(actions)) {
    return {
      status: "pro_forma",
      observedAt: latest.time,
      detail: "Pro forma session — no legislative business",
      source: "clerk_xml",
    };
  }

  const ageMs = now.getTime() - latest.time.getTime();
  if (ageMs >= 0 && ageMs < RECENT_ACTION_THRESHOLD_MS) {
    return {
      status: "in_session",
      observedAt: latest.time,
      detail: summarizeAction(latest.text),
      source: "clerk_xml",
    };
  }

  // There were actions today but the last one is old — the chamber
  // adjourned for the day. Report as in_session-today so the waterfall
  // can still distinguish this from "no activity at all" via the timestamp.
  return {
    status: "in_session",
    observedAt: latest.time,
    detail: summarizeAction(latest.text),
    source: "clerk_xml",
  };
}

interface ClerkAction {
  time: Date;
  text: string;
}

/**
 * Tolerant extraction — the Clerk has changed the XML shape over the years,
 * so we look for anything that walks like a floor_action rather than binding
 * to a rigid path.
 */
function extractActions(doc: unknown): ClerkAction[] {
  const out: ClerkAction[] = [];
  walk(doc, (node) => {
    if (!isObject(node)) return;
    const time = parseClerkTime(node);
    if (!time) return;
    const text = extractActionText(node);
    out.push({ time, text });
  });
  return out;
}

function parseClerkTime(node: Record<string, unknown>): Date | null {
  // Several attribute shapes we've seen: update-date-time, act-time,
  // formatted-time.
  const candidates = [
    node["update-date-time"],
    node["update_date_time"],
    node["updateDateTime"],
    node["act-time"],
  ];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const d = new Date(c);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function extractActionText(node: Record<string, unknown>): string {
  const desc = node["action_description"] ?? node["actionDescription"];
  if (typeof desc === "string") return desc.trim();
  if (isObject(desc)) {
    const inner = desc["_"] ?? desc["$text"];
    if (typeof inner === "string") return inner.trim();
    return JSON.stringify(desc).slice(0, 240);
  }
  return "";
}

function isProForma(actions: ClerkAction[]): boolean {
  if (actions.length === 0 || actions.length > 4) return false;
  const text = actions
    .map((a) => a.text.toLowerCase())
    .join(" | ")
    .trim();
  if (!text) return false;
  const mentionsAdjourn = /adjourn/.test(text);
  const mentionsBusiness = /vote|passed|debate|amendment|motion/.test(text);
  // Pro forma days are almost entirely adjournment/procedural with no
  // substantive business.
  return mentionsAdjourn && !mentionsBusiness;
}

function summarizeAction(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 80) return clean;
  return clean.slice(0, 77) + "…";
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function walk(
  node: unknown,
  visit: (n: Record<string, unknown>) => void,
): void {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit);
    return;
  }
  if (!isObject(node)) return;
  visit(node);
  for (const v of Object.values(node)) walk(v, visit);
}
