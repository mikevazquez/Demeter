"use server";

import {
  getMetaWhatsAppAdminDiagnostics,
  getMetaWhatsAppUatWelcome,
  getMetaWhatsAppWebhookRouting,
  sendMetaWhatsAppTemplateTest,
} from "@/lib/assistant/meta-whatsapp-admin";
import { normalizeMexicanPhone } from "@/lib/phone";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { createServiceClient } from "@/lib/supabase/service";
import { assertDemiUatEnvironment } from "@/lib/assistant/uat-environment";
import { withDemiUatScope } from "@/lib/assistant/uat-scope";
import { validateUatCaseResult } from "@/lib/assistant/uat-cases";
import {
  extractMetaInboundMessages,
  type MetaDownloadedMedia,
  type MetaWhatsAppWebhookConfig,
} from "@/lib/assistant/meta-whatsapp-channel";
import { POST as receiveMetaInbox } from "@/app/api/integrations/meta-inbox/webhook/route";
import type { MetaInboxWebhookConfig } from "@/lib/assistant/meta-inbox-channel";
import { POST as receiveWhatsApp } from "@/app/api/integrations/meta-whatsapp/webhook/route";

type Json = Record<string, unknown>;
type Run = {
  id: string;
  studio_id: string;
  source_studio_id: string;
  owner_id: string;
  fixtures: {
    people: Record<string, { wa_id: string; student_id: string | null }>;
    sessions: Record<string, string>;
  };
  baseline: Json;
  faults: Json;
  created_at: string;
};
const TABLES = [
  "students",
  "persons",
  "crm_contacts",
  "crm_followups",
  "assistant_conversations",
  "assistant_turns",
  "assistant_model_calls",
  "assistant_channel_identities",
  "assistant_meta_inbox_events",
  "assistant_meta_inbox_deliveries",
  "assistant_whatsapp_events",
  "assistant_whatsapp_deliveries",
  "assistant_pending_actions",
  "assistant_tool_executions",
  "assistant_enrollment_intents",
  "assistant_transfer_purchase_intents",
  "assistant_handoffs",
  "class_sessions",
  "reservations",
  "product_acquisitions",
  "student_enrollments",
  "credit_ledger",
  "sales",
  "payments",
  "notification_jobs",
  "notification_deliveries",
  "notification_delivery_attempts",
  "notification_rules",
  "demi_cash_purchases",
  "demi_group_bookings",
  "demi_group_receipts",
  "demi_followups",
  "demi_followup_settings",
];

async function context() {
  assertDemiUatEnvironment(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.VERCEL_ENV);
  const admin = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  return { ...admin, service: createServiceClient() };
}
async function ownedRun(id: string) {
  const ctx = await context();
  const { data, error } = await ctx.service
    .from("demi_uat_runs")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ctx.user.id)
    .eq("source_studio_id", ctx.studio.id)
    .single();
  if (error || !data) throw new Error("demi_uat_run_not_found");
  return { ...ctx, run: data as Run };
}
async function locked<T>(
  id: string,
  action: (ctx: Awaited<ReturnType<typeof ownedRun>>) => Promise<T>,
) {
  const ctx = await ownedRun(id);
  const { data, error } = await ctx.service.rpc("service_acquire_demi_uat_run", {
    p_run: id,
    p_owner: ctx.user.id,
    p_source: ctx.studio.id,
  });
  if (error || data !== true) throw new Error("demi_uat_run_busy");
  try {
    return await action(ctx);
  } finally {
    const release = await ctx.service
      .from("demi_uat_runs")
      .update({ lease_until: null })
      .eq("id", id)
      .eq("owner_id", ctx.user.id)
      .eq("source_studio_id", ctx.studio.id);
    if (release.error) throw new Error("demi_uat_release_failed");
  }
}
async function record(ctx: Awaited<ReturnType<typeof ownedRun>>, kind: string, payload: Json) {
  const { error } = await ctx.service
    .from("demi_uat_artifacts")
    .insert({ run_id: ctx.run.id, kind, payload });
  if (error) throw new Error("demi_uat_evidence_failed");
}
async function snapshot(ctx: Awaited<ReturnType<typeof ownedRun>>) {
  const entries: Array<readonly [string, unknown]> = [];
  for (let offset = 0; offset < TABLES.length; offset += 6) {
    const batch = await Promise.all(
      TABLES.slice(offset, offset + 6).map(async (table) => {
        const query = () =>
          ctx.service.from(table).select("*").eq("studio_id", ctx.run.studio_id).limit(300);
        let result = await query();
        if (result.error) result = await query();
        return [table, result.error ? { error: result.error.message } : result.data] as const;
      }),
    );
    entries.push(...batch);
  }
  const state = Object.fromEntries(entries);
  if (ctx.run.baseline?.task === "DEMI-TALL") {
    const conversations = Array.isArray(state.assistant_conversations)
      ? state.assistant_conversations.filter(
          (row) => row.status === "open" && row.assistant_key === "demi",
        )
      : [];
    // Use the narrow recovery RPC instead of granting the bank direct access
    // to private holds or identity-registration audit records.
    state.workshop_context = await Promise.all(
      conversations.map(async (row) => {
        const result = await ctx.service.rpc("service_demi_workshop_context", {
          p_studio: ctx.run.studio_id,
          p_conversation: row.id,
        });
        return {
          conversation_id: row.id,
          ...(result.error ? { error: result.error.message } : result.data),
        };
      }),
    );
  }
  return state;
}

export async function listDemiUatRuns() {
  const ctx = await context();
  const { data, error } = await ctx.service
    .from("demi_uat_runs")
    .select("id,studio_id,created_at")
    .eq("owner_id", ctx.user.id)
    .eq("source_studio_id", ctx.studio.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error("demi_uat_runs_unavailable");
  return data ?? [];
}

export async function recordDemiUatCase(form: FormData) {
  const id = String(form.get("runId") ?? "");
  const result = validateUatCaseResult(
    String(form.get("caseId") ?? ""),
    String(form.get("status") ?? ""),
    String(form.get("evidence") ?? ""),
  );
  await locked(id, async (ctx) => {
    await record(ctx, "case_result", {
      ...result,
      reviewer_id: ctx.user.id,
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
      recorded_at: new Date().toISOString(),
    });
  });
  return getDemiUatRun(id);
}
export async function createDemiUatRun() {
  const ctx = await context();
  const { data, error } = await ctx.service.rpc("service_create_demi_uat_run", {
    p_source_studio: ctx.studio.id,
    p_owner: ctx.user.id,
    p_commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
  });
  if (error || !data?.id) throw new Error(error?.message ?? "demi_uat_seed_failed");
  return getDemiUatRun(data.id);
}
export async function getDemiUatRun(id: string) {
  const ctx = await ownedRun(id);
  // Snapshot history is retained in DB and downloaded one small batch at a time.
  // Returning all before/after snapshots made every action response grow to MBs.
  const fields = [
    "text",
    "recipient",
    "captured",
    "failed",
    "result",
    "error",
    "case_id",
    "status",
    "evidence",
    "reviewer_id",
    "recorded_at",
    "commit",
    "persona",
    "channel",
    "provider_id",
    "decision",
    "handoff_id",
    "intent_id",
    "group_id",
    "session_id",
    "make_due",
    "days",
    "faults",
    "http_status",
    "delivery_verified",
    "error_code",
    "template",
    "language",
  ];
  const { data: artifacts, error } = await ctx.service
    .from("demi_uat_artifacts")
    .select("id,kind,created_at," + fields.map((key) => `${key}:payload->${key}`).join(","))
    .eq("run_id", id)
    .order("created_at", { ascending: false })
    .limit(150);
  if (error) throw new Error("demi_uat_evidence_unavailable");
  return {
    run: ctx.run,
    state: await snapshot(ctx),
    artifacts: ((artifacts ?? []) as unknown as Array<Record<string, unknown>>).map((artifact) => ({
      id: String(artifact.id),
      kind: String(artifact.kind),
      created_at: String(artifact.created_at),
      payload: Object.fromEntries([
        ...fields.filter((key) => artifact[key] != null).map((key) => [key, artifact[key]]),
        ["full_artifact_id", artifact.id],
      ]) as Json,
    })),
  };
}

export async function getDemiUatArtifactBatch(id: string, artifactIds: string[]) {
  const ctx = await ownedRun(id);
  if (
    !Array.isArray(artifactIds) ||
    artifactIds.length < 1 ||
    artifactIds.length > 3 ||
    artifactIds.some((key) => typeof key !== "string" || !/^[0-9a-f-]{36}$/i.test(key))
  )
    throw new Error("demi_uat_artifact_batch_invalid");
  const { data, error } = await ctx.service
    .from("demi_uat_artifacts")
    .select("id,kind,payload,created_at")
    .eq("run_id", id)
    .in("id", artifactIds);
  if (error || data?.length !== new Set(artifactIds).size)
    throw new Error("demi_uat_evidence_unavailable");
  return data;
}
export async function sendDemiUatMessage(form: FormData) {
  const id = String(form.get("runId") ?? "");
  await locked(id, async (ctx) => {
    const channel = String(form.get("channel") ?? "whatsapp");
    if (!["whatsapp", "facebook_messenger", "instagram"].includes(channel))
      throw new Error("demi_uat_channel_invalid");
    const isInbox = channel !== "whatsapp";
    const asOf = String(form.get("temporaryInformationNow") ?? "").trim();
    if (
      asOf &&
      (!isInbox ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(asOf) ||
        !Number.isFinite(Date.parse(asOf)))
    ) {
      throw new Error("demi_uat_clock_invalid");
    }
    const attachmentScenario = String(form.get("attachmentScenario") ?? "");
    const waScenario = String(form.get("waScenario") ?? "");
    if (
      waScenario &&
      (isInbox || !["unsupported_text_ad", "unsupported_empty"].includes(waScenario))
    )
      throw new Error("demi_uat_whatsapp_scenario_invalid");
    if (attachmentScenario && (!isInbox || !["video", "unsupported"].includes(attachmentScenario)))
      throw new Error("demi_uat_attachment_scenario_invalid");
    const key = String(form.get("persona") ?? "");
    const person = ctx.run.fixtures.people[key];
    if (!person) throw new Error("demi_uat_persona_invalid");
    const text = String(form.get("text") ?? "").trim();
    if (text.length > 4000) throw new Error("demi_uat_message_too_long");
    const file = form.get("file");
    const asSticker = form.get("asSticker") === "on";
    if (
      asSticker &&
      (isInbox || !(file instanceof File) || file.type !== "image/webp" || !file.size)
    )
      throw new Error("demi_uat_sticker_requires_whatsapp_webp");
    const media = new Map<string, MetaDownloadedMedia>();
    const mediaId = String(Date.now());
    const hasFile = file instanceof File && file.size > 0;
    if (hasFile && waScenario) throw new Error("demi_uat_whatsapp_scenario_with_file");
    if (hasFile && attachmentScenario) throw new Error("demi_uat_attachment_scenario_with_file");
    if (hasFile) {
      if (
        file.size > 900 * 1024 ||
        ![
          "image/jpeg",
          "image/png",
          "image/webp",
          "application/pdf",
          "audio/ogg",
          "audio/mpeg",
          "audio/mp4",
          "audio/wav",
          "audio/webm",
        ].includes(file.type)
      )
        throw new Error("demi_uat_invalid_receipt");
      media.set(mediaId, {
        bytes: new Uint8Array(await file.arrayBuffer()),
        mimeType: file.type as MetaDownloadedMedia["mimeType"],
        fileSize: file.size,
      });
    }
    if (!text && !hasFile && !attachmentScenario && waScenario !== "unsupported_empty")
      throw new Error("demi_uat_message_required");
    const attachmentUrl = `https://cdn.fbcdn.net/uat/${mediaId}`;
    if (hasFile) media.set(attachmentUrl, media.get(mediaId)!);
    const previousId = String(form.get("repeatProviderId") ?? "");
    if (previousId && !/^uat-inbound-[0-9a-f-]{36}$/.test(previousId))
      throw new Error("demi_uat_repeat_invalid");
    if (previousId) {
      const { data } = await ctx.service
        .from(isInbox ? "assistant_meta_inbox_events" : "assistant_whatsapp_events")
        .select("id")
        .eq("studio_id", ctx.run.studio_id)
        .eq("provider_event_id", previousId)
        .eq(isInbox ? "provider_contact_id" : "contact_wa_id", person.wa_id)
        .maybeSingle();
      if (!data) throw new Error("demi_uat_repeat_not_found");
    }
    const providerId = previousId || `uat-inbound-${randomUUID()}`;
    const config: MetaWhatsAppWebhookConfig = {
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
    const type = asSticker
      ? "sticker"
      : hasFile
        ? file.type.startsWith("audio/")
          ? "audio"
          : file.type === "application/pdf"
            ? "document"
            : "image"
        : "text";
    const message = {
      id: providerId,
      from: person.wa_id,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: waScenario ? "unsupported" : type,
      ...(waScenario === "unsupported_text_ad"
        ? {
            referral: {
              source_type: "ad",
              source_id: "UAT-AD-POLE",
              headline: "Pole desde cero",
              body: "Quiero agendar mi primera clase de Pole Fitness",
            },
          }
        : {}),
      ...(hasFile
        ? {
            [type]: {
              id: mediaId,
              ...(asSticker ? {} : { caption: text || "Comprobante ficticio UAT" }),
              mime_type: file.type,
              filename: file.name,
            },
          }
        : waScenario === "unsupported_empty"
          ? {}
          : { text: { body: text } }),
    };
    const whatsappBody = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: config.wabaId,
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: config.phoneNumberId },
                contacts: [{ wa_id: person.wa_id, profile: { name: `UAT ${key}` } }],
                messages: [message],
              },
            },
          ],
        },
      ],
    };
    const inboxConfig: MetaInboxWebhookConfig = {
      pageAccessToken: "uat-capture-only",
      pageId: "99900000001",
      instagramAccessToken: "uat-capture-only",
      instagramUserId: "99900000003",
      graphApiVersion: "v23.0",
      appSecret: config.appSecret,
      verifyToken: "uat",
      pilotContactIds: { facebook_messenger: [], instagram: [] },
    };
    const inboxAttachmentType = hasFile
      ? file.type.startsWith("audio/")
        ? "audio"
        : file.type === "application/pdf"
          ? "file"
          : "image"
      : null;
    const inboxAccountId =
      channel === "instagram" ? inboxConfig.instagramUserId : inboxConfig.pageId;
    const inboxBody = {
      object: channel === "instagram" ? "instagram" : "page",
      entry: [
        {
          id: inboxAccountId,
          messaging: [
            {
              sender: { id: person.wa_id },
              recipient: { id: inboxAccountId },
              timestamp: Date.now(),
              message: {
                mid: providerId,
                ...(hasFile || attachmentScenario
                  ? {
                      text,
                      attachments: [
                        {
                          type:
                            attachmentScenario === "unsupported"
                              ? "location"
                              : attachmentScenario || inboxAttachmentType,
                          payload: { url: attachmentUrl },
                        },
                      ],
                    }
                  : { text }),
              },
            },
          ],
        },
      ],
    };
    const body = JSON.stringify(isInbox ? inboxBody : whatsappBody);

    await record(ctx, "before_message", {
      persona: key,
      channel,
      attachment_scenario: attachmentScenario || null,
      whatsapp_scenario: waScenario || null,
      normalized_whatsapp_message: isInbox ? null : extractMetaInboundMessages(whatsappBody)[0],
      provider_id: providerId,
      text,
      file: hasFile ? { name: file.name, size: file.size, type: file.type } : null,
      state: await snapshot(ctx),
    });
    const response = await withDemiUatScope(
      {
        runId: id,
        temporaryInformationNow: asOf || undefined,
        studioId: ctx.run.studio_id,
        supabase: ctx.service,
        config,
        media,
        ...(isInbox ? { metaInboxConfig: inboxConfig } : {}),
      },
      () =>
        (isInbox ? receiveMetaInbox : receiveWhatsApp)(
          new Request(
            `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"}/api/integrations/${isInbox ? "meta-inbox" : "meta-whatsapp"}/webhook?studio=${ctx.run.studio_id}`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-hub-signature-256": `sha256=${createHmac("sha256", config.appSecret).update(body).digest("hex")}`,
              },
              body,
            },
          ),
        ),
    );
    await record(ctx, "after_message", {
      persona: key,
      channel,
      attachment_scenario: attachmentScenario || null,
      provider_id: providerId,
      temporary_information_now: asOf || null,
      http_status: response.status,
      result: await response.json(),
      state: await snapshot(ctx),
    });
  });
  return getDemiUatRun(id);
}
// Bounded, signed requests to the real receiver; only this authenticated capture scope
// supplies the synthetic credentials. No client-provided URL, phone, body or secret.
export async function runDemiUatBurst(id: string, scenario: string) {
  if (
    ![
      "burst",
      "same_payload",
      "contacts",
      "media",
      "stale",
      "stale_cancellation",
      "cancellation_control",
      "replay",
      "outside",
      "tenant_guard",
      "signature_guard",
    ].includes(scenario)
  )
    throw new Error("demi_uat_burst_scenario_invalid");
  await locked(id, async (ctx) => {
    if (process.env.DEMI_PILOT_FORWARD_URL || process.env.DEMI_PILOT_FORWARD_WA_IDS)
      throw new Error("demi_uat_burst_forwarding_configured");
    const people = ctx.run.fixtures.people;
    const cancellationCase = ["stale_cancellation", "cancellation_control"].includes(scenario);
    const person = cancellationCase ? people.trial_reserved : people.prospect;
    if (!person || !people.student_active || ctx.run.studio_id === ctx.studio.id)
      throw new Error("demi_uat_burst_fixture_invalid");
    const config: MetaWhatsAppWebhookConfig = {
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
    const configuredQuiet = Number(process.env.DEMI_META_BURST_QUIET_MS ?? "2500");
    const quietMs =
      Number.isFinite(configuredQuiet) && configuredQuiet >= 0 && configuredQuiet <= 10000
        ? Math.round(configuredQuiet)
        : 2500;
    const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
    const batchId = randomUUID();
    const started = new Date().toISOString();
    const inputs: Json[] = [];
    const responses: Json[] = [];
    const media = new Map<string, MetaDownloadedMedia>();
    const mediaId = `uat-image-${batchId}`;
    media.set(mediaId, {
      bytes: new Uint8Array(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=",
          "base64",
        ),
      ),
      mimeType: "image/png",
      fileSize: 68,
    });
    const message = (text: string, waId = person.wa_id, image = false) => ({
      id: `uat-inbound-${randomUUID()}`,
      from: waId,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: image ? "image" : "text",
      ...(image
        ? { image: { id: mediaId, mime_type: "image/png", caption: text } }
        : { text: { body: text } }),
    });
    const send = async (
      messages: ReturnType<typeof message>[],
      studioId = ctx.run.studio_id,
      validSignature = true,
    ) => {
      const body = JSON.stringify({
        object: "whatsapp_business_account",
        entry: [
          {
            id: config.wabaId,
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: { phone_number_id: config.phoneNumberId },
                  contacts: messages.map((m) => ({
                    wa_id: m.from,
                    profile: { name: "UAT ráfaga sintética" },
                  })),
                  messages,
                },
              },
            ],
          },
        ],
      });
      const sentAt = new Date().toISOString();
      inputs.push({ messages, sent_at: sentAt, target_studio: studioId, validSignature });
      let response: Response;
      try {
        response = await receiveWhatsApp(
          new Request(
            `http://localhost/api/integrations/meta-whatsapp/webhook?studio=${studioId}`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-hub-signature-256": validSignature
                  ? `sha256=${createHmac("sha256", config.appSecret).update(body).digest("hex")}`
                  : `sha256=${"0".repeat(64)}`,
              },
              body,
            },
          ),
        );
      } catch (error) {
        failure = error instanceof Error ? error.message : "demi_uat_receiver_failed";
        responses.push({ provider_ids: messages.map((m) => m.id), failure });
        return;
      }
      responses.push({
        provider_ids: messages.map((m) => m.id),
        sent_at: sentAt,
        completed_at: new Date().toISOString(),
        http_status: response.status,
        result: await response.json(),
      });
    };
    await record(ctx, "before_burst", {
      batch_id: batchId,
      scenario,
      started_at: started,
      quiet_ms: quietMs,
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
      state: await snapshot(ctx),
    });
    let failure: string | null = null;
    let observedModelCallDuringFirstRequest = false;
    try {
      await withDemiUatScope(
        { runId: id, studioId: ctx.run.studio_id, supabase: ctx.service, config, media },
        async () => {
          const texts = [
            message("Hola"),
            message("Estoy buscando una clase de Pole Fitness"),
            message("¿Qué opciones tienen para empezar?"),
          ];
          if (scenario === "same_payload") return send(texts);
          if (scenario === "tenant_guard") return send([texts[0]], ctx.studio.id);
          if (scenario === "signature_guard") return send([texts[0]], ctx.run.studio_id, false);
          if (scenario === "contacts")
            return void (await Promise.all([
              send([texts[0]]),
              send([message("¿Cuántas clases me quedan?", people.student_active.wa_id)]),
            ]));
          if (scenario === "burst" || scenario === "media") {
            const pending = [send([texts[0]])];
            await pause(400);
            pending.push(
              send([
                scenario === "media"
                  ? message("Imagen sintética de prueba, no es un pago.", person.wa_id, true)
                  : texts[1],
              ]),
            );
            if (scenario === "burst") {
              await pause(400);
              pending.push(send([texts[2]]));
            }
            await Promise.all(pending);
            return;
          }
          const cancellationRequest =
            "Antes de cancelar, consulta la política de cancelación. Después cancela mi única reserva de Pole Fitness porque no podré asistir.";
          if (scenario === "cancellation_control") {
            const first = message(cancellationRequest);
            await send([first]);
            await send([first]);
            return;
          }
          if (scenario === "stale" || scenario === "stale_cancellation") {
            const first = message(
              cancellationCase
                ? cancellationRequest
                : "¿Qué opciones y precios tienen para empezar Pole Fitness?",
            );
            let settled = false;
            const pending = send([first]).finally(() => {
              settled = true;
            });
            const deadline = Date.now() + 25000;
            try {
              while (!settled && Date.now() < deadline) {
                await pause(250);
                const event = await ctx.service
                  .from("assistant_whatsapp_events")
                  .select("assistant_conversation_id")
                  .eq("studio_id", ctx.run.studio_id)
                  .eq("provider_event_id", first.id)
                  .maybeSingle();
                if (event.error) throw new Error("demi_uat_burst_observation_failed");
                if (!event.data?.assistant_conversation_id) continue;
                const call = await ctx.service
                  .from("assistant_model_calls")
                  .select("id")
                  .eq("studio_id", ctx.run.studio_id)
                  .eq("conversation_id", event.data.assistant_conversation_id)
                  .gte("created_at", started)
                  .limit(1);
                if (call.error) throw new Error("demi_uat_burst_observation_failed");
                if (call.data?.length && !settled) {
                  observedModelCallDuringFirstRequest = true;
                  break;
                }
              }
            } finally {
              // Drain both receivers before releasing the run lease, including observation errors.
              await Promise.all([
                pending,
                send([
                  message(
                    cancellationCase
                      ? "Espera, ya no quiero cancelar. Mantén mi reserva; sí podré asistir."
                      : "Espera, mi pregunta ahora es: ¿dónde está el estudio?",
                  ),
                ]),
              ]);
            }
            if (cancellationCase) await send([first]);
            return;
          }
          await send([texts[0]]);
          if (scenario === "outside") {
            await pause(quietMs + 300);
            await send([message("¿Dónde está el estudio?")]);
          } else {
            await send([texts[0]]);
          }
        },
      );
    } catch (error) {
      failure = error instanceof Error ? error.message : "demi_uat_burst_failed";
    }
    await record(ctx, "after_burst", {
      batch_id: batchId,
      scenario,
      started_at: started,
      completed_at: new Date().toISOString(),
      quiet_ms: quietMs,
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
      transport: "capture_only",
      observed_model_call_during_first_request: observedModelCallDuringFirstRequest,
      failure,
      inputs,
      responses,
      state: await snapshot(ctx),
    });
    if (failure) throw new Error(failure);
  });
  return getDemiUatRun(id);
}

export async function configureDemiUatFailures(id: string, count: number) {
  if (!Number.isInteger(count) || count < 0 || count > 3)
    throw new Error("demi_uat_failure_count_invalid");
  await locked(id, async (ctx) => {
    const faults = { ...ctx.run.faults, delivery_failures_remaining: count };
    const { error } = await ctx.service.from("demi_uat_runs").update({ faults }).eq("id", id);
    if (error) throw new Error("demi_uat_fault_config_failed");
    await record(ctx, "fault_config", { faults });
  });
  return getDemiUatRun(id);
}
export async function moveDemiUatSession(id: string, sessionKey: string, hours: number) {
  if (![-2, 0, 4, 5, 6, 8, 24].includes(hours)) throw new Error("demi_uat_clock_invalid");
  await locked(id, async (ctx) => {
    const sessionId = ctx.run.fixtures.sessions[sessionKey];
    if (!sessionId) throw new Error("demi_uat_session_invalid");
    const starts = Date.now() + hours * 3600000;
    const before = await snapshot(ctx);
    const { error } = await ctx.service
      .from("class_sessions")
      .update({
        starts_at: new Date(starts).toISOString(),
        ends_at: new Date(starts + 3600000).toISOString(),
      })
      .eq("studio_id", ctx.run.studio_id)
      .eq("id", sessionId);
    if (error) throw new Error(error.message);
    await record(ctx, "session_time_changed", {
      session_key: sessionKey,
      hours_from_now: hours,
      before,
      after: await snapshot(ctx),
    });
  });
  return getDemiUatRun(id);
}

export async function runDemiUatNotifications(id: string, makeDue: boolean) {
  await locked(id, async (ctx) => {
    const before = await snapshot(ctx);
    if (makeDue) {
      const now = new Date().toISOString();
      const jobs = await ctx.service
        .from("notification_jobs")
        .update({ available_at: now, scheduled_at: now, next_attempt_at: now })
        .eq("studio_id", ctx.run.studio_id)
        .in("state", ["ready", "scheduled", "retry_wait"]);
      const deliveries = await ctx.service
        .from("notification_deliveries")
        .update({ available_at: now, next_attempt_at: now })
        .eq("studio_id", ctx.run.studio_id)
        .in("state", ["pending", "retry_wait"]);
      if (jobs.error || deliveries.error) throw new Error("demi_uat_due_change_failed");
    }
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) throw new Error("demi_uat_worker_not_configured");
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/notification-delivery-worker`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secret}`,
          "x-demi-uat-run": id,
        },
        body: JSON.stringify({ limit: 100 }),
        signal: AbortSignal.timeout(60000),
      },
    );
    const result = await response.json();
    await record(ctx, "notification_worker", {
      make_due: makeDue,
      http_status: response.status,
      result,
      before,
      after: await snapshot(ctx),
    });
    if (!response.ok) throw new Error("demi_uat_worker_failed");
  });
  return getDemiUatRun(id);
}

export async function runDemiUatFollowups(id: string, days: number) {
  if (![0, 1, 2, 3, 7, 14, 15, 30].includes(days)) throw new Error("demi_uat_clock_invalid");
  await locked(id, async (ctx) => {
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) throw new Error("demi_uat_worker_not_configured");
    const before = await snapshot(ctx);
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/demi-followup-worker`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({
          studio_id: ctx.run.studio_id,
          as_of: new Date(Date.now() + days * 86400000).toISOString(),
        }),
      },
    );
    const result = await response.json();
    await record(ctx, "followup_worker", {
      days,
      result,
      before,
      after: await snapshot(ctx),
    });
    if (!response.ok) throw new Error("demi_uat_followup_worker_failed");
  });
  return getDemiUatRun(id);
}

/**
 * Records a clearly synthetic full receipt only inside this owned UAT run.
 * It never represents a bank transfer or creates a payment.
 */
export async function simulateDemiUatGroupReceipt(id: string, groupId: string) {
  await locked(id, async (ctx) => {
    const { data: group, error: groupError } = await ctx.service
      .from("demi_group_bookings")
      .select("id,conversation_id,amount_minor,currency,status,receipt_event_id")
      .eq("studio_id", ctx.run.studio_id)
      .eq("id", groupId)
      .single();
    if (groupError || !group) throw new Error("demi_uat_group_not_found");
    if (group.status !== "awaiting_receipt" || group.receipt_event_id)
      throw new Error("demi_uat_group_not_awaiting_receipt");
    if (!Number.isInteger(group.amount_minor) || group.amount_minor <= 0 || !group.currency)
      throw new Error("demi_uat_group_amount_invalid");

    const eventId = randomUUID();
    const providerId = `uat-synthetic-receipt-${eventId}`;
    const mediaId = `uat-synthetic-media-${eventId}`;
    const hash = createHmac("sha256", ctx.run.id)
      .update(`synthetic-full-receipt:${group.id}:${eventId}`)
      .digest("hex");
    const path = `uat-synthetic://${ctx.run.id}/${group.id}/${eventId}`;
    const before = await snapshot(ctx);
    const { error: eventError } = await ctx.service.from("assistant_whatsapp_events").insert({
      id: eventId,
      studio_id: ctx.run.studio_id,
      provider: "meta_whatsapp",
      provider_event_id: providerId,
      phone_number_id: "UAT-SYNTHETIC",
      contact_wa_id: ctx.run.fixtures.people.prospect?.wa_id ?? null,
      message_type: "image",
      body_preview: "SIMULACIÓN UAT — COMPROBANTE SINTÉTICO — NO ES UN PAGO REAL",
      media_id: mediaId,
      payload_fingerprint: hash,
      assistant_conversation_id: group.conversation_id,
      processing_status: "processed",
      processing_result: { synthetic_uat: true, money_transferred: false },
    });
    if (eventError) throw new Error("demi_uat_synthetic_receipt_event_failed");

    const receipt = await ctx.service.rpc("service_record_demi_group_receipt", {
      p_studio: ctx.run.studio_id,
      p_conversation: group.conversation_id,
      p_group: group.id,
      p_event: eventId,
      p_provider: providerId,
      p_media: mediaId,
      p_path: path,
      p_hash: hash,
      p_amount: group.amount_minor,
      p_currency: group.currency,
      p_confidence: 1,
    });
    await record(ctx, "synthetic_group_receipt", {
      group_id: group.id,
      event_id: eventId,
      provider_id: providerId,
      media_id: mediaId,
      amount_minor: group.amount_minor,
      currency: group.currency,
      synthetic: true,
      money_transferred: false,
      result: receipt.data,
      error: receipt.error?.message ?? null,
      before,
      after: await snapshot(ctx),
    });
    if (receipt.error || (receipt.data as Json | null)?.ok !== true)
      throw new Error("demi_uat_synthetic_receipt_failed");
  });
  return getDemiUatRun(id);
}

export async function reviewDemiUatGroup(id: string, groupId: string, decision: string) {
  if (!["approved", "rejected"].includes(decision)) throw new Error("demi_uat_review_invalid");
  await locked(id, async (ctx) => {
    const group = await ctx.service
      .from("demi_group_bookings")
      .select("id")
      .eq("studio_id", ctx.run.studio_id)
      .eq("id", groupId)
      .single();
    if (group.error) throw new Error("demi_uat_group_not_found");
    const before = await snapshot(ctx);
    const result = await ctx.supabase.rpc("admin_review_demi_group", {
      p_group: groupId,
      p_decision: decision,
      p_note: "Revisión ficticia UAT",
    });
    await record(ctx, "group_review", {
      group_id: groupId,
      decision,
      result: result.data,
      error: result.error?.message ?? null,
      before,
      after: await snapshot(ctx),
    });
    if (result.error) throw new Error("demi_uat_group_review_failed");
  });
  return getDemiUatRun(id);
}

export async function reviewDemiUatReceipt(id: string, intentId: string, decision: string) {
  if (!["approved", "rejected"].includes(decision)) throw new Error("demi_uat_review_invalid");
  await locked(id, async (ctx) => {
    const { data, error } = await ctx.service
      .from("assistant_transfer_purchase_intents")
      .select("id")
      .eq("studio_id", ctx.run.studio_id)
      .eq("id", intentId)
      .single();
    if (error || !data) throw new Error("demi_uat_intent_not_found");
    const before = await snapshot(ctx);
    const result = await ctx.supabase.rpc("admin_review_transfer_purchase", {
      target_intent_id: intentId,
      target_decision: decision,
      target_note: "Validación ficticia del banco operativo Demi UAT",
    });
    await record(ctx, "human_receipt_review", {
      decision,
      intent_id: intentId,
      result: result.data,
      error: result.error?.message ?? null,
      before,
      after: await snapshot(ctx),
    });
    if (result.error) throw new Error(result.error.message);
  });
  return getDemiUatRun(id);
}

export async function markDemiUatAttendance(id: string, reservationId: string, status: string) {
  if (!["attended", "no_show"].includes(status)) throw new Error("demi_uat_attendance_invalid");
  await locked(id, async (ctx) => {
    const { data, error } = await ctx.service
      .from("reservations")
      .select("id")
      .eq("studio_id", ctx.run.studio_id)
      .eq("id", reservationId)
      .single();
    if (error || !data) throw new Error("demi_uat_reservation_not_found");
    const before = await snapshot(ctx);
    const result = await ctx.supabase.rpc("set_attendance_status", {
      target_reservation_id: reservationId,
      target_status: status,
      target_reason: "Prueba operativa Demi UAT",
    });
    await record(ctx, "human_attendance", {
      status,
      reservation_id: reservationId,
      result: result.data,
      error: result.error?.message ?? null,
      before,
      after: await snapshot(ctx),
    });
    if (result.error) throw new Error(result.error.message);
  });
  return getDemiUatRun(id);
}

export async function checkDemiUatMeta(runId: string) {
  const ctx = await ownedRun(runId);
  const run = ctx.run;
  const diagnostics = await getMetaWhatsAppAdminDiagnostics(run.source_studio_id);
  const routing = diagnostics.connected
    ? await getMetaWhatsAppWebhookRouting(run.source_studio_id)
    : null;
  await ctx.service.from("demi_uat_artifacts").insert({
    run_id: run.id,
    kind: "meta_readiness",
    payload: {
      connected: diagnostics.connected,
      webhook_routing: routing,
      error_code: diagnostics.errorCode,
      subscribed_app_count: diagnostics.subscribedApps.length,
      approved_templates: diagnostics.templates
        .filter((t) => t.status === "APPROVED")
        .map((t) => ({
          name: t.name,
          language: t.language,
          variable_count: t.variableCount,
          test_ready: t.testReady,
        })),
    },
  });
  return getDemiUatRun(run.id);
}

export async function sendDemiUatMetaTest(runId: string, recipient: string) {
  return locked(runId, async (ctx) => {
    const run = ctx.run;
    const phone = normalizeMexicanPhone(recipient);
    if (!phone) throw new Error("meta_test_phone_invalid");
    const diagnostics = await getMetaWhatsAppAdminDiagnostics(run.source_studio_id);
    const zeroVariable = diagnostics.templates.find(
      (t) => t.status === "APPROVED" && t.testReady && t.variableCount === 0,
    );
    const template = zeroVariable
      ? { ...zeroVariable, bodyParameters: [] }
      : diagnostics.connected
        ? await getMetaWhatsAppUatWelcome(run.source_studio_id)
        : null;
    if (!diagnostics.connected || !template)
      throw new Error(diagnostics.errorCode ?? "meta_compatible_welcome_template_unavailable");
    const { data: existing, error: lookupError } = await ctx.service
      .from("demi_uat_artifacts")
      .select("id")
      .eq("run_id", run.id)
      .eq("kind", "meta_external_test")
      .contains("payload", { recipient: phone })
      .limit(1)
      .maybeSingle();
    if (lookupError) throw new Error("meta_test_lookup_failed");
    if (existing) return getDemiUatRun(run.id);
    // Record before dispatch: ambiguous network results require review, never blind replay.
    const { data: attempt, error } = await ctx.service
      .from("demi_uat_artifacts")
      .insert({
        run_id: run.id,
        kind: "meta_external_test",
        payload: {
          recipient: phone,
          template: template.name,
          language: template.language,
          status: "dispatching",
          delivery_verified: false,
        },
      })
      .select("id")
      .single();
    if (error || !attempt) throw new Error("meta_test_audit_failed");
    try {
      const id = await sendMetaWhatsAppTemplateTest({
        studioId: run.source_studio_id,
        recipient: phone,
        templateName: template.name,
        languageCode: template.language,
        bodyParameters: template.bodyParameters,
      });
      await ctx.service
        .from("demi_uat_artifacts")
        .update({
          payload: {
            recipient: phone,
            template: template.name,
            language: template.language,
            status: "accepted",
            provider_message_id: id,
            delivery_verified: false,
          },
        })
        .eq("id", attempt.id);
    } catch (error) {
      await ctx.service
        .from("demi_uat_artifacts")
        .update({
          payload: {
            recipient: phone,
            template: template.name,
            language: template.language,
            status: "requires_review",
            error_code: error instanceof Error ? error.message : "meta_test_failed",
            delivery_verified: false,
          },
        })
        .eq("id", attempt.id);
    }
    return getDemiUatRun(run.id);
  });
}

export async function reviewDemiUatHandoff(
  id: string,
  handoffId: string,
  decision: string,
  note: string,
) {
  await locked(id, async (ctx) => {
    if (!["claim", "resolve"].includes(decision))
      throw new Error("demi_uat_handoff_decision_invalid");
    const { data, error } = await ctx.service
      .from("assistant_handoffs")
      .select("id")
      .eq("id", handoffId)
      .eq("studio_id", ctx.run.studio_id)
      .maybeSingle();
    if (error || !data) throw new Error("demi_uat_handoff_not_found");
    const before = await snapshot(ctx);
    const result =
      decision === "claim"
        ? await ctx.supabase.rpc("admin_claim_demi_handoff", {
            p_studio: ctx.run.studio_id,
            p_handoff: handoffId,
          })
        : await ctx.supabase.rpc("admin_resolve_demi_handoff", {
            p_studio: ctx.run.studio_id,
            p_handoff: handoffId,
            p_note: note,
          });
    await record(ctx, "human_control", {
      handoff_id: handoffId,
      decision,
      result: result.data,
      error: result.error?.message ?? null,
      before,
      after: await snapshot(ctx),
    });
    if (result.error || !result.data?.ok)
      throw new Error(
        result.error?.message ?? result.data?.reason_code ?? "demi_uat_handoff_failed",
      );
  });
  return getDemiUatRun(id);
}
