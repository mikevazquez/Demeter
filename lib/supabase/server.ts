import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { STUDIO_CONTEXT_COOKIE } from "@/lib/auth/studio-context-cookie";
import { env } from "@/lib/env";

export async function createClient() {
  const cookieStore = await cookies();
  const selectedStudioId = cookieStore.get(STUDIO_CONTEXT_COOKIE)?.value?.trim();

  return createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    global: selectedStudioId
      ? {
          headers: {
            "x-studio-id": selectedStudioId,
          },
        }
      : undefined,
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
