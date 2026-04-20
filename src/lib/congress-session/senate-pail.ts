import type { Signal } from "./types";

/**
 * Senate floor-activity ("PAIL") scraper.
 *
 * URL: https://www.senate.gov/legislative/floor_activity_pail.htm
 *
 * The page is a sparse HTML fragment with per-day sections of the form:
 *
 *   Monday, Apr 20, 2026
 *     - Convened at 3:00 p.m.
 *     - ...
 *     - Adjourned at 6:14 p.m.
 *
 * There's no machine-readable feed, but the structure is stable enough for
 * a regex scrape against ET calendar day. If the PAIL doesn't have a
 * section for today at all → Senate is not in session today → recess.
 *
 * Like the Clerk scraper, every failure mode returns null so the waterfall
 * falls through to vote recency + calendar.
 */

const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT = "Govroll/1.0 (+https://govroll.com; civic transparency)";
const URL_PAIL = "https://www.senate.gov/legislative/floor_activity_pail.htm";

export async function getSenatePailSignal(
  now: Date = new Date(),
): Promise<Signal | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let html: string;
  try {
    const res = await fetch(URL_PAIL, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (!html || html.length < 200) return null;

  const text = stripTags(html);
  const today = formatPailDateHeading(now);
  const section = extractDateSection(text, today);
  if (!section) {
    return {
      status: "recess",
      observedAt: null,
      detail: "Senate not listed on today's floor calendar",
      source: "senate_pail",
    };
  }

  const convened = matchTime(section, /convened\s+at\s+([0-9:apm.\s]+)/i, now);
  const adjourned = matchTime(
    section,
    /adjourned\s+at\s+([0-9:apm.\s]+)/i,
    now,
  );

  if (convened && !adjourned) {
    return {
      status: "in_session",
      observedAt: convened,
      detail: "Senate convened — floor in session",
      source: "senate_pail",
    };
  }

  if (convened && adjourned) {
    const durationMs = adjourned.getTime() - convened.getTime();
    if (durationMs >= 0 && durationMs < 30 * 60 * 1000) {
      return {
        status: "pro_forma",
        observedAt: adjourned,
        detail: "Pro forma session — gavelled in and out",
        source: "senate_pail",
      };
    }
    return {
      status: "in_session",
      observedAt: adjourned,
      detail: "Senate adjourned for the day",
      source: "senate_pail",
    };
  }

  // PAIL uses bare "Convene at 3:00 p.m." (future tense, no 'd') for days
  // the Senate is scheduled to meet but hasn't gaveled in yet. Without this
  // branch we fall through to null → unknown and the pill reads "Status
  // unavailable" every morning before convene.
  const scheduled = matchTime(
    section,
    /\bconvene\s+at\s+([0-9:apm.\s]+)/i,
    now,
  );
  if (scheduled && scheduled.getTime() > now.getTime()) {
    return {
      status: "recess",
      observedAt: null,
      detail: `Senate convenes at ${formatEtTime(scheduled)} ET`,
      source: "senate_pail",
    };
  }

  return null;
}

/** "Monday, Apr 20, 2026" — how the PAIL page labels each day section. */
function formatPailDateHeading(now: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(now);
}

function extractDateSection(text: string, heading: string): string | null {
  const idx = text.indexOf(heading);
  if (idx < 0) return null;
  // Take ~2000 chars after the heading — sections are short. Stop at the
  // next day heading if one appears, to avoid bleeding into adjacent days.
  const rest = text.slice(idx + heading.length, idx + heading.length + 4000);
  const nextHeading = rest.match(
    /(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),\s+[A-Z][a-z]+\s+\d+,\s+\d{4}/,
  );
  return nextHeading ? rest.slice(0, rest.indexOf(nextHeading[0])) : rest;
}

function matchTime(section: string, re: RegExp, now: Date): Date | null {
  const m = section.match(re);
  if (!m) return null;
  return parseEtTime(m[1], now);
}

/**
 * Parse "3:00 p.m." / "10:58 a.m." as a Date in US Eastern time for the
 * same calendar day as `reference`.
 */
function parseEtTime(raw: string, reference: Date): Date | null {
  const cleaned = raw.replace(/\s+/g, " ").trim().toLowerCase();
  const m = cleaned.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3].replace(/\./g, "");
  if (ampm === "pm" && hour !== 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  // Build an ET wall-clock time and convert to UTC. Cheapest portable way
  // without pulling in a tz lib: compute the ET offset for `reference`
  // and apply it.
  const etParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(reference);
  const y = etParts.find((p) => p.type === "year")?.value;
  const mo = etParts.find((p) => p.type === "month")?.value;
  const d = etParts.find((p) => p.type === "day")?.value;
  if (!y || !mo || !d) return null;

  // Two anchors for the same wall-clock moment: one interpreted as UTC,
  // one interpreted as ET. The delta is the ET offset on that date (handles
  // DST transitions correctly).
  const asUtc = new Date(`${y}-${mo}-${d}T${pad(hour)}:${pad(minute)}:00Z`);
  const etStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(asUtc);
  const [etHour, etMinute] = etStr.split(":").map((s) => parseInt(s, 10));
  const offsetMinutes = hour * 60 + minute - (etHour * 60 + etMinute);
  return new Date(asUtc.getTime() + offsetMinutes * 60_000);
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/** "3:00 p.m." — matches the style PAIL itself uses. */
function formatEtTime(d: Date): string {
  const raw = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return raw.replace(/\b([AP])M\b/, (_, c: string) => `${c.toLowerCase()}.m.`);
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
