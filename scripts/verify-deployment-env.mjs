const SANDBOX_URL = "https://hedouonyhynuvwbckdlg.supabase.co";

const vercelEnvironment = process.env.VERCEL_ENV?.trim();
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");

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

  console.log("[deployment-env] Preview Supabase URL isolation verified.");
} else if (vercelEnvironment === "production" && supabaseUrl === SANDBOX_URL) {
  fail("Vercel Production must never use the Studio Flow Sandbox Supabase project.");
}
