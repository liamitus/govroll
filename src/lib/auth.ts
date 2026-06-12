import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateCitizenId } from "@/lib/citizen-id";
import type { User } from "@supabase/supabase-js";

interface AuthSuccess {
  userId: string;
  user: User;
  username: string;
  error: null;
}

interface AuthError {
  userId: null;
  user: null;
  username: null;
  error: NextResponse;
}

/**
 * Get the authenticated user, ensuring a Profile row exists in the database.
 * Returns the userId, Supabase user object, and resolved username in one call.
 */
export async function getAuthenticatedUser(): Promise<AuthSuccess | AuthError> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      userId: null,
      user: null,
      username: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  // Ensure a Profile row exists. We deliberately DO NOT copy the Supabase
  // user_metadata username into Profile.username here: that field is
  // client-writable via supabase.auth.updateUser() and carries no moderation,
  // so trusting it would let any user push an arbitrary (e.g. slur) name onto
  // every public surface. The display name is owned exclusively by the
  // moderated PATCH /api/account/username route. On first creation we seed a
  // safe, non-user-controlled Citizen ID; the user changes it through that
  // route. We return the trusted stored value so callers (e.g. comment
  // stamping) never propagate the unmoderated metadata name.
  const profile = await prisma.profile.upsert({
    where: { id: user.id },
    update: { email: user.email ?? null },
    create: {
      id: user.id,
      username: generateCitizenId(user.id),
      email: user.email ?? null,
    },
  });

  return { userId: user.id, user, username: profile.username, error: null };
}

/**
 * @deprecated Use getAuthenticatedUser() instead for Profile sync + username resolution.
 */
export async function getAuthenticatedUserId(): Promise<
  { userId: string; error: null } | { userId: null; error: NextResponse }
> {
  const result = await getAuthenticatedUser();
  if (result.error) {
    return { userId: null, error: result.error };
  }
  return { userId: result.userId, error: null };
}
