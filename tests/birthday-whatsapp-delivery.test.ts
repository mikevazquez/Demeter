import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { birthdayMessage } from "../supabase/functions/_shared/birthday-notification";
import {
  buildAsistianVariables,
  normalizeAsistianPhone,
} from "../supabase/functions/_shared/notification-asistian-variables";
import { isMetaWhatsAppTemplateKey } from "../lib/notifications/meta-template-catalog";

// Execute the real worker functions offline, replacing only its external imports.
const source = readFileSync(
  process.env.BIRTHDAY_DELIVERY_SOURCE ??
    "supabase/functions/notification-delivery-worker/index.ts",
  "utf8",
).replace(/^import[\s\S]*?;\n/gm, "");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function worker() {
  const send = vi.fn().mockResolvedValue({
    status: "accepted",
    providerReference: "wamid.test",
    providerMessageId: "wamid.test",
    httpStatus: 200,
    responseSnapshot: {},
  });
  const runtimeModule = {
    exports: {} as {
      processDelivery: (
        client: unknown,
        claim: unknown,
        workerId: string,
      ) => Promise<{ ok: boolean; outcome?: string }>;
    },
  };
  runInNewContext(compiled + "\nmodule.exports.processDelivery = processDelivery;", {
    module: runtimeModule,
    exports: runtimeModule.exports,
    withSupabase: () => null,
    URL,
    Deno: { env: { get: () => "https://example.supabase.co" } },
    birthdayMessage,
    buildAsistianVariables,
    normalizeAsistianPhone,
    isMetaWhatsAppTemplateKey,
    sendMetaWhatsAppTemplate: send,
  });
  return { process: runtimeModule.exports.processDelivery, send };
}
function client(eligible: boolean | "error", allowed = true) {
  const delivery = {
    id: "delivery-a",
    studio_id: "studio-a",
    job_id: "job-a",
    notification_id: "notification-a",
    channel_key: "whatsapp",
    adapter_key: "meta_whatsapp",
    provider_key: "meta_whatsapp",
    adapter_enabled: true,
    recipient_type: "student",
    recipient_entity_id: "student-a",
    recipient_snapshot: { phone: "+525555555555" },
    template_key: "birthday",
    template_variables: {
      recipient_name: "Camila Torres",
      studio_name: "Demeter",
      birthday_on: "2026-10-20",
    },
    channel_policy: {},
    message_snapshot: {},
  };
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: delivery }),
  };
  const rpc = vi.fn(async (name: string) => {
    if (name === "service_resolve_whatsapp_provider") return { data: "meta_whatsapp" };
    if (name === "system_start_notification_delivery_attempt") return { data: "attempt-a" };
    if (name === "system_birthday_notification_eligible")
      return eligible === "error" ? { error: { message: "offline" } } : { data: eligible };
    if (name === "service_notification_channel_allowed") return { data: allowed };
    return { data: true };
  });
  return { rpc, from: () => query };
}
const claim = { delivery_id: "delivery-a", channel_key: "whatsapp" };
describe("Birthday delivery worker", () => {
  it("skips yesterday or ineligible students before invoking any provider", async () => {
    const runtime = worker();
    const db = client(false);
    expect(await runtime.process(db, claim, "worker")).toMatchObject({
      ok: true,
      outcome: "skipped",
    });
    expect(db.rpc).toHaveBeenCalledWith("system_birthday_notification_eligible", {
      p_studio_id: "studio-a",
      p_student_id: "student-a",
      p_birthday_on: "2026-10-20",
    });
    expect(db.rpc).toHaveBeenCalledWith(
      "system_mark_notification_delivery_attempt_skipped",
      expect.objectContaining({ p_reason_code: "birthday_no_longer_due" }),
    );
    expect(runtime.send).not.toHaveBeenCalled();
  });
  it("fails closed if eligibility cannot be verified", async () => {
    const runtime = worker();
    const db = client("error");
    expect(await runtime.process(db, claim, "worker")).toMatchObject({ ok: false });
    expect(runtime.send).not.toHaveBeenCalled();
  });
  it("preserves recipient opt-out even when the birthday is due", async () => {
    const runtime = worker();
    const db = client(true, false);
    expect(await runtime.process(db, claim, "worker")).toMatchObject({
      ok: true,
      outcome: "skipped",
    });
    expect(db.rpc).toHaveBeenCalledWith(
      "system_mark_notification_delivery_attempt_skipped",
      expect.objectContaining({ p_reason_code: "recipient_channel_disabled" }),
    );
    expect(runtime.send).not.toHaveBeenCalled();
  });
  it("renders the birthday greeting and hands off once to the existing Meta adapter", async () => {
    const runtime = worker();
    const db = client(true);
    expect(await runtime.process(db, claim, "worker")).toEqual({
      ok: true,
      deliveryId: "delivery-a",
      channel: "whatsapp",
      outcome: "accepted",
    });
    expect(runtime.send).toHaveBeenCalledOnce();
    expect(runtime.send).toHaveBeenCalledWith(
      expect.objectContaining({
        studioId: "studio-a",
        template: "birthday",
        eventId: "delivery-a",
        recipient: "+525555555555",
      }),
    );
    expect(db.rpc).toHaveBeenCalledWith(
      "system_set_notification_delivery_message_snapshot",
      expect.objectContaining({
        p_message_snapshot: expect.objectContaining({
          body: birthdayMessage("Camila Torres", "Demeter"),
          provider_template_key: "birthday",
        }),
      }),
    );
  });
});
