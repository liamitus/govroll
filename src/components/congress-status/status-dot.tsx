import { cn } from "@/lib/utils";
import type { StatusCode } from "@/lib/congress-session/types";

/**
 * The glyph inside the pill. Shape + color + animation together carry the
 * state — never relying on color alone (so deuteranopic users and
 * grayscale screenshots still read correctly).
 *
 * Colors follow the Roll Call signal palette — in session is sapphire,
 * recess/pending is gold, "out" is hollow. Never green/red: legislative
 * timing is wayfinding, not an alert.
 *
 * - voting: filled sapphire with motion-safe pulse
 * - in_session: filled sapphire, static
 * - pre_session: filled gold, static (scheduled to convene later today)
 * - pro_forma: half-filled gold (distinct shape)
 * - adjourned_today: hollow sapphire ring (was active today, not right now)
 * - recess: hollow gold ring (the calendar says "away")
 * - no_session: hollow ring (scheduled day, but not on the floor today)
 * - adjourned_sine_die: same hollow ring
 * - unknown: thin dash in the ambient text color (no dot at all)
 */
export function StatusDot({
  status,
  className,
  stale = false,
}: {
  status: StatusCode;
  className?: string;
  /** When the data is stale, drop the "live" pulse so we don't imply an
   * ongoing vote on an hour-old reading. */
  stale?: boolean;
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

  if (status === "recess") {
    return (
      <span
        aria-hidden
        className={cn(
          "border-gold relative inline-block size-2 rounded-full border-[1.5px]",
          className,
        )}
      />
    );
  }

  if (status === "adjourned_sine_die" || status === "no_session") {
    return (
      <span
        aria-hidden
        className={cn(
          "border-hollow relative inline-block size-2 rounded-full border-[1.5px]",
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
          "border-sapphire relative inline-block size-2 rounded-full border-[1.5px]",
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
          "ring-gold/80 relative inline-block size-2 overflow-hidden rounded-full ring-1",
          className,
        )}
      >
        <span
          className="bg-gold absolute inset-0"
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
          "bg-gold relative inline-block size-2 rounded-full",
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
      {status === "voting" && !stale && (
        <span className="bg-sapphire/70 absolute inset-0 animate-ping rounded-full motion-reduce:hidden" />
      )}
      <span className="bg-sapphire relative inline-block size-2 rounded-full" />
    </span>
  );
}
