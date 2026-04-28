import { cn } from "@/lib/utils";
import type { StatusCode } from "@/lib/congress-session/types";

/**
 * The colored glyph inside the pill. Shape + color + animation together
 * carry the state — never relying on color alone (so deuteranopic users
 * and grayscale screenshots still read correctly).
 *
 * Colors are either semantic (emerald = active, amber = pro forma) or
 * `currentColor`-based (recess outline, unknown dash) so the neutral glyphs
 * adapt to their surrounding text color — readable on both the dark nav
 * pill and the light popover rows without a per-context override.
 *
 * - voting: filled emerald with motion-safe pulse
 * - in_session: filled emerald, static
 * - pre_session: filled amber, static (scheduled to convene later today)
 * - pro_forma: half-filled amber (distinct shape)
 * - adjourned_today: hollow emerald ring (was active today, not right now)
 * - recess: hollow ring in the ambient text color
 * - adjourned_sine_die: same hollow ring
 * - unknown: thin dash in the ambient text color (no dot at all)
 */
export function StatusDot({
  status,
  className,
}: {
  status: StatusCode;
  className?: string;
}) {
  if (status === "unknown") {
    return (
      <span
        aria-hidden
        className={cn(
          "inline-block h-0.5 w-2 rounded bg-current/40",
          className,
        )}
      />
    );
  }

  if (status === "recess" || status === "adjourned_sine_die") {
    return (
      <span
        aria-hidden
        className={cn(
          "relative inline-block size-2 rounded-full border border-current/60",
          className,
        )}
      />
    );
  }

  if (status === "adjourned_today") {
    return (
      <span
        aria-hidden
        className={cn(
          "relative inline-block size-2 rounded-full border border-emerald-400",
          className,
        )}
      />
    );
  }

  if (status === "pro_forma") {
    return (
      <span
        aria-hidden
        className={cn(
          "relative inline-block size-2 overflow-hidden rounded-full ring-1 ring-amber-300/80",
          className,
        )}
      >
        <span
          className="absolute inset-0 bg-amber-300"
          style={{ clipPath: "inset(0 50% 0 0)" }}
        />
      </span>
    );
  }

  if (status === "pre_session") {
    return (
      <span
        aria-hidden
        className={cn(
          "relative inline-block size-2 rounded-full bg-amber-300",
          className,
        )}
      />
    );
  }

  // voting | in_session
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex size-2 items-center justify-center",
        className,
      )}
    >
      {status === "voting" && (
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/70 motion-reduce:hidden" />
      )}
      <span className="relative inline-block size-2 rounded-full bg-emerald-400" />
    </span>
  );
}
