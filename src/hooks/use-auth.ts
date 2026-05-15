"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  createSupabaseBrowserClient,
  type SupabaseBrowserClient,
} from "@/lib/supabase/client";
import type { User, AuthChangeEvent, Session } from "@supabase/supabase-js";
import { generateCitizenId, resolveUsername } from "@/lib/citizen-id";

/**
 * Three discrete states the hook moves through:
 *  - "loading"    — initial Supabase resolve hasn't completed yet. `user` is
 *                   null but that is NOT a signed-out state.
 *  - "signed-in"  — Supabase resolved with a user. `user` is non-null.
 *  - "signed-out" — Supabase resolved with no user. `user` is null.
 *
 * Prefer this over the `!user` shortcut whenever the answer matters during
 * the loading window — e.g. cleanup effects, conditional fetches, sign-out
 * banners. `!user` is true during loading too and has been the source of
 * loading-race bugs (see PR #69 / #75 history).
 */
export type AuthState = "loading" | "signed-in" | "signed-out";

const STORAGE_DISABLED_MESSAGE =
  "Sign-in requires browser storage. Disable private browsing or allow cookies for this site.";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [authState, setAuthState] = useState<AuthState>("loading");
  const initialized = useRef(false);
  const supabaseRef = useRef<SupabaseBrowserClient | null>(null);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Deferred to the effect so a throw during Supabase init can't crash
    // module evaluation and topple the entire client tree into global-error.
    const supabase = createSupabaseBrowserClient();
    supabaseRef.current = supabase;

    if (!supabase) {
      // Storage is blocked (iOS Safari private mode, content blockers, etc.).
      // No session can be persisted — move out of "loading" so the UI renders
      // as a signed-out anonymous reader instead of stalling on skeletons.
      setAuthState("signed-out");
      return;
    }

    supabase.auth
      .getUser()
      .then(({ data }: { data: { user: User | null } }) => {
        setUser(data.user);
        setAuthState(data.user ? "signed-in" : "signed-out");
      })
      .catch(() => {
        // Treat a failed resolve as "signed-out" so callers can stop showing
        // skeletons. The next onAuthStateChange tick will correct if a session
        // does come back.
        setAuthState("signed-out");
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      async (_event: AuthChangeEvent, session: Session | null) => {
        const currentUser = session?.user ?? null;
        setUser(currentUser);
        setAuthState(currentUser ? "signed-in" : "signed-out");

        // Backfill username for existing users who don't have one
        if (currentUser && _event === "SIGNED_IN") {
          const existing = currentUser.user_metadata?.username as
            | string
            | undefined;
          if (!existing || existing === "Anonymous") {
            const username = resolveUsername(currentUser);
            await supabase.auth.updateUser({ data: { username } });
          }
        }
      },
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = supabaseRef.current;
    if (!supabase) {
      return { error: { message: STORAGE_DISABLED_MESSAGE } };
    }
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const supabase = supabaseRef.current;
    if (!supabase) {
      return { error: { message: STORAGE_DISABLED_MESSAGE } };
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username: generateCitizenId() } },
    });
    // If signup succeeds and we have the user ID, update with a
    // deterministic Citizen ID based on their actual UUID.
    if (!error && data.user) {
      const stableId = generateCitizenId(data.user.id);
      await supabase.auth.updateUser({ data: { username: stableId } });
    }
    return { error };
  }, []);

  const signOut = useCallback(async () => {
    const supabase = supabaseRef.current;
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  // `loading` is the legacy shape — kept so existing callers compile while
  // they migrate to authState. Equivalent to `authState === "loading"`.
  const loading = authState === "loading";

  return { user, loading, authState, signIn, signUp, signOut };
}
