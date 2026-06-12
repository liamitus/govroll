import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveUsername } from "@/lib/citizen-id";
import { safeNextPath } from "@/lib/safe-redirect";

/**
 * Handles Supabase auth callbacks for:
 * - Email confirmation (after sign up)
 * - Password reset (magic link from email)
 * - OAuth provider redirects (Google, GitHub)
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // For password reset, redirect to the update password page
      const type = searchParams.get("type");
      if (type === "recovery") {
        return NextResponse.redirect(`${origin}/auth/update-password`);
      }

      // Ensure the user has a username (OAuth users won't have one set).
      // resolveUsername picks OAuth first name > Citizen-XXXX as fallback.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const currentUsername = user.user_metadata?.username as
          | string
          | undefined;
        if (!currentUsername || currentUsername === "Anonymous") {
          const username = resolveUsername(user);
          await supabase.auth.updateUser({ data: { username } });
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // If code exchange fails, redirect to home with error
  return NextResponse.redirect(`${origin}/?auth_error=true`);
}
