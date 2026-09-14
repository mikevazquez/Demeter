function requiredPublicEnv(
  name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  supabaseUrl: requiredPublicEnv("NEXT_PUBLIC_SUPABASE_URL"),
  supabasePublishableKey: requiredPublicEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
} as const;
