import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/env";
import { AUTH_COOKIE_MAX_AGE_SECONDS } from "@/lib/supabase/session-policy";

export function createClient() {
  return createBrowserClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookieOptions: {
      maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
    },
  });
}
