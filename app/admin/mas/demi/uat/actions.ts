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
import type {
  MetaDownloadedMedia,
  MetaWhatsAppWebhookConfig,
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
  return Object.fromEntries(entries);
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
  const { data: artifacts, error } = await ctx.service
    .from("demi_uat_artifacts")
    .select("id,kind,payload,created_at")
    .eq("run_id", id)
    .order("created_at", { ascending: false })
    .limit(150);
  if (error) throw new Error("demi_uat_evidence_unavailable");
  return { run: ctx.run, state: await snapshot(ctx), artifacts: artifacts ?? [] };
}
export async function sendDemiUatMessage(form: FormData) {
  const id = String(form.get("runId") ?? "");
  await locked(id, async (ctx) => {
    const channel = String(form.get("channel") ?? "whatsapp");
    if (!["whatsapp", "facebook_messenger", "instagram"].includes(channel))
      throw new Error("demi_uat_channel_invalid");
    const isInbox = channel !== "whatsapp";
    const attachmentScenario = String(form.get("attachmentScenario") ?? "");
    if (attachmentScenario && (!isInbox || !["video", "unsupported"].includes(attachmentScenario)))
      throw new Error("demi_uat_attachment_scenario_invalid");
    const key = String(form.get("persona") ?? "");
    const person = ctx.run.fixtures.people[key];
    if (!person) throw new Error("demi_uat_persona_invalid");
    const text = String(form.get("text") ?? "").trim();
    if (text.length > 4000) throw new Error("demi_uat_message_too_long");
    const file = form.get("file");
    const media = new Map<string, MetaDownloadedMedia>();
    const mediaId = String(Date.now());
    const hasFile = file instanceof File && file.size > 0;
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
    if (!text && !hasFile && !attachmentScenario) throw new Error("demi_uat_message_required");
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
    const type = hasFile
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
      type,
      ...(hasFile
        ? {
            [type]: {
              id: mediaId,
              caption: text || "Comprobante ficticio UAT",
              mime_type: file.type,
              filename: file.name,
            },
          }
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
                              : attachmentScenario ||
                                (file.type.startsWith("audio/")
                                  ? "audio"
                                  : file.type === "application/pdf"
                                    ? "file"
                                    : "image"),
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
      provider_id: providerId,
      text,
      file: hasFile ? { name: file.name, size: file.size, type: file.type } : null,
      state: await snapshot(ctx),
    });
    const response = await withDemiUatScope(
      {
        runId: id,
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
      http_status: response.status,
      result: await response.json(),
      state: await snapshot(ctx),
    });
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
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify({
          studio_id: ctx.run.studio_id,
          as_of: new Date(Date.now() + days * 86400000).toISOString(),
        }),
      },
    );
    const result = await response.json();
    await record(ctx, "followup_worker", { days, result, before, after: await snapshot(ctx) });
    if (!response.ok) throw new Error("demi_uat_followup_worker_failed");
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
