// Keep Supabase auth cookies durable on a trusted device.
//
// Modern browsers cap persistent cookies, so 400 days is the practical upper
// bound used by @supabase/ssr. Every successful session refresh rewrites the
// cookie and renews this window.
export const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;
