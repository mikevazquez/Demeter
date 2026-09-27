function requiredPublicEnv(name: string, value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return normalized;
}

const SANDBOX_SUPABASE_URL = "https://hedouonyhynuvwbckdlg.supabase.co";
const SANDBOX_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_pXzsmytzghwW-3QhLg11Qg_BFZT_kuW";

const isVercelPreview = process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";

export const env = {
  supabaseUrl: isVercelPreview
    ? SANDBOX_SUPABASE_URL
    : requiredPublicEnv(
        "NEXT_PUBLIC_SUPABASE_URL",
        process.env.NEXT_PUBLIC_SUPABASE_URL,
      ),
  supabasePublishableKey: isVercelPreview
    ? SANDBOX_SUPABASE_PUBLISHABLE_KEY
    : requiredPublicEnv(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      ),
} as const;
