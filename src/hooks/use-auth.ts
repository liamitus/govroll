"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { User, AuthChangeEvent, Session } from "@supabase/supabase-js";
import { generateCitizenId, resolveUsername } from "@/lib/citizen-id";

const supabase = createSupabaseBrowserClient();

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

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [authState, setAuthState] = useState<AuthState>("loading");
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

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
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
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
    await supabase.auth.signOut();
  }, []);

  // `loading` is the legacy shape — kept so existing callers compile while
  // they migrate to authState. Equivalent to `authState === "loading"`.
  const loading = authState === "loading";

  return { user, loading, authState, signIn, signUp, signOut };
}
