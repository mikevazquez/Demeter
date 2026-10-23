import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { workshopUuid, workshopPurchaseError } from "@/src/lib/workshops/admin";
import {
  downloadMetaWhatsAppMedia,
  type MetaDownloadedMedia,
  type MetaWhatsAppWebhookConfig,
} from "./meta-whatsapp-channel";
import { readTransferReceipt, rejectedTransferReceiptReply } from "./receipt-reader";

type Context = {
  supabase: SupabaseClient;
  studio: { id: string };
  conversationId: string;
  turnId: string;
  studentId: string | null;
  serviceMode?: boolean;
  currentUserMessage: string;
};

function workshopConversationError(message: string) {
  if (message.includes("workshop_demi_disabled"))
    return "Las altas de talleres por Demi no están habilitadas en este estudio. No solicites un pago ni prometas una inscripción.";
  if (/workshop_receipt_pending|another_receipt_pending/.test(message))
    return "Ya hay una solicitud de pago pendiente. Consulta get_workshop_options para recuperar el estado actual; no prepares otro pago ni pidas otra transferencia.";
  if (message.includes("workshop_confirmation_missing"))
    return "No hay una cotización vigente para aceptar. Consulta el estado y vuelve a cotizar las fechas antes de solicitar un pago.";
  return workshopPurchaseError(message);
}
export async function workshopPurchaseAction(
  ctx: Context,
  tool: string,
  args: Record<string, unknown>,
) {
  if (!ctx.serviceMode) return { ok: false, reason_code: "verified_student_required" };
  if (tool === "register_workshop_participant") {
    const offer = /^workshop:([0-9a-f-]{36})$/i.exec(String(args.workshop_ref ?? ""));
    const name = String(args.full_name ?? "")
      .trim()
      .replace(/\s+/g, " ");
    const normalize = (value: string) =>
      value
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .replace(/\s+/g, " ");
    if (!offer || !workshopUuid.test(offer[1]))
      return { ok: false, reason_code: "invalid_selection" };
    if (
      name.length > 160 ||
      !/\S+\s+\S+/.test(name) ||
      /[?¿]/.test(ctx.currentUserMessage) ||
      !normalize(ctx.currentUserMessage).includes(normalize(name))
    )
      return { ok: false, reason_code: "full_name_required" };
    const response = await ctx.supabase.rpc("service_register_demi_workshop_participant", {
      p_studio: ctx.studio.id,
      p_conversation: ctx.conversationId,
      p_offer: offer[1],
      p_turn: ctx.turnId,
      p_full_name: name,
    });
    if (response.error)
      return {
        ok: false,
        reason_code: "participant_registration_blocked",
        reason_message: /identity|profile_exists/.test(response.error.message)
          ? "Se requiere verificar la identidad antes de crear o vincular una ficha. No reveles datos de otra persona ni crees una ficha duplicada."
          : response.error.message.includes("guest_offer_unavailable")
            ? "Este taller no permite registrar una invitada sin inscripción vigente. Consulta sus requisitos antes de continuar."
            : workshopConversationError(response.error.message),
      };
    if (response.data?.ok !== true || !workshopUuid.test(String(response.data.student_id ?? "")))
      return {
        ok: false,
        reason_code: "participant_registration_unknown",
        reason_message:
          "No pude verificar el resultado del registro. Consulta la identidad actual antes de reintentar; no afirmes que ya existe una ficha o reserva.",
      };
    return {
      ...response.data,
      instruction:
        "La ficha de participante está vinculada; todavía no hay compra, pago ni reserva. Continúa con prepare_workshop_purchase para las fechas elegidas. No vendas una primera clase de prueba ni un paquete regular por este registro.",
    };
  }
  // The preceding tool may have linked the participant in this same model turn.
  // Preparation resolves identity in PostgreSQL; no student supplied by the model.
  if (!ctx.studentId && tool !== "prepare_workshop_purchase")
    return { ok: false, reason_code: "verified_student_required" };
  if (tool === "record_workshop_continuation") {
    const purchase = /^purchase:([0-9a-f-]{36})$/i.exec(String(args.purchase_ref ?? ""));
    if (
      !purchase ||
      !workshopUuid.test(purchase[1]) ||
      !["continue", "withdraw"].includes(String(args.decision))
    )
      return { ok: false, reason_code: "invalid_continuation" };
    const response = await ctx.supabase.rpc("service_record_workshop_continuation", {
      p_studio: ctx.studio.id,
      p_conversation: ctx.conversationId,
      p_purchase: purchase[1],
      p_turn: ctx.turnId,
      p_decision: args.decision,
    });
    return response.error
      ? {
          ok: false,
          reason_code: "continuation_blocked",
          reason_message:
            "No pude verificar la decisión sobre este taller. Necesito una respuesta explícita y revisar el historial antes de reintentar.",
        }
      : { ok: true, ...response.data };
  }
  if (tool === "prepare_workshop_purchase") {
    const offer = /^workshop:([0-9a-f-]{36})$/i.exec(String(args.workshop_ref ?? ""));
    const sessions = Array.isArray(args.session_refs)
      ? args.session_refs.map((ref) => /^session:([0-9a-f-]{36})$/i.exec(String(ref))?.[1])
      : [];
    if (
      !offer ||
      !workshopUuid.test(offer[1]) ||
      !sessions.length ||
      sessions.length > 100 ||
      sessions.some((id) => !id || !workshopUuid.test(id)) ||
      new Set(sessions).size !== sessions.length ||
      !["full", "sessions"].includes(String(args.purchase_mode))
    )
      return { ok: false, reason_code: "invalid_selection" };
    const response = await ctx.supabase.rpc("service_prepare_demi_workshop_purchase", {
      p_studio: ctx.studio.id,
      p_conversation: ctx.conversationId,
      p_offer: offer[1],
      p_sessions: sessions,
      p_mode: args.purchase_mode,
      p_turn: ctx.turnId,
    });
    if (response.error)
      return {
        ok: false,
        reason_code: "workshop_prepare_blocked",
        reason_message: workshopConversationError(response.error.message),
      };
    return response.data;
  }
  if (/[?¿]/.test(ctx.currentUserMessage))
    return { ok: false, reason_code: "explicit_confirmation_required" };
  const text = ctx.currentUserMessage
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
  if (
    !new Set([
      "si",
      "si por favor",
      "si confirmo",
      "confirmo",
      "confirmado",
      "confirmo la compra",
      "si confirmo la compra",
      "acepto",
      "acepto las condiciones",
      "si acepto",
      "de acuerdo",
      "adelante",
      "hazlo",
      "dale",
      "va",
      "ok",
      "okay",
      "correcto",
    ]).has(text)
  )
    return { ok: false, reason_code: "explicit_confirmation_required" };
  const response = await ctx.supabase.rpc("service_accept_demi_workshop_purchase", {
    p_studio: ctx.studio.id,
    p_conversation: ctx.conversationId,
    p_turn: ctx.turnId,
  });
  if (response.error)
    return {
      ok: false,
      reason_code: "workshop_confirmation_blocked",
      reason_message: workshopConversationError(response.error.message),
    };
  return response.data;
}

export function workshopPaymentInstructions(result: Record<string, unknown>) {
  const bank = result.bank_details as Record<string, unknown> | null;
  if (result.ok !== true || result.status !== "receipt_required" || !bank)
    return "No pude confirmar las instrucciones del taller. Revisa la selección antes de pagar; todavía no hay una reserva.";
  const amount = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    Number(result.amount_minor) / 100,
  );
  const lines = [
    ["Banco", bank.bank_name],
    ["Titular", bank.account_holder],
    ["CLABE", bank.clabe],
    ["Cuenta", bank.account_number],
  ]
    .filter(([, value]) => typeof value === "string" && value)
    .map(([label, value]) => `${label}: ${value}`);
  if (typeof bank.instructions === "string" && bank.instructions) lines.push(bank.instructions);
  return `Aceptaste las condiciones. Para continuar, transfiere ${amount} con estos datos:\n\n${lines.join("\n")}\n\nEnvía el comprobante por este chat. Aún no hay un lugar retenido. Al recibirlo comprobaré el cupo y crearé un apartado provisional sujeto a validación del equipo; el documento no acredita dinero recibido.`;
}

export async function handleDemiWorkshopReceipt(input: {
  supabase: SupabaseClient;
  studioId: string;
  conversationId: string;
  eventId: string;
  providerMessageId: string;
  mediaId: string | null;
  messageType: string;
  webhookConfig?: MetaWhatsAppWebhookConfig;
  downloadedMedia?: MetaDownloadedMedia;
}) {
  if (!input.mediaId || !["image", "document"].includes(input.messageType))
    return { handled: false as const };
  const previous = await input.supabase
    .from("demi_workshop_receipts")
    .select("intent_id")
    .eq("studio_id", input.studioId)
    .eq("event_id", input.eventId)
    .maybeSingle();
  if (previous.error) throw new Error("workshop_receipt_lookup_failed");
  const query = input.supabase
    .from("demi_workshop_purchase_intents")
    .select("id")
    .eq("studio_id", input.studioId)
    .eq("conversation_id", input.conversationId);
  const pending = previous.data
    ? await query.eq("id", previous.data.intent_id).maybeSingle()
    : await query
        .eq("status", "receipt_required")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
  if (pending.error) throw new Error("workshop_intent_lookup_failed");
  if (!pending.data) return { handled: false as const };
  const media =
    input.downloadedMedia ??
    (input.webhookConfig
      ? await downloadMetaWhatsAppMedia({ config: input.webhookConfig, mediaId: input.mediaId })
      : null);
  if (!media) throw new Error("workshop_receipt_media_unavailable");
  const hash = createHash("sha256").update(media.bytes).digest("hex"),
    path = `${input.studioId}/workshop/${pending.data.id}/${hash}`;
  const stored = await input.supabase.storage
    .from("transfer-receipts")
    .upload(path, media.bytes, { contentType: media.mimeType, upsert: false });
  if (stored.error && !/already exists|duplicate/i.test(stored.error.message))
    throw new Error("workshop_receipt_storage_failed");
  let reading: Awaited<ReturnType<typeof readTransferReceipt>> | null = null;
  try {
    reading = await readTransferReceipt({ bytes: media.bytes, mimeType: media.mimeType });
  } catch {
    /* An unreadable receipt never reserves capacity. */
  }
  const rejected = rejectedTransferReceiptReply(reading);
  if (rejected)
    return {
      handled: true as const,
      reply: rejected,
      result: { ok: false, reason_code: "receipt_not_payment_evidence" },
    };
  const recorded = await input.supabase.rpc("service_record_demi_workshop_receipt", {
    p_studio: input.studioId,
    p_conversation: input.conversationId,
    p_intent: pending.data.id,
    p_event: input.eventId,
    p_provider: input.providerMessageId,
    p_path: path,
    p_hash: hash,
    p_amount: reading?.amountMinor ?? null,
    p_currency: reading?.currency ?? null,
    p_confidence: reading?.confidence ?? 0,
  });
  if (recorded.error)
    return {
      handled: true as const,
      reply:
        "No pude verificar el resultado del apartado. El comprobante no acredita un ingreso confirmado. El equipo debe consultar el estado del taller antes de reintentar; no envíes otro pago.",
      result: { ok: false, reason_code: "workshop_receipt_blocked" },
    };
  const result = recorded.data;
  if (result?.ok !== true || !workshopUuid.test(String(result.hold_id ?? "")))
    throw new Error("workshop_receipt_result_unknown");
  return {
    handled: true as const,
    result,
    reply: result.replayed
      ? "Ese comprobante ya quedó registrado para el taller. No creé otro apartado ni registré otro pago; la validación corresponde al equipo."
      : "Recibí tu comprobante y aparté provisionalmente las fechas elegidas. El pago sigue sin verificar y tu inscripción todavía no está confirmada. El equipo revisará el ingreso; te avisaremos por este chat si lo aprueba, rechaza o vence el apartado.",
  };
}
