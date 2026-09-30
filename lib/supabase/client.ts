import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/env";

export function createClient(studioId?: string) {
  const normalizedStudioId = studioId?.trim();

  return createBrowserClient(env.supabaseUrl, env.supabasePublishableKey, {
    isSingleton: normalizedStudioId ? false : undefined,
    global: normalizedStudioId
      ? {
          headers: {
            "x-studio-id": normalizedStudioId,
          },
        }
      : undefined,
  });
}
