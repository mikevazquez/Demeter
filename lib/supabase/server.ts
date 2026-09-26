import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { AUTH_COOKIE_MAX_AGE_SECONDS } from "@/lib/supabase/session-policy";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookieOptions: {
      maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot always persist cookies. proxy.ts handles refreshes.
        }
      },
    },
  });
}
