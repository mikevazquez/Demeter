import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { candidateExternalEffectsBlocked } from "../_shared/candidate-external-policy.ts";

const CANDIDATE_HOST = "sdmxtlgjkodidjtvikng.supabase.co";

Deno.serve(() => {
  const suppliedUrl = Deno.env.get("SUPABASE_URL") ?? "";
  let hostname = "";
  try {
    hostname = new URL(suppliedUrl).hostname;
  } catch {
    // Missing or invalid runtime target must fail closed.
  }
  const candidate = hostname === CANDIDATE_HOST;
  const denied = candidateExternalEffectsBlocked(
    Deno.env.get("SF_GOV_CANDIDATE_PREVIEW"),
    suppliedUrl,
  );
  return Response.json(
    {
      check: "sf-gov-candidate-denial-probe",
      candidate_target: candidate,
      external_effects_blocked: denied,
      no_external_requests_performed: true,
      result: candidate && denied ? "PASS" : "FAIL_CLOSED",
    },
    {
      status: candidate && denied ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
});
