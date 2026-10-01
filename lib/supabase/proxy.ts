import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import {
  AUTH_PORTAL_HEADER,
  authCookieOptions,
  authPortalFromPath,
} from "@/lib/supabase/session-policy";

export async function updateSession(request: NextRequest) {
  const portal = authPortalFromPath(request.nextUrl.pathname);

  const buildResponse = () => {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(AUTH_PORTAL_HEADER, portal);

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  };

  let response = buildResponse();

  const supabase = createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookieOptions: authCookieOptions(portal),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, responseHeaders) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));

        // Rebuild after mutating request.cookies so Server Components receive
        // the refreshed auth cookies on this same request.
        response = buildResponse();

        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );

        // @supabase/ssr >= 0.10 provides anti-cache headers during refresh.
        // Forward them so Vercel/CDNs never reuse a response carrying auth state.
        Object.entries(responseHeaders ?? {}).forEach(([name, value]) =>
          response.headers.set(name, value),
        );
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
}
