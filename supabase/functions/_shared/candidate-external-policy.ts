/**
 * Prevent Candidate Edge Functions from invoking real providers or dispatching
 * notifications. No effect unless the isolated Candidate flag is configured.
 */
export function candidateExternalEffectsBlocked(flag: string | null | undefined): boolean {
  const value = flag?.trim();
  return Boolean(value && value !== "0");
}
