import { build } from "esbuild";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
if (process.env.VERCEL_ENV !== "preview" || process.env.VERCEL_GIT_COMMIT_REF !== "codex/demi-sticker-vision" || process.env.NEXT_PUBLIC_SUPABASE_URL !== "https://hedouonyhynuvwbckdlg.supabase.co") throw Error("status_diagnostic_sandbox_required");
const temp = mkdtempSync(join(process.cwd(), ".status-routing-"));
try {
  const outfile = join(temp, "routing.mjs");
  await build({ stdin: { contents: 'export { getMetaWhatsAppWebhookRouting } from "./lib/assistant/meta-whatsapp-admin";', resolveDir: process.cwd() }, outfile, bundle: true, platform: "node", format: "esm", packages: "external", tsconfig: "tsconfig.json", plugins: [{ name: "server-only-test", setup(b) { b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "uat" })); b.onLoad({ filter: /.*/, namespace: "uat" }, () => ({ contents: "export {};" })); } }] });
  const { getMetaWhatsAppWebhookRouting } = await import(pathToFileURL(outfile));
  let routing;
  try { routing = await getMetaWhatsAppWebhookRouting("9fe23cfa-fb47-4670-afeb-ed4a56433772"); }
  catch { routing = { routes: [], verified: false, error_codes: ["routing_lookup_unavailable"] }; }
  // Only callback hosts/paths and stable diagnostic codes; never secrets or payload content.
  const safe = { routes: routing.routes, verified: routing.verified, error_codes: routing.error_codes.map((value) => /^[a-zA-Z0-9_:-]{1,100}$/.test(value) ? value : "routing_lookup_failed"), read_only: true, commit: process.env.VERCEL_GIT_COMMIT_SHA };
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const saved = await db.from("demi_uat_artifacts").insert({ run_id: "3b03aaf5-b014-4277-bc69-cef7aa2ba271", kind: "whatsapp_status_routing_diagnostic", payload: safe });
  if (saved.error) throw Error("status_diagnostic_evidence_failed");
  console.log("[status-routing] " + JSON.stringify(safe));
} finally { rmSync(temp, { recursive: true, force: true }); }
