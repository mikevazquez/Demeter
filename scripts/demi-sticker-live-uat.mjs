// Explicit opt-in live UAT. Runs only on this sandbox preview branch, never in production.
import { build } from "esbuild";
import { createClient } from "@supabase/supabase-js";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

if (
  process.env.VERCEL_ENV !== "preview" ||
  process.env.VERCEL_GIT_COMMIT_REF !== "codex/demi-sticker-vision" ||
  process.env.NEXT_PUBLIC_SUPABASE_URL !== "https://hedouonyhynuvwbckdlg.supabase.co"
)
  throw Error("sticker_uat_isolation_required");
if (!process.env.OPENAI_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw Error("sticker_uat_credentials_missing");
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const temp = mkdtempSync(join(process.cwd(), ".sticker-uat-"));
let run;
let acquired = false;
async function record(kind, payload) {
  const r = await db.from("demi_uat_artifacts").insert({ run_id: run.id, kind, payload });
  if (r.error) throw Error("uat_artifact_failed");
}
async function state() {
  const out = {};
  for (const table of [
    "sales",
    "payments",
    "reservations",
    "credit_ledger",
    "assistant_pending_actions",
    "assistant_tool_executions",
    "assistant_enrollment_intents",
    "assistant_transfer_purchase_intents",
  ]) {
    const r = await db
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("studio_id", run.studio_id);
    if (r.error) throw Error("uat_state_" + table);
    out[table] = r.count;
  }
  return out;
}
try {
  const outfile = join(temp, "runtime.mjs");
  await build({
    stdin: {
      contents:
        'export { POST } from "./app/api/integrations/meta-whatsapp/webhook/route"; export { withDemiUatScope } from "./lib/assistant/uat-scope";',
      resolveDir: process.cwd(),
    },
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    tsconfig: "tsconfig.json",
    plugins: [
      {
        name: "server-only-test",
        setup(b) {
          b.onResolve({ filter: /^server-only$/ }, () => ({
            path: "server-only",
            namespace: "uat",
          }));
          b.onLoad({ filter: /.*/, namespace: "uat" }, () => ({ contents: "export {};" }));
        },
      },
    ],
  });
  const { POST, withDemiUatScope } = await import(pathToFileURL(outfile));
  const source = await db
    .from("demi_uat_runs")
    .select("source_studio_id,owner_id")
    .eq("id", "3b03aaf5-b014-4277-bc69-cef7aa2ba271")
    .single();
  if (source.error) throw Error("source_run_missing");
  const seeded = await db.rpc("service_create_demi_uat_run", {
    p_source_studio: source.data.source_studio_id,
    p_owner: source.data.owner_id,
    p_commit: process.env.VERCEL_GIT_COMMIT_SHA,
  });
  if (seeded.error)
    console.log(
      "[sticker-uat] seed unavailable: " +
        seeded.error.code +
        "; reusing isolated run with its history intact",
    );
  const loaded = await db
    .from("demi_uat_runs")
    .select("id,studio_id,source_studio_id,owner_id,fixtures")
    .eq("id", seeded.data?.id || "3b03aaf5-b014-4277-bc69-cef7aa2ba271")
    .single();
  if (loaded.error) throw Error("uat_run_missing");
  run = loaded.data;
  if (!seeded.error) {
    const sourceConfig = await db
      .from("assistant_configs")
      .select("*")
      .eq("studio_id", run.source_studio_id)
      .eq("assistant_key", "demi")
      .single();
    if (sourceConfig.error) throw Error("uat_demi_config_missing");
    const {
      studio_id: ignoredStudio,
      created_at: ignoredCreated,
      updated_at: ignoredUpdated,
      id: ignoredId,
      ...configFields
    } = sourceConfig.data;
    void ignoredStudio;
    void ignoredCreated;
    void ignoredUpdated;
    void ignoredId;
    const copiedConfig = await db
      .from("assistant_configs")
      .update({ ...configFields, mode: "active" })
      .eq("studio_id", run.studio_id);
    if (copiedConfig.error) throw Error("uat_demi_config_copy_failed");
  }
  const lease = await db.rpc("service_acquire_demi_uat_run", {
    p_run: run.id,
    p_owner: run.owner_id,
    p_source: run.source_studio_id,
  });
  if (lease.error || lease.data !== true) throw Error("sticker_uat_run_busy");
  acquired = true;
  console.log("[sticker-uat] run=" + run.id + " studio=" + run.studio_id);
  const cfg = {
    accessToken: "uat-capture-only",
    phoneNumberId: "99900000001",
    wabaId: "99900000002",
    graphApiVersion: "v23.0",
    appSecret: randomBytes(32).toString("hex"),
    verifyToken: "uat",
    pilotWaIds: [],
    languageCode: "es_MX",
    countryCallingCode: "52",
    templates: {},
  };
  const baseline = await state();
  const cases = [
    ["STK-01", "saludo", "former_no_package"],
    ["STK-02", "gracias", "former_no_package"],
    ["STK-03", "animado", "companion"],
    ["STK-04", "ambiguo", "former_no_package"],
    ["STK-05", "confirmacion", "student_active"],
    ["STK-06", "accion", "student_active"],
    ["STK-07", "corrupto", "former_no_package"],
  ];
  let duplicate;
  for (const [caseId, fixture, persona] of cases) {
    const bytes =
      fixture === "corrupto"
        ? new Uint8Array([1, 2, 3])
        : new Uint8Array(readFileSync("tests/fixtures/demi-stickers/" + fixture + ".webp"));
    const mid = "uat-inbound-" + randomUUID(),
      mediaId = String(Date.now());
    const msg = {
      id: mid,
      from: run.fixtures.people[persona].wa_id,
      type: "sticker",
      timestamp: String(Math.floor(Date.now() / 1000)),
      sticker: { id: mediaId, mime_type: "image/webp" },
    };
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: cfg.wabaId,
          changes: [
            {
              field: "messages",
              value: { metadata: { phone_number_id: cfg.phoneNumberId }, messages: [msg] },
            },
          ],
        },
      ],
    });
    const scope = {
      runId: run.id,
      studioId: run.studio_id,
      supabase: db,
      config: cfg,
      media: new Map([[mediaId, { bytes, mimeType: "image/webp", fileSize: bytes.length }]]),
    };
    const before = await state();
    const invoke = () =>
      withDemiUatScope(scope, () =>
        POST(
          new Request(
            "https://uat.invalid/api/integrations/meta-whatsapp/webhook?studio=" + run.studio_id,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-hub-signature-256":
                  "sha256=" + createHmac("sha256", cfg.appSecret).update(body).digest("hex"),
              },
              body,
            },
          ),
        ),
      );
    const response = await invoke(),
      result = await response.json();
    const event = await db
      .from("assistant_whatsapp_events")
      .select(
        "id,processing_status,processing_result,last_error_code,assistant_conversation_id,outbound_turn_id",
      )
      .eq("studio_id", run.studio_id)
      .eq("provider_event_id", mid)
      .single();
    const reply = event.data?.outbound_turn_id
      ? (
          await db
            .from("assistant_turns")
            .select("content")
            .eq("id", event.data.outbound_turn_id)
            .eq("studio_id", run.studio_id)
            .single()
        ).data?.content
      : null;
    const after = await state();
    await record("sticker_uat_case", {
      case_id: caseId,
      fixture,
      persona,
      provider_id: mid,
      http_status: response.status,
      result,
      event: event.data,
      reply,
      before,
      after,
      integrity_unchanged: JSON.stringify(before) === JSON.stringify(after),
      review_status: "pending_human_review",
      commit: process.env.VERCEL_GIT_COMMIT_SHA,
      transport: "captured",
    });
    console.log(
      "[sticker-uat] " +
        caseId +
        " http=" +
        response.status +
        " status=" +
        event.data?.processing_status +
        " reply=" +
        JSON.stringify(reply),
    );
    if (!duplicate) duplicate = { invoke, mid };
  }
  const beforeDuplicate = await db
    .from("assistant_whatsapp_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("studio_id", run.studio_id);
  const d = await duplicate.invoke();
  const result = await d.json();
  const afterDuplicate = await db
    .from("assistant_whatsapp_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("studio_id", run.studio_id);
  await record("sticker_uat_case", {
    case_id: "STK-08",
    http_status: d.status,
    result,
    deliveries_before: beforeDuplicate.count,
    deliveries_after: afterDuplicate.count,
    review_status: "pending_human_review",
  });
  const after = await state();
  await record("sticker_uat_summary", {
    baseline,
    after,
    integrity_unchanged: JSON.stringify(baseline) === JSON.stringify(after),
    commit: process.env.VERCEL_GIT_COMMIT_SHA,
  });
  console.log("[sticker-uat] completed; conversational acceptance requires evidence review");
} finally {
  if (acquired)
    await db
      .from("demi_uat_runs")
      .update({ lease_until: null })
      .eq("id", run.id)
      .eq("studio_id", run.studio_id);
  rmSync(temp, { recursive: true, force: true });
}
