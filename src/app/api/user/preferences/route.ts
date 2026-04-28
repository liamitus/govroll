import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_USER_PREFERENCES,
  coerceUserPreferences,
  userPreferencesPatchSchema,
} from "@/lib/user-preferences";
import { getAuthenticatedUser } from "@/lib/auth";

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

/**
 * GET /api/user/preferences
 *
 * Returns the current user's preferences object with all keys defaulted —
 * never null, so the client can read pref values without nullish gymnastics.
 * Anonymous callers get pure defaults rather than 401, which lets components
 * read prefs unconditionally and only gate writes on auth.
 */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { preferences: DEFAULT_USER_PREFERENCES },
      NO_STORE,
    );
  }

  const profile = await prisma.profile.findUnique({
    where: { id: user.id },
    select: { preferences: true },
  });

  return NextResponse.json(
    { preferences: coerceUserPreferences(profile?.preferences) },
    NO_STORE,
  );
}

/**
 * PATCH /api/user/preferences
 *
 * Merges the partial body into the stored preferences. 401 for anon — anon
 * users have no account to persist against. Returns the full merged result
 * so callers can use it as the optimistic-update truth without a refetch.
 */
export async function PATCH(request: Request) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = userPreferencesPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid preferences", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Read-modify-write rather than a JSONB merge function — keeps the schema
  // definition the only place that knows about pref keys and lets Zod strip
  // any junk that might have accumulated on disk before a key was removed.
  const profile = await prisma.profile.findUnique({
    where: { id: auth.userId },
    select: { preferences: true },
  });
  const current = coerceUserPreferences(profile?.preferences);
  const next = { ...current, ...parsed.data };

  await prisma.profile.update({
    where: { id: auth.userId },
    data: { preferences: next },
  });

  return NextResponse.json({ preferences: next }, NO_STORE);
}
