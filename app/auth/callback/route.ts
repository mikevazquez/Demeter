import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/login/studio/restablecer";

  if (!code) {
    return NextResponse.redirect(new URL("/login/studio?error=recovery", url.origin));
  }

  const supabase = await createClient("admin");
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL("/login/studio?error=recovery", url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
