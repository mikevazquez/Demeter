const PRODUCTION_HOST = "qfhojvgvhrbautvczffq.supabase.co";
const SANDBOX_HOST = "hedouonyhynuvwbckdlg.supabase.co";

export function assertServiceTargetIsolation(input: {
  url: string;
  vercelEnv?: string;
  candidatePreview?: string;
}) {
  if (input.vercelEnv !== "preview") return;

  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    throw new Error("preview_service_target_invalid");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hostname === PRODUCTION_HOST
  ) {
    throw new Error("preview_service_target_production_forbidden");
  }

  // Candidate cannot inherit the generic Preview's Sandbox service-role secret.
  // A separate audited credential and runtime mock boundary are prerequisites.
  if (input.candidatePreview === "1") {
    throw new Error("candidate_preview_service_role_not_certified");
  }

  if (parsed.hostname !== SANDBOX_HOST) {
    throw new Error("preview_service_target_unapproved");
  }
}
