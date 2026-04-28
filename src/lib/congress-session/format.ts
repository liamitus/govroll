/** "3:00 p.m." in US Eastern time — matches the style the Senate PAIL uses,
 *  so detail strings ("Senate convenes at 3:00 p.m. ET") and transition
 *  labels ("Convenes at 3:00 p.m. ET") render identically across modules. */
export function formatEtTime(d: Date): string {
  const raw = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return raw.replace(/\b([AP])M\b/, (_, c: string) => `${c.toLowerCase()}.m.`);
}
