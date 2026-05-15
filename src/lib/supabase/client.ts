import { createBrowserClient } from "@supabase/ssr";

export type SupabaseBrowserClient = ReturnType<typeof createBrowserClient>;

let client: SupabaseBrowserClient | null = null;
let initFailed = false;

// iOS Safari in private browsing — and any context where storage is blocked —
// throws "SecurityError: The operation is insecure" deep inside Supabase's
// realtime init (the Phoenix Socket constructor touches `sessionStorage`).
// Returning null lets callers degrade to a read-only experience instead of
// crashing the whole page through the global error boundary.
export function createSupabaseBrowserClient(): SupabaseBrowserClient | null {
  if (client) return client;
  if (initFailed) return null;
  try {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    return client;
  } catch (err) {
    initFailed = true;
    console.warn("[supabase] Browser client init failed:", err);
    return null;
  }
}
