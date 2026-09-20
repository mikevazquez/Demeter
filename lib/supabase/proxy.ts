import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const { data: claimsData } = await supabase.auth.getClaims();

  const isRewardsRoute =
    request.nextUrl.pathname === "/student/recompensas" ||
    request.nextUrl.pathname.startsWith("/student/recompensas/");

  if (isRewardsRoute && !claimsData?.claims?.sub) {
    const loginUrl = request.nextUrl.clone();
    const destination = `${request.nextUrl.pathname}${request.nextUrl.search}`;

    loginUrl.pathname = "/login/student";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", destination);

    const redirectResponse = NextResponse.redirect(loginUrl);
    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }
    return redirectResponse;
  }

  return response;
}
