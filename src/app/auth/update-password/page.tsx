"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  PasswordStrengthIndicator,
  validatePassword,
} from "@/components/auth/password-strength";

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const validation = validatePassword(password);
    if (!validation.isValid) {
      setError("Password does not meet requirements");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError(
        "Browser storage is disabled. Disable private browsing or allow cookies for this site.",
      );
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
    } else {
      router.push("/account");
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card className="space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Set New Password</h1>
        <p className="text-muted-foreground text-base">
          Enter your new password below.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">New Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <PasswordStrengthIndicator password={password} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <p className="border-ink text-ink-muted border-[1.5px] border-dashed px-3 py-2 text-sm">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Updating..." : "Update Password"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
