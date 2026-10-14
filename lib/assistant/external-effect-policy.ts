export type CandidateExternalEffect =
  | "meta_whatsapp_send"
  | "meta_inbox_send"
  | "meta_whatsapp_media_read"
  | "meta_inbox_media_read"
  | "openai_responses"
  | "openai_transcription"
  | "meta_admin_request"
  | "asistian_webhook"
  | "exchange_rate_read";

/**
 * A Candidate Preview must never call real external services. Existing
 * synthetic UAT capture paths return before reaching this guard.
 *
 * Fail closed on any non-empty value other than "0" so a misspelled flag
 * cannot silently enable payments, messages, or model API requests.
 */
export function assertCandidateExternalEffectAllowed(input: {
  effect: CandidateExternalEffect;
  candidatePreview?: string;
  supabaseUrls?: (string | undefined)[];
}) {
  const targetsCandidate = input.supabaseUrls?.some((value) => {
    if (!value) return false;
    try {
      return new URL(value).hostname === "sdmxtlgjkodidjtvikng.supabase.co";
    } catch {
      return false;
    }
  });
  if (
    targetsCandidate ||
    (input.candidatePreview?.trim() && input.candidatePreview.trim() !== "0")
  ) {
    throw new Error(`candidate_preview_external_effect_forbidden:${input.effect}`);
  }
}

export function assertCandidateRuntimeExternalEffectAllowed(effect: CandidateExternalEffect) {
  // Preview builds of this governance branch deny provider traffic regardless
  // of inherited secrets or a missing Candidate flag.
  if (process.env.VERCEL_ENV === "preview") {
    throw new Error(`candidate_preview_external_effect_forbidden:${effect}`);
  }
  assertCandidateExternalEffectAllowed({
    effect,
    candidatePreview: process.env.SF_GOV_CANDIDATE_PREVIEW,
    supabaseUrls: [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_URL],
  });
}
