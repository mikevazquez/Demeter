// Credential-free harness for the connected SQL tool. It emits JSON SQL requests
// and consumes JSON responses on stdin; the caller MUST route only to this Sandbox.
// Meta and commercial effects are explicit doubles. No provider/network clients.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { transformSync } from "esbuild";
const project = "hedouonyhynuvwbckdlg";
const studio = process.argv[2];
assert.match(studio ?? "", /^[0-9a-f-]{36}$/);
const pending = new Map();
let sequence = 0;
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  const task = pending.get(message.id);
  if (!task) return;
  pending.delete(message.id);
  if (message.error) task.reject(new Error(message.error));
  else task.resolve(message.rows);
});
function sql(query) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    process.stdout.write(JSON.stringify({ id, project, query }) + "\n");
  });
}
const literal = (v) =>
  v == null
    ? "null"
    : `'${(typeof v === "object" ? JSON.stringify(v) : String(v)).replaceAll("'", "''")}'`;
const rpc = async (name, args) => {
  assert.match(
    name,
    /^(assistant_whatsapp_(coordinate|claim_current_text|authorize_text_send|finish_text_claim|claim_action|finish_action)|service_prepare_meta_whatsapp_message|assistant_create_handoff)$/,
  );
  try {
    const rows = await sql(
      `select set_config('request.jwt.claim.role','service_role',true); select to_jsonb(public.${name}(${Object.entries(
        args,
      )
        .map(([key, value]) => `${key} => ${literal(value)}`)
        .join(",")})) as data;`,
    );
    return { data: rows[0].data, error: null };
  } catch (error) {
    return { data: null, error: String(error) };
  }
};
function load(path, deps) {
  const loadedModule = { exports: {} };
  new Function(
    "require",
    "module",
    "exports",
    transformSync(readFileSync(path, "utf8"), { loader: "ts", format: "cjs" }).code,
  )(
    (name) => {
      if (!(name in deps)) throw new Error(`Unexpected dependency ${name}`);
      return deps[name];
    },
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}
const retry = load("lib/assistant/delivery-retry-policy.ts", {});
const coordination = load("lib/assistant/demi-text-send-claim.ts", {
  "node:crypto": await import("node:crypto"),
  "./delivery-retry-policy": retry,
});
const { DemiTurnCoordinator } = coordination;
const contact = `52999${String(Date.now()).slice(-7)}`;
const results = [];
const owners = [];
let sends = 0,
  effects = 0;
const owner = (event, transport = rpc) => {
  const value = new DemiTurnCoordinator(transport, studio, event);
  owners.push(value);
  return value;
};
const event = async () => {
  const id = randomUUID();
  await sql(
    `insert into public.assistant_whatsapp_events(id,studio_id,provider_event_id,phone_number_id,contact_wa_id,message_type,payload_fingerprint,coordination_text) values (${literal(id)},${literal(studio)},${literal(`demi378-bridge-${id}`)},'synthetic-no-meta',${literal(contact)},'text','synthetic','DEMI378 synthetic text');`,
  );
  return id;
};
const accepted = async () => {
  sends++;
  return {
    status: "accepted",
    providerMessageId: `uat:demi378:${randomUUID()}`,
    httpStatus: 200,
    responseSnapshot: { accepted: true, simulated: true },
  };
};
async function test(name, run) {
  await run();
  results.push({ name, passed: true });
}
async function signedWebhookUat() {
  // Restricted PostgREST double transports the actual webhook's table operations
  // through the real Sandbox SQL connection. Identity/history/send claims are real.
  const allowed = new Set([
    "studios",
    "assistant_whatsapp_events",
    "assistant_turns",
    "assistant_conversations",
    "assistant_whatsapp_deliveries",
    "demi_operation_retry_settings",
  ]);
  const identifier = (value) => {
    assert.match(value, /^[a-z_][a-z0-9_]*$/);
    return `"${value}"`;
  };
  const from = (table) => {
    assert.ok(allowed.has(table));
    let operation = "select",
      payload,
      filters = [],
      order = "",
      maximum = "",
      selected = "*";
    const execute = async (single) => {
      const where = filters.length ? ` where ${filters.join(" and ")}` : "";
      let statement;
      if (operation === "insert")
        statement = `insert into public.${identifier(table)}(${Object.keys(payload).map(identifier).join(",")}) values (${Object.values(payload).map(literal).join(",")}) returning *`;
      else if (operation === "update")
        statement = `update public.${identifier(table)} set ${Object.entries(payload)
          .map(([k, v]) => `${identifier(k)}=${literal(v)}`)
          .join(",")} ${where} returning *`;
      else
        statement = `select ${selected} from public.${identifier(table)} ${where} ${order} ${maximum}`;
      try {
        const rows = await sql(
          operation === "select"
            ? `select coalesce(jsonb_agg(to_jsonb(q)),'[]') as rows from (${statement}) q;`
            : `with q as (${statement}) select coalesce(jsonb_agg(to_jsonb(q)),'[]') as rows from q;`,
        );
        const data = rows[0]?.rows ?? [];
        return { data: single ? (data[0] ?? null) : data, count: data.length, error: null };
      } catch (error) {
        return {
          data: null,
          error: {
            code: String(error).includes("duplicate key") ? "23505" : "synthetic_sql_error",
            message: String(error),
          },
        };
      }
    };
    const query = {
      select(fields = "*") {
        selected = fields === "*" ? "*" : fields.split(",").map(identifier).join(",");
        return query;
      },
      insert(value) {
        operation = "insert";
        payload = value;
        return query;
      },
      update(value) {
        operation = "update";
        payload = value;
        return query;
      },
      eq(k, v) {
        filters.push(`${identifier(k)}=${literal(v)}`);
        return query;
      },
      neq(k, v) {
        filters.push(`${identifier(k)}<>${literal(v)}`);
        return query;
      },
      gt(k, v) {
        filters.push(`${identifier(k)}>${literal(v)}`);
        return query;
      },
      in(k, v) {
        filters.push(`${identifier(k)} in (${v.map(literal).join(",")})`);
        return query;
      },
      is(k, v) {
        assert.equal(v, null);
        filters.push(`${identifier(k)} is null`);
        return query;
      },
      order(k, options) {
        order = `order by ${identifier(k)} ${options?.ascending === false ? "desc" : "asc"}`;
        return query;
      },
      limit(n) {
        assert.ok(Number.isInteger(n) && n > 0);
        maximum = `limit ${n}`;
        return query;
      },
      single() {
        return execute(true);
      },
      maybeSingle() {
        return execute(true);
      },
      then(resolve, reject) {
        return execute(false).then(resolve, reject);
      },
    };
    return query;
  };
  process.env.DEMI_ATOMIC_TEXT_SEND_CLAIMS = "true";
  process.env.DEMI_META_BURST_QUIET_MS = "0";
  const crypto = await import("node:crypto");
  const channel = load("lib/assistant/meta-whatsapp-channel.ts", {
    "server-only": {},
    "node:crypto": crypto,
    "./uat-scope": { demiUatScope: () => null, captureDemiUatText: async () => null },
  });
  const config = {
    accessToken: "synthetic-no-meta",
    phoneNumberId: "synthetic-phone",
    wabaId: "synthetic-waba",
    graphApiVersion: "v23.0",
    appSecret: "demi378-synthetic-signature",
    verifyToken: "synthetic",
    pilotWaIds: [],
    templates: {},
  };
  const webhookReceiptPrefix = `uat:demi378:webhook:${randomUUID()}`;
  const models = [];
  const captured = [];
  const route = load("app/api/integrations/meta-whatsapp/webhook/route.ts", {
    "@/lib/assistant/demi-text-send-claim": coordination,
    "@/lib/assistant/delivery-retry-policy": retry,
    "@/lib/assistant/orchestrator": {
      runAssistantTurn: async (input) => {
        models.push(input.history);
        return {
          reply: "DEMI378 synthetic consolidated response",
          trace: { simulated_model: true },
        };
      },
    },
    "@/lib/assistant/runtime-config": {
      loadDemiRuntimeConfig: async () => ({ data: { mode: "active" }, error: null }),
    },
    "@/lib/assistant/read-tools": {},
    "@/lib/assistant/sticker-media": {},
    "@/lib/assistant/audio-transcription": {},
    "@/lib/assistant/workshop-purchase": {},
    "@/lib/assistant/group-booking": {},
    "@/lib/assistant/enrollment-payment": {},
    "@/lib/assistant/receipt-reader": {},
    "@/lib/assistant/receipt-confirmation": {},
    "@/lib/assistant/student-access": {},
    "@/lib/assistant/pilot-forwarding": { pilotForwardTarget: () => null },
    "@/lib/assistant/meta-delivery-status": { extractMetaDeliveryStatuses: () => [] },
    "@/lib/supabase/service": { createServiceClient: () => ({ from, rpc }) },
    "@/lib/assistant/meta-whatsapp-channel": {
      ...channel,
      loadMetaWhatsAppWebhookConfig: async () => config,
      sendMetaWhatsAppText: async (input) => {
        captured.push(input.text);
        return {
          status: "accepted",
          providerMessageId: `${webhookReceiptPrefix}:${randomUUID()}`,
          httpStatus: 200,
          responseSnapshot: { simulated: true },
        };
      },
    },
  });
  const request = (messages) => {
    const body = JSON.stringify({
      entry: [
        {
          id: config.wabaId,
          changes: [
            {
              value: {
                metadata: { phone_number_id: config.phoneNumberId },
                messages: messages.map((item) => ({
                  id: item.id,
                  from: "529990003782",
                  type: "text",
                  text: { body: item.text },
                })),
              },
            },
          ],
        },
      ],
    });
    return new Request(
      `https://synthetic.test/api/integrations/meta-whatsapp/webhook?studio=${studio}`,
      {
        method: "POST",
        body,
        headers: {
          "x-hub-signature-256": `sha256=${crypto.createHmac("sha256", config.appSecret).update(body).digest("hex")}`,
        },
      },
    );
  };
  const prefix = randomUUID();
  const messages = [
    { id: `uat:demi378:${prefix}:a`, text: "DEMI378 Quiero información de Pole" },
    { id: `uat:demi378:${prefix}:b`, text: "DEMI378 Horarios y ubicación" },
  ];
  const previousInfo = console.info;
  console.info = () => {};
  try {
    const response = await route.POST(request(messages));
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(captured.length, 1);
    assert.equal(models.length, 1);
    assert.ok(models[0].some((row) => row.content === messages[0].text));
    assert.ok(models[0].some((row) => row.content === messages[1].text));
    const replay = await route.POST(request([messages[1]]));
    assert.equal(replay.status, 200);
    assert.equal(captured.length, 1);
    const persisted = await sql(
      `select count(*)::int as count from public.assistant_turns where studio_id=${literal(studio)} and channel_message_ref like ${literal(`${webhookReceiptPrefix}:%`)};`,
    );
    assert.equal(persisted[0].count, 1);
  } finally {
    console.info = previousInfo;
    delete process.env.DEMI_ATOMIC_TEXT_SEND_CLAIMS;
    delete process.env.DEMI_META_BURST_QUIET_MS;
  }
}

try {
  const identity = await sql(`select name,slug from public.studios where id=${literal(studio)};`);
  assert.equal(identity[0]?.slug, "demi378-concurrency-20261023");
  if (process.argv[3] !== "--webhook-only") {
    await test("real Sandbox sessions: one of six workers owns the turn; accepted send sealed", async () => {
      const id = await event(),
        workers = Array.from({ length: 6 }, () => owner(id));
      const statuses = await Promise.all(workers.map((w) => w.acquire()));
      assert.equal(statuses.filter((s) => s === "owned").length, 1);
      const winner = workers[statuses.indexOf("owned")];
      await winner.send(accepted);
      await winner.release();
      assert.equal(await owner(id).acquire(), "sealed");
    });
    await test("new text during generation invalidates the pending response", async () => {
      const id = await event(),
        worker = owner(id);
      await worker.acquire();
      await event();
      assert.equal(await worker.current(), false);
      await assert.rejects(worker.send(accepted));
      await worker.release();
    });
    await test("capture between reservation and final authorization prevents send", async () => {
      const id = await event();
      let injected = false;
      const transport = async (name, args) => {
        if (name === "assistant_whatsapp_authorize_text_send" && !injected) {
          injected = true;
          await event();
        }
        return rpc(name, args);
      };
      const worker = owner(id, transport);
      await worker.acquire();
      const before = sends;
      await assert.rejects(worker.send(accepted));
      assert.equal(sends, before);
      await worker.release();
    });
    await test("ambiguous network result is quarantined without blocking a new turn", async () => {
      const id = await event(),
        worker = owner(id);
      await worker.acquire();
      await assert.rejects(
        worker.send(async () => {
          sends++;
          throw new Error("simulated network cut");
        }),
      );
      await worker.release();
      assert.equal(await owner(id).acquire(), "sealed");
      const next = owner(await event());
      assert.equal(await next.acquire(), "owned");
      await next.send(accepted);
      await next.release();
    });
    await test("Meta accepted but receipt write unavailable cannot resend", async () => {
      const id = await event();
      const transport = (name, args) =>
        name === "assistant_whatsapp_finish_text_claim"
          ? Promise.resolve({ data: null, error: "simulated DB outage" })
          : rpc(name, args);
      const worker = owner(id, transport);
      await worker.acquire();
      const before = sends;
      await assert.rejects(worker.send(accepted));
      await worker.release();
      assert.equal(await owner(id).acquire(), "sealed");
      assert.equal(sends, before + 1);
    });
    await test("abandoned generation lease recovers and rejects the previous token", async () => {
      const id = await event(),
        first = owner(id);
      await first.acquire();
      await sql(
        `update public.assistant_whatsapp_turn_owners set owner_until=clock_timestamp()-interval '1 second' where studio_id=${literal(studio)} and owner_token=${literal(first.token)};`,
      );
      const second = owner(id);
      assert.equal(await second.acquire(), "owned");
      assert.equal(await first.current(), false);
      await second.send(accepted);
      await second.release();
    });
    await test("action receipt replays a simulated effect once; unknown effects never replay", async () => {
      const id = await event(),
        worker = owner(id);
      await worker.acquire();
      const effect = async () => {
        effects++;
        return { ok: true, synthetic_effect: randomUUID() };
      };
      const result = await worker.action("commercial_simulation", { a: 1 }, effect);
      assert.deepEqual(await worker.action("commercial_simulation", { a: 1 }, effect), result);
      assert.equal(effects, 1);
      await assert.rejects(
        worker.action("uncertain_simulation", {}, async () => {
          effects++;
          throw new Error("simulated uncertain effect");
        }),
      );
      await assert.rejects(worker.action("uncertain_simulation", {}, effect));
      assert.equal(effects, 2);
      await worker.release();
    });
  }
  await test(
    "signed webhook, real Sandbox identity/history/claims and captured Meta; replay sends once",
    signedWebhookUat,
  );
  const artifact = {
    project,
    studio,
    results,
    simulatedProviderAttempts: sends,
    simulatedEffects: effects,
    realMetaRequests: 0,
    realPaymentRequests: 0,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(
    process.argv[3] === "--webhook-only"
      ? "docs/uat/demi378-20261023/sandbox-webhook-final.json"
      : "docs/uat/demi378-20261023/sandbox-runtime.json",
    JSON.stringify(artifact, null, 2) + "\n",
  );
  process.stdout.write(JSON.stringify({ complete: artifact }) + "\n");
} catch (error) {
  process.stdout.write(JSON.stringify({ failed: String(error), results }) + "\n");
  process.exitCode = 1;
} finally {
  await Promise.all(owners.map((w) => w.release()));
  process.exit(process.exitCode ?? 0);
}
