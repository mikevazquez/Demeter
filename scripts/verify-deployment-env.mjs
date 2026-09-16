import { createHash } from "node:crypto";

const SANDBOX_URL = "https://hedouonyhynuvwbckdlg.supabase.co";
const SANDBOX_PUBLISHABLE_KEY_SHA256 =
  "78e8e1bb4d82a5deef19e17848ddd08b1ac383ab1bb6c2cd3e52339742517d7a";

const vercelEnvironment = process.env.VERCEL_ENV?.trim();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

function fail(message) {
  console.error(`[deployment-env] ${message}`);
  process.exit(1);
}

if (vercelEnvironment === "preview") {
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
} else if (vercelEnvironment === "production" && supabaseUrl === SANDBOX_URL) {
  fail("Vercel Production must never use the Studio Flow Sandbox Supabase project.");
}
