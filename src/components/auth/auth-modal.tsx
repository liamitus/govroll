"use client";

import { useState, useRef, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  PasswordStrengthIndicator,
  validatePassword,
} from "./password-strength";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import Link from "next/link";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            nonce?: string;
            use_fedcm_for_prompt?: boolean;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: "standard" | "icon";
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              text?: "signin_with" | "signup_with" | "continue_with" | "signin";
              shape?: "rectangular" | "pill" | "circle" | "square";
              logo_alignment?: "left" | "center";
              width?: number;
            },
          ) => void;
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

async function generateNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = btoa(String.fromCharCode(...bytes));
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  const hashed = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { raw, hashed };
}

function loadGisScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(
    `script[src="${GIS_SCRIPT_SRC}"]`,
  );
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Google Identity Services failed to load")),
        { once: true },
      );
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Google Identity Services failed to load"));
    document.head.appendChild(script);
  });
}

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type AuthMode = "login" | "register" | "forgot" | "check-email";

export function AuthModal({ open, onOpenChange }: AuthModalProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { signIn, signUp } = useAuth();
  const hiddenGoogleButtonRef = useRef<HTMLDivElement | null>(null);

  // Forwards a click from our visual Button to Google's hidden, off-screen
  // rendered button. Has to be programmatic-click-on-real-element (not a
  // synthesized event), or GIS's internal click handler ignores it.
  const handleGoogleClick = useCallback(() => {
    const realButton =
      hiddenGoogleButtonRef.current?.querySelector<HTMLElement>(
        'div[role="button"]',
      );
    if (realButton) {
      realButton.click();
    } else {
      setError("Google sign-in is still loading. Try again in a second.");
    }
  }, []);

  const resetForm = () => {
    setEmail("");
    setPassword("");
    setError("");
  };

  const switchMode = (newMode: AuthMode) => {
    resetForm();
    setMode(newMode);
  };

  const handleGoogleCredential = useCallback(
    async (credential: string, rawNonce: string) => {
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: credential,
        nonce: rawNonce,
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      onOpenChange(false);
      resetForm();
    },
    [onOpenChange],
  );

  // Callback ref: fires synchronously when the div attaches to / detaches from
  // the DOM. base-ui's Dialog portal can mount content after the parent's
  // useEffect fires, so a normal useRef + useEffect flow can race and silently
  // bail with ref.current === null. Callback refs dodge that. React 19 also
  // honors the returned cleanup function when the node detaches or the ref
  // changes, so each attach gets its own cancellation flag.
  const initGoogleButton = useCallback(
    (node: HTMLDivElement | null) => {
      hiddenGoogleButtonRef.current = node;
      if (!node || !GOOGLE_CLIENT_ID) return;

      let cancelled = false;

      (async () => {
        try {
          await loadGisScript();
          if (cancelled) return;
          const gid = window.google?.accounts.id;
          if (!gid) return;

          const { raw, hashed } = await generateNonce();
          if (cancelled) return;

          gid.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: (response) => {
              void handleGoogleCredential(response.credential, raw);
            },
            nonce: hashed,
            use_fedcm_for_prompt: true,
          });

          if (cancelled) return;
          node.innerHTML = "";
          gid.renderButton(node, {
            type: "standard",
            theme: "outline",
            size: "large",
            text: "continue_with",
            shape: "rectangular",
            logo_alignment: "center",
            width: 380,
          });
        } catch (err) {
          if (cancelled) return;
          setError(
            err instanceof Error
              ? err.message
              : "Could not load Google sign-in",
          );
        }
      })();

      return () => {
        cancelled = true;
      };
    },
    [handleGoogleCredential],
  );

  const handleOAuth = async (provider: "google" | "github") => {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        skipBrowserRedirect: true,
      },
    });

    if (data?.url) {
      window.location.replace(data.url);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
    });

    setSubmitting(false);

    if (error) {
      setError(error.message);
    } else {
      setMode("check-email");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (mode === "register") {
      const validation = validatePassword(password);
      if (!validation.isValid) {
        setError("Password does not meet all requirements");
        return;
      }
    }

    setSubmitting(true);

    const result =
      mode === "login"
        ? await signIn(email, password)
        : await signUp(email, password);

    setSubmitting(false);

    if (result.error) {
      setError(result.error.message);
    } else if (mode === "register") {
      setMode("check-email");
    } else {
      onOpenChange(false);
      resetForm();
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      resetForm();
      setMode("login");
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {mode === "check-email" ? (
          <>
            <DialogHeader>
              <DialogTitle>Check Your Email</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-muted-foreground text-base">
                We just sent a link to{" "}
                <span className="text-foreground font-medium">{email}</span>.
                Click it to continue — it should land in your inbox in under a
                minute.
              </p>
              <p className="text-muted-foreground text-sm">
                Didn&apos;t see it? Check your spam folder.
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => switchMode("login")}
              >
                Back to Sign In
              </Button>
            </div>
          </>
        ) : mode === "forgot" ? (
          <>
            <DialogHeader>
              <DialogTitle>Reset Password</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <p className="text-muted-foreground text-base">
                Enter your email and we&apos;ll send you a link to reset your
                password.
              </p>
              <div className="space-y-2">
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Sending..." : "Send Reset Link"}
              </Button>

              <p className="text-muted-foreground text-center text-base">
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className="text-primary underline"
                >
                  Back to Sign In
                </button>
              </p>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {mode === "login" ? "Sign In" : "Create Account"}
              </DialogTitle>
            </DialogHeader>

            {/* OAuth buttons — same Button shape for both providers. The
                Google button forwards its click to a hidden GIS button rendered
                off-screen below, which is what actually triggers the OAuth flow
                and returns an ID token to handleGoogleCredential. */}
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={
                  GOOGLE_CLIENT_ID
                    ? handleGoogleClick
                    : () => handleOAuth("google")
                }
                type="button"
              >
                <GoogleIcon />
                Continue with Google
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => handleOAuth("github")}
                type="button"
              >
                <GitHubIcon />
                Continue with GitHub
              </Button>
            </div>
            {GOOGLE_CLIENT_ID && (
              <div
                ref={initGoogleButton}
                aria-hidden="true"
                style={{
                  position: "fixed",
                  top: "-10000px",
                  left: "-10000px",
                  pointerEvents: "none",
                }}
              />
            )}

            <div className="relative">
              <Separator />
              <span className="bg-popover text-muted-foreground absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-2 text-xs">
                or
              </span>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  {mode === "login" && (
                    <button
                      type="button"
                      onClick={() => switchMode("forgot")}
                      className="text-muted-foreground hover:text-primary text-sm underline"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
                {mode === "register" && (
                  <PasswordStrengthIndicator password={password} />
                )}
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting
                  ? mode === "login"
                    ? "Signing in..."
                    : "Creating account..."
                  : mode === "login"
                    ? "Sign In"
                    : "Create Account"}
              </Button>

              {mode === "register" && (
                <p className="text-muted-foreground text-center text-sm leading-relaxed">
                  By creating an account, you agree to our{" "}
                  <Link
                    href="/terms"
                    className="hover:text-foreground underline underline-offset-2"
                    onClick={() => onOpenChange(false)}
                  >
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link
                    href="/privacy"
                    className="hover:text-foreground underline underline-offset-2"
                    onClick={() => onOpenChange(false)}
                  >
                    Privacy Policy
                  </Link>
                  .
                </p>
              )}

              <p className="text-muted-foreground text-center text-base">
                {mode === "login" ? (
                  <>
                    Don&apos;t have an account?{" "}
                    <button
                      type="button"
                      onClick={() => switchMode("register")}
                      className="text-primary underline"
                    >
                      Sign up
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{" "}
                    <button
                      type="button"
                      onClick={() => switchMode("login")}
                      className="text-primary underline"
                    >
                      Sign in
                    </button>
                  </>
                )}
              </p>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function GoogleIcon() {
  return (
    <svg className="mr-2 size-4" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg className="mr-2 size-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}
