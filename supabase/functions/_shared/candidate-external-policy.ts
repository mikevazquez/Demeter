/**
 * Prevent Candidate Edge Functions from invoking real providers or dispatching
 * notifications. No effect unless the isolated Candidate flag is configured.
 */
export function candidateExternalEffectsBlocked(
  flag: string | null | undefined,
  supabaseUrl?: string | null,
): boolean {
  const value = flag?.trim();
  if (value && value !== "0") return true;
  try {
    return new URL(supabaseUrl ?? "").hostname === "sdmxtlgjkodidjtvikng.supabase.co";
  } catch {
    return false;
  }
}
