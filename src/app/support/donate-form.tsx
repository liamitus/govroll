"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { checkNameL1 } from "@/lib/moderation/layer1";
import { useAuth } from "@/hooks/use-auth";

const PRESETS = [500, 1500, 5000]; // $5, $15, $50

type DisplayMode = "ANONYMOUS" | "NAMED" | "TRIBUTE";

export function DonateForm({
  typicalDonationCents,
  donorCount,
}: {
  typicalDonationCents: number | null;
  donorCount: number;
}) {
  const { user } = useAuth();
  const [amountCents, setAmountCents] = useState(1500);
  const [customAmount, setCustomAmount] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("ANONYMOUS");
  const [displayName, setDisplayName] = useState("");
  const [tributeName, setTributeName] = useState("");
  const [email, setEmail] = useState("");
  const [nameError, setNameError] = useState("");
  const [tributeError, setTributeError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const effectiveAmount = customAmount
    ? Math.round(parseFloat(customAmount) * 100)
    : amountCents;

  const validateName = (name: string, setter: (v: string) => void) => {
    if (!name.trim()) {
      setter("");
      return true;
    }
    const result = checkNameL1(name);
    setter(result.ok ? "" : (result.reason ?? "Invalid name"));
    return result.ok;
  };

  const handleSubmit = async () => {
    if (effectiveAmount < 100) {
      setError("Minimum contribution is $1.");
      return;
    }

    // Client-side name validation
    if (displayMode === "NAMED" && !validateName(displayName, setNameError))
      return;
    if (
      displayMode === "TRIBUTE" &&
      !validateName(tributeName, setTributeError)
    )
      return;

    if (displayMode === "NAMED" && !displayName.trim()) {
      setNameError("A display name is required.");
      return;
    }
    if (displayMode === "TRIBUTE" && !tributeName.trim()) {
      setTributeError("An honoree name is required.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountCents: effectiveAmount,
          isRecurring,
          displayMode,
          displayName: displayMode === "NAMED" ? displayName.trim() : undefined,
          tributeName:
            displayMode === "TRIBUTE" ? tributeName.trim() : undefined,
          email: email.trim() || user?.email || undefined,
          userId: user?.id,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        setSubmitting(false);
        return;
      }

      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  };

  // Impact copy — rough ratios, not promises. Tells the donor what their
  // money actually does so the ask feels tangible.
  const impactLine = (() => {
    const a = effectiveAmount;
    if (!a || a < 100) return null;
    if (a <= 500) return "Roughly a week of AI features for everyone.";
    if (a <= 1500) return "About 3 weeks of AI features for everyone.";
    if (a <= 5000) return "More than a full month of running costs.";
    return "Multiple months of running costs covered.";
  })();

  return (
    <Card className="space-y-6 p-6">
      {/* Amount presets */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Amount</Label>
        <div className="flex gap-2">
          {PRESETS.map((cents) => (
            <button
              key={cents}
              onClick={() => {
                setAmountCents(cents);
                setCustomAmount("");
              }}
              className={`flex-1 rounded-md border py-2.5 text-sm font-medium transition-colors ${
                amountCents === cents && !customAmount
                  ? "bg-navy border-navy text-white"
                  : "bg-card text-foreground border-border hover:border-navy/40"
              }`}
            >
              ${cents / 100}
            </button>
          ))}
          <div className="relative flex-1">
            <span className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2 text-sm">
              $
            </span>
            <Input
              type="number"
              min="1"
              step="1"
              placeholder="Other"
              value={customAmount}
              onChange={(e) => {
                setCustomAmount(e.target.value);
                setAmountCents(0);
              }}
              className="h-[42px] pl-7"
            />
          </div>
        </div>
        {impactLine && (
          <p className="text-muted-foreground pt-1 text-xs">{impactLine}</p>
        )}

        {typicalDonationCents && (
          <p className="text-muted-foreground text-xs">
            Typical contribution: ${(typicalDonationCents / 100).toFixed(0)}
            {donorCount > 0 &&
              ` from ${donorCount.toLocaleString("en-US")} supporters`}
          </p>
        )}
      </div>

      {/* Recurring toggle */}
      <label className="group flex cursor-pointer items-center gap-3">
        <div
          className={`relative h-5 w-10 rounded-full transition-colors ${
            isRecurring ? "bg-navy" : "bg-muted"
          }`}
          onClick={() => setIsRecurring(!isRecurring)}
        >
          <div
            className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
              isRecurring ? "translate-x-5" : ""
            }`}
          />
        </div>
        <div>
          <span className="text-sm font-medium">Support monthly</span>
          <span className="text-muted-foreground block text-xs">
            Predictable support keeps Govroll running. Cancel anytime.
          </span>
        </div>
      </label>

      {/* Display mode */}
      <fieldset className="space-y-2">
        <Label className="text-sm font-medium">How to list you</Label>
        <div className="space-y-1.5">
          {(
            [
              ["ANONYMOUS", "Keep me anonymous"],
              ["NAMED", "Show my name"],
              ["TRIBUTE", "In honor of someone"],
            ] as const
          ).map(([mode, label]) => (
            <label
              key={mode}
              className="flex cursor-pointer items-center gap-2"
            >
              <input
                type="radio"
                name="displayMode"
                value={mode}
                checked={displayMode === mode}
                onChange={() => setDisplayMode(mode)}
                className="accent-navy"
              />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Conditional name inputs */}
      {displayMode === "NAMED" && (
        <div className="space-y-1">
          <Label htmlFor="displayName" className="text-sm">
            Display name
          </Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              if (nameError) validateName(e.target.value, setNameError);
            }}
            onBlur={() => validateName(displayName, setNameError)}
            placeholder="Your name"
            maxLength={40}
          />
          {nameError && <p className="text-xs text-red-500">{nameError}</p>}
          <p className="text-muted-foreground text-xs">
            Personal names only. Displayed on the <em>Made possible by</em> page
            after review.
          </p>
        </div>
      )}

      {displayMode === "TRIBUTE" && (
        <div className="space-y-1">
          <Label htmlFor="tributeName" className="text-sm">
            In honor of
          </Label>
          <Input
            id="tributeName"
            value={tributeName}
            onChange={(e) => {
              setTributeName(e.target.value);
              if (tributeError) validateName(e.target.value, setTributeError);
            }}
            onBlur={() => validateName(tributeName, setTributeError)}
            placeholder="Their name"
            maxLength={40}
          />
          {tributeError && (
            <p className="text-xs text-red-500">{tributeError}</p>
          )}
          <p className="text-muted-foreground text-xs">
            Honor a teacher, family member, friend, or someone who inspired your
            civic engagement. Personal names only.
          </p>
        </div>
      )}

      {/* Email (for logged-out users) */}
      {!user && (
        <div className="space-y-1">
          <Label htmlFor="email" className="text-sm">
            Email <span className="text-muted-foreground">(for receipt)</span>
          </Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
          />
        </div>
      )}

      {/* Submit */}
      {error && <p className="text-sm text-red-500">{error}</p>}

      <Button
        onClick={handleSubmit}
        disabled={submitting || effectiveAmount < 100}
        className="bg-navy hover:bg-navy-light h-12 w-full text-base font-semibold tracking-wide text-white"
      >
        {submitting
          ? "Redirecting to Stripe..."
          : `Support Govroll — $${(effectiveAmount / 100).toFixed(effectiveAmount % 100 ? 2 : 0)}${isRecurring ? "/mo" : ""}`}
      </Button>
    </Card>
  );
}
