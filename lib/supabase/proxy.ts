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
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(AUTH_PORTAL_HEADER, portal);

  let response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  const supabase = createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookieOptions: authCookieOptions(portal),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request: {
            headers: requestHeaders,
          },
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
}
