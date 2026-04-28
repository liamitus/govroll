"use client";

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  DEFAULT_USER_PREFERENCES,
  type UserPreferenceKey,
  type UserPreferences,
  type UserPreferencesPatch,
} from "@/lib/user-preferences";

type PreferencesPayload = { preferences: UserPreferences };

export function userPreferencesQueryKey(userId: string | null) {
  return ["user-preferences", userId] as const;
}

async function fetchUserPreferences(
  signal?: AbortSignal,
): Promise<UserPreferences> {
  const res = await fetch("/api/user/preferences", {
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new Error("Failed to load preferences");
  const data = (await res.json()) as PreferencesPayload;
  return data.preferences;
}

async function patchUserPreferences(
  patch: UserPreferencesPatch,
): Promise<UserPreferences> {
  const res = await fetch("/api/user/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Failed to save preference: ${res.status} ${detail}`);
  }
  const data = (await res.json()) as PreferencesPayload;
  return data.preferences;
}

/**
 * Read-write access to a single user preference, server-synced for signed-in
 * users and defaulted for anon. The full prefs object is fetched once via
 * useQuery and cached; multiple useUserPref callers share that cache.
 *
 * Anon callers get the default value and a no-op setter — there's no account
 * to persist against. Components that show pref-mutation UI should still gate
 * on auth themselves; this is just defense-in-depth.
 *
 * Returns:
 *   - value: the current value (defaulted while loading or for anon)
 *   - setValue: optimistically updates the cache and PATCHes the server
 *   - isLoading: true on the initial fetch only (use sparingly — most
 *     callers don't need it because `value` is always usable)
 */
export function useUserPref<K extends UserPreferenceKey>(
  key: K,
): {
  value: UserPreferences[K];
  setValue: (value: UserPreferences[K]) => void;
  isLoading: boolean;
} {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryKey = userPreferencesQueryKey(userId);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<UserPreferences>({
    queryKey,
    queryFn: ({ signal }) => fetchUserPreferences(signal),
    // Defaulted for anon; cached for 5 minutes — a pref change is the only
    // thing that should bust this cache, and the mutation does so directly.
    staleTime: 5 * 60_000,
    placeholderData: DEFAULT_USER_PREFERENCES,
  });

  const mutation = useMutation({
    mutationFn: (patch: UserPreferencesPatch) => patchUserPreferences(patch),
    // Optimistic merge: write the partial into the cache immediately so the
    // toggle flips without a round-trip; roll back on error.
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<UserPreferences>(queryKey);
      queryClient.setQueryData<UserPreferences>(queryKey, (old) => ({
        ...(old ?? DEFAULT_USER_PREFERENCES),
        ...patch,
      }));
      return { previous };
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    // Server returns the merged result; trust it as the new truth so we
    // don't drift if the schema strips a key the cache had.
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next);
    },
  });

  const value = (data ?? DEFAULT_USER_PREFERENCES)[key];

  const setValue = useCallback(
    (next: UserPreferences[K]) => {
      // Anon callers can't persist — exit silently. Components that surface
      // a pref-mutation UI should already be gating on auth.
      if (!userId) return;
      mutation.mutate({ [key]: next } as UserPreferencesPatch);
    },
    [userId, key, mutation],
  );

  return { value, setValue, isLoading };
}
