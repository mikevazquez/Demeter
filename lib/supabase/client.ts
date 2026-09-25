import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/env";
import {
  authCookieOptions,
  authPortalFromPath,
  type AuthPortal,
} from "@/lib/supabase/session-policy";

type BrowserClient = ReturnType<typeof createBrowserClient>;
const clients = new Map<AuthPortal, BrowserClient>();

function currentPortal(): AuthPortal {
  if (typeof window === "undefined") return "admin";
  return authPortalFromPath(window.location.pathname);
}

export function createClient(portal: AuthPortal = currentPortal()) {
  const cached = clients.get(portal);
  if (cached) return cached;

  // @supabase/ssr normally keeps one browser singleton. We keep one client per
  // portal instead, because Admin and Student intentionally use different
  // cookie namespaces on the same origin.
  const client = createBrowserClient(env.supabaseUrl, env.supabasePublishableKey, {
    isSingleton: false,
    cookieOptions: authCookieOptions(portal),
  });

  clients.set(portal, client);
  return client;
}
