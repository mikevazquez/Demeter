/**
 * Prevent Candidate Edge Functions from invoking real providers or dispatching
 * notifications. Denies by Candidate destination even if the flag is not configured.
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
