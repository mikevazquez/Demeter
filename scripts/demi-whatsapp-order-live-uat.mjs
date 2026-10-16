// Explicit preview-only UAT: real model/database, captured WhatsApp transport.
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createClient } from "@supabase/supabase-js";

const sandbox = "https://hedouonyhynuvwbckdlg.supabase.co";
if (
  !process.argv.includes("--sandbox-capture-only") ||
  process.env.VERCEL_ENV !== "preview" ||
  process.env.VERCEL_GIT_COMMIT_REF !== "codex/demi-whatsapp-concurrent-replies" ||
  process.env.NEXT_PUBLIC_SUPABASE_URL !== sandbox
)
  throw new Error("whatsapp_order_uat_isolation_required");
if (!process.env.OPENAI_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  throw new Error("whatsapp_order_uat_credentials_missing");

const nativeFetch = globalThis.fetch;
const invocation = new AsyncLocalStorage();
let modelRequests = 0;
let gate;
function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  // A second guard protects against accidental escape from withDemiUatScope.
  if (![new URL(sandbox).hostname, "api.openai.com"].includes(url.hostname))
    throw new Error("whatsapp_order_uat_external_transport_forbidden");
  const isModel = url.hostname === "api.openai.com";
  if (isModel && ++modelRequests > 30) throw new Error("whatsapp_order_uat_model_limit");
  const hold = isModel && gate && invocation.getStore() === gate.providerId;
  if (hold) gate.started.resolve();
  const response = await nativeFetch(input, options);
  if (hold) await gate.release.promise;
  return response;
};

const db = createClient(sandbox, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const temp = mkdtempSync(join(process.cwd(), "work-whatsapp-uat-"));
let run;
let acquired = false;
let baseline;
const cases = [];
async function record(kind, payload) {
  const result = await db.from("demi_uat_artifacts").insert({ run_id: run.id, kind, payload });
  if (result.error) throw new Error("whatsapp_order_uat_artifact_failed");
}
async function state() {
  const result = {};
  for (const table of [
    "sales",
    "payments",
    "reservations",
    "credit_ledger",
    "assistant_pending_actions",
    "assistant_enrollment_intents",
    "assistant_transfer_purchase_intents",
    "demi_group_bookings",
  ]) {
    const count = await db
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("studio_id", run.studio_id);
    if (count.error) throw new Error("whatsapp_order_uat_state_" + table);
    result[table] = count.count;
  }
  return result;
}
async function deliveries() {
  const result = await db
    .from("assistant_whatsapp_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("studio_id", run.studio_id);
  if (result.error) throw new Error("whatsapp_order_uat_delivery_count_failed");
  return result.count;
}
async function event(providerId) {
  const result = await db
    .from("assistant_whatsapp_events")
    .select("id,processing_status,processing_result,outbound_turn_id,attempt_count")
    .eq("studio_id", run.studio_id)
    .eq("provider_event_id", providerId)
    .single();
  if (result.error) throw new Error("whatsapp_order_uat_event_missing");
  return result.data;
}
async function saveCase(id, result) {
  cases.push({ id, passed: true, ...result });
  await record("whatsapp_order_uat_case", cases.at(-1));
  console.log("[whatsapp-order-uat] " + id + " passed");
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
        name: "server-only-uat",
        setup(builder) {
          builder.onResolve({ filter: /^server-only$/ }, () => ({
            path: "server-only",
            namespace: "uat",
          }));
          builder.onLoad({ filter: /.*/, namespace: "uat" }, () => ({ contents: "export {};" }));
        },
      },
    ],
  });
  const { POST, withDemiUatScope } = await import(pathToFileURL(outfile));
  // This existing synthetic run supplies only the authorized source/owner metadata.
  const source = await db
    .from("demi_uat_runs")
    .select("source_studio_id,owner_id")
    .eq("id", "0f5db82d-c1b8-4d88-a50a-bbf61c962994")
    .single();
  if (source.error) throw new Error("whatsapp_order_uat_source_missing");
  const seeded = await db.rpc("service_create_demi_uat_run", {
    p_source_studio: source.data.source_studio_id,
    p_owner: source.data.owner_id,
    p_commit: process.env.VERCEL_GIT_COMMIT_SHA,
  });
  if (seeded.error || !seeded.data?.id)
    throw new Error("whatsapp_order_uat_seed_failed_" + (seeded.error?.code ?? "missing_id"));
  const loaded = await db
    .from("demi_uat_runs")
    .select("id,studio_id,source_studio_id,owner_id,fixtures")
    .eq("id", seeded.data.id)
    .single();
  if (loaded.error || loaded.data.studio_id === loaded.data.source_studio_id)
    throw new Error("whatsapp_order_uat_synthetic_run_required");
  run = loaded.data;
  const lease = await db.rpc("service_acquire_demi_uat_run", {
    p_run: run.id,
    p_owner: run.owner_id,
    p_source: run.source_studio_id,
  });
  if (lease.error || lease.data !== true) throw new Error("whatsapp_order_uat_run_busy");
  acquired = true;
  const configUpdate = await db
    .from("assistant_configs")
    .update({
      mode: "active",
      monthly_budget_usd_micros: 2_000_000,
      conversation_budget_usd_micros: 1_000_000,
      max_model_calls_per_turn: 6,
    })
    .eq("studio_id", run.studio_id)
    .eq("assistant_key", "demi");
  if (configUpdate.error) throw new Error("whatsapp_order_uat_config_failed");
  const config = {
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
  const scope = { runId: run.id, studioId: run.studio_id, supabase: db, config, media: new Map() };
  const recipient = run.fixtures.people.prospect.wa_id;
  function message(text, providerId = "uat-whatsapp-order-" + randomUUID()) {
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: config.wabaId,
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: config.phoneNumberId },
                contacts: [{ wa_id: recipient, profile: { name: "Prueba sintética Demi" } }],
                messages: [
                  {
                    id: providerId,
                    from: recipient,
                    type: "text",
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    text: { body: text },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const invoke = () =>
      invocation.run(providerId, () =>
        withDemiUatScope(scope, async () => {
          const response = await POST(
            new Request(
              "https://uat.invalid/api/integrations/meta-whatsapp/webhook?studio=" + run.studio_id,
              {
                method: "POST",
                body,
                headers: {
                  "content-type": "application/json",
                  "x-hub-signature-256":
                    "sha256=" + createHmac("sha256", config.appSecret).update(body).digest("hex"),
                },
              },
            ),
          );
          const payload = await response.json();
          assert.equal(response.status, 200, "webhook must succeed: " + JSON.stringify(payload));
          return payload;
        }),
      );
    return { providerId, invoke };
  }
  baseline = await state();
  await record("whatsapp_order_uat_started", {
    commit: process.env.VERCEL_GIT_COMMIT_SHA,
    transport: "captured",
  });
  console.log("[whatsapp-order-uat] run=" + run.id);

  const single = message("Hola, ¿qué actividades tienen? Por ahora sólo quiero información.");
  await single.invoke();
  assert.equal(await deliveries(), 1);
  assert.equal((await event(single.providerId)).processing_status, "processed");
  await saveCase("SINGLE", { deliveries: 1 });

  const first = message("Quiero saber qué necesito llevar para mi primera clase.");
  const latest = message("Me interesa Pole Fitness; sólo información, todavía no reserves nada.");
  gate = { providerId: first.providerId, started: deferred(), release: deferred() };
  const firstTask = first.invoke();
  try {
    await Promise.race([
      gate.started.promise,
      firstTask.then(() => {
        throw new Error("whatsapp_order_uat_model_not_invoked");
      }),
    ]);
    await latest.invoke();
  } finally {
    gate.release.resolve();
    await firstTask;
    gate = null;
  }
  assert.equal(
    (await event(first.providerId)).processing_result.outcome,
    "superseded_by_newer_text",
  );
  assert.equal((await event(latest.providerId)).processing_status, "processed");
  assert.equal(await deliveries(), 2);
  await saveCase("CONCURRENT_TEXTS", {
    older: first.providerId,
    latest: latest.providerId,
    added_deliveries: 1,
  });

  await first.invoke();
  await latest.invoke();
  assert.equal(await deliveries(), 2);
  await saveCase("REPLAY", { added_deliveries: 0 });

  const followup = message("¿Qué ropa necesito para esa clase? Sólo información.");
  await followup.invoke();
  assert.equal(await deliveries(), 3);
  await saveCase("CONTINUITY", { added_deliveries: 1 });

  const duplicate = message("Gracias, ya entendí. No hagas ninguna reserva.");
  await Promise.all([duplicate.invoke(), duplicate.invoke()]);
  assert.equal(await deliveries(), 4);
  assert.equal((await event(duplicate.providerId)).attempt_count, 1);
  await saveCase("SIMULTANEOUS_DUPLICATE", { added_deliveries: 1, attempts: 1 });

  const after = await state();
  assert.deepEqual(after, baseline, "informational UAT must not mutate commercial state");
  const captured = await db
    .from("assistant_whatsapp_deliveries")
    .select("provider_message_id")
    .eq("studio_id", run.studio_id);
  if (captured.error) throw new Error("whatsapp_order_uat_capture_audit_failed");
  assert(captured.data.every((row) => row.provider_message_id.startsWith("uat:")));
  await record("whatsapp_order_uat_summary", {
    passed: true,
    cases,
    baseline,
    after,
    model_requests: modelRequests,
    commit: process.env.VERCEL_GIT_COMMIT_SHA,
    transport: "captured",
    external_whatsapp_sends: 0,
  });
  console.log(
    "[whatsapp-order-uat] completed cases=" + cases.length + " model_requests=" + modelRequests,
  );
} catch (error) {
  if (run)
    await record("whatsapp_order_uat_summary", {
      passed: false,
      cases,
      baseline,
      model_requests: modelRequests,
      error: String(error.message).slice(0, 500),
      commit: process.env.VERCEL_GIT_COMMIT_SHA,
    });
  throw error;
} finally {
  gate?.release.resolve();
  if (acquired) {
    const release = await db
      .from("demi_uat_runs")
      .update({ lease_until: null })
      .eq("id", run.id)
      .eq("studio_id", run.studio_id);
    if (release.error) throw new Error("whatsapp_order_uat_release_failed");
  }
  globalThis.fetch = nativeFetch;
  rmSync(temp, { recursive: true, force: true });
}
