import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { env } from "@/lib/env";
import {
  AUTH_PORTAL_HEADER,
  authCookieOptions,
  type AuthPortal,
} from "@/lib/supabase/session-policy";

export async function createClient(explicitPortal?: AuthPortal) {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const headerPortal = headerStore.get(AUTH_PORTAL_HEADER);
  const portal: AuthPortal =
    explicitPortal ?? (headerPortal === "student" ? "student" : "admin");

  return createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookieOptions: authCookieOptions(portal),
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
