// Keep Supabase auth cookies durable on a trusted device.
//
// Admin keeps Supabase's existing/default cookie namespace so current admin
// sessions survive this rollout. Student uses an independent cookie namespace,
// allowing both portal identities to stay signed in on the same device.
export const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

export type AuthPortal = "admin" | "student";

export const AUTH_PORTAL_HEADER = "x-demeter-auth-portal";
export const STUDENT_AUTH_COOKIE_NAME = "demeter-auth-student";

export function authPortalFromPath(pathname: string): AuthPortal {
  if (pathname.startsWith("/student") || pathname.startsWith("/login/student")) {
    return "student";
  }

  return "admin";
}

export function authCookieOptions(portal: AuthPortal) {
  return {
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
    ...(portal === "student" ? { name: STUDENT_AUTH_COOKIE_NAME } : {}),
  };
}
