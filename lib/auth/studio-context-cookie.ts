import { AUTH_COOKIE_MAX_AGE_SECONDS } from "@/lib/supabase/session-policy";

export const STUDIO_CONTEXT_COOKIE = "studio-flow-studio-id";

export function studioContextCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
  };
}
