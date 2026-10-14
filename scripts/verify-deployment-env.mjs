import { createHash } from "node:crypto";

const SANDBOX_URL = "https://hedouonyhynuvwbckdlg.supabase.co";
const SANDBOX_PUBLISHABLE_KEY_SHA256 =
  "78e8e1bb4d82a5deef19e17848ddd08b1ac383ab1bb6c2cd3e52339742517d7a";
const CANDIDATE_URL = "https://sdmxtlgjkodidjtvikng.supabase.co";
const CANDIDATE_BRANCH = "governance/sf-gov-001-release-gates";
const CANDIDATE_PUBLISHABLE_KEY_SHA256 =
  "3a56e9481c73c7e4a02eed316ac6212763787c6ce39cda8828f40258bea690a6";

const vercelEnvironment = process.env.VERCEL_ENV?.trim();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

function fail(message) {
  console.error(`[deployment-env] ${message}`);
  process.exit(1);
}

if (vercelEnvironment === "preview") {
  if (supabaseUrl === CANDIDATE_URL) {
    if (
      process.env.VERCEL_GIT_COMMIT_REF !== CANDIDATE_BRANCH ||
      process.env.SUPABASE_URL !== CANDIDATE_URL ||
      process.env.SF_GOV_CANDIDATE_PREVIEW !== "1" ||
      !publishableKey ||
      createHash("sha256").update(publishableKey).digest("hex") !==
        CANDIDATE_PUBLISHABLE_KEY_SHA256 ||
      ["SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY", "MERCADOPAGO_ACCESS_TOKEN"].some(
        (key) => process.env[key] !== "sf-gov-disabled",
      )
    ) {
      fail("Candidate Preview configuration is not isolated. Refusing to build.");
    }
    console.log("[deployment-env] Candidate branch verified: providers and service role disabled.");
    process.exit(0);
  }
  if (supabaseUrl !== SANDBOX_URL) {
    fail(
      "Vercel Preview must use Studio Flow Sandbox. Refusing to build a Preview against any other Supabase project.",
    );
  }

  if (!publishableKey) {
    fail("Vercel Preview is missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  }

  const publishableKeyHash = createHash("sha256").update(publishableKey).digest("hex");
  if (publishableKeyHash !== SANDBOX_PUBLISHABLE_KEY_SHA256) {
    fail("Vercel Preview publishable key does not belong to the approved Studio Flow Sandbox.");
  }

  console.log("[deployment-env] Preview isolation verified: Studio Flow Sandbox.");
} else if (
  vercelEnvironment === "production" &&
  [SANDBOX_URL, CANDIDATE_URL].includes(supabaseUrl)
) {
  fail("Vercel Production must never use a non-production Supabase project.");
}
