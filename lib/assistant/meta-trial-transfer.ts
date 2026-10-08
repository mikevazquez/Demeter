import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nameFromExplicitReply } from "./meta-prospect-name";
import { readTransferReceipt } from "./receipt-reader";
import {
  downloadMetaInboxAttachment,
  type MetaInboxInboundMessage,
} from "./meta-inbox-channel";

type JsonObject = Record<string, unknown>;
type Reply = { reply: string; outcome: string };
type HistoryTurn = { role: "assistant" | "user"; content: string };

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function affirmative(value: string) {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  return /^(?:si|claro|ok|va|dale|adelante|por favor|mandame(?:los)?|enviame(?:los)?)(?:$|[,.!?\s])/i.test(normalized);
}

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currency || "MXN",
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

async function updateStage(
  supabase: SupabaseClient,
  studioId: string,
  pendingId: string,
  payload: JsonObject,
) {
  const { error } = await supabase.from("assistant_pending_actions")
    .update({
      action_payload: payload,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pendingId)
    .eq("studio_id", studioId)
    .eq("status", "pending");
  if (error) throw new Error("meta_trial_stage_update_failed");
}

async function createReviewHandoff(
  supabase: SupabaseClient,
  studioId: string,
  conversationId: string,
  studentId: string | null,
  note: string,
) {
  const { error } = await supabase.rpc("assistant_create_handoff", {
    target_studio_id: studioId,
    target_conversation_id: conversationId,
    target_student_id: studentId,
    target_reason_code: "receipt_validation_failed",
    target_note: note,
  });
  if (error) throw new Error("meta_trial_review_handoff_failed");
}

export async function continueMetaTrialTransfer(input: {
  supabase: SupabaseClient;
  studioId: string;
  conversationId: string;
  crmContactId: string | null;
  studentId: string | null;
  provider: "instagram" | "facebook_messenger";
  providerAccountId: string;
  providerContactId: string;
  eventId: string;
  message: MetaInboxInboundMessage;
  history: HistoryTurn[];
}): Promise<Reply | null> {
  const { data: pending, error: pendingError } = await input.supabase
    .from("assistant_pending_actions")
    .select("id,action_payload,status,expires_at")
    .eq("studio_id", input.studioId)
    .eq("conversation_id", input.conversationId)
    .eq("action_type", "booking.create")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingError) throw new Error("meta_trial_pending_lookup_failed");
  if (!pending) return null;
  const payload = object(pending.action_payload);
  const stage = String(payload.stage ?? "");
  if (!stage.startsWith("meta_")) return null;

  if (new Date(pending.expires_at).getTime() <= Date.now()) {
    await input.supabase.from("assistant_pending_actions")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", pending.id).eq("studio_id", input.studioId);
    return {
      reply: "La solicitud anterior venció. Dime qué clase y horario prefieres para revisar la disponibilidad actual.",
      outcome: "meta_trial_expired",
    };
  }

  if (stage === "meta_offer_transfer") {
    if (input.message.messageType !== "text" && input.message.messageType !== "postback") {
      return { reply: "Antes de enviar un comprobante, dime si quieres que te comparta los datos para transferir.", outcome: "meta_trial_offer_waiting" };
    }
    if (!affirmative(input.message.text)) {
      if (/\b(?:no|despu[eé]s|ahorita no)\b/i.test(input.message.text)) {
        await input.supabase.from("assistant_pending_actions")
          .update({ status: "cancelled", updated_at: new Date().toISOString() })
          .eq("id", pending.id).eq("studio_id", input.studioId);
        return { reply: "Claro, cuando quieras retomamos tu primera clase.", outcome: "meta_trial_offer_declined" };
      }
      return null;
    }

    const { data: bank, error: bankError } = await input.supabase
      .from("studio_bank_transfer_settings")
      .select("enabled,bank_name,account_holder,clabe,account_number,card_number,instructions")
      .eq("studio_id", input.studioId)
      .maybeSingle();
    if (bankError || bank?.enabled !== true || !bank.bank_name || !bank.account_holder ||
      ![bank.clabe, bank.account_number, bank.card_number].some((value) => String(value ?? "").trim())) {
      return { reply: "Por ahora no tengo disponibles los datos de transferencia. No he creado ninguna reserva.", outcome: "meta_trial_bank_unavailable" };
    }
    await updateStage(input.supabase, input.studioId, pending.id, {
      ...payload, stage: "meta_awaiting_receipt",
    });
    const lines = [
      "Estos son los datos para transferir " + money(Number(payload.amount_minor), String(payload.currency ?? "MXN")) + ":",
      "Banco: " + bank.bank_name,
      "Titular: " + bank.account_holder,
      bank.clabe ? "CLABE: " + bank.clabe : null,
      bank.account_number ? "Cuenta: " + bank.account_number : null,
      bank.card_number ? "Tarjeta: " + bank.card_number : null,
      bank.instructions ? String(bank.instructions) : null,
      "Cuando hagas la transferencia, envíame el comprobante aquí. Después te pediré tu nombre y celular de 10 dígitos. El lugar aún no está reservado.",
    ].filter(Boolean);
    return { reply: lines.join("\n"), outcome: "meta_trial_bank_details_sent" };
  }

  if (stage === "meta_awaiting_receipt") {
    if (input.message.messageType !== "attachment") {
      if (/\b(?:transfer[ií]|pagu[eé]|comprobante|dep[oó]sito|ya pagu[eé])\b/i.test(input.message.text)) {
        return { reply: "Envíame una imagen o PDF del comprobante por este chat. Todavía no tengo una reserva confirmada.", outcome: "meta_trial_receipt_waiting" };
      }
      return null;
    }
    if (!input.message.attachmentUrl) {
      return { reply: "Recibí el archivo, pero Meta no permitió descargarlo. ¿Puedes enviarlo otra vez como imagen o PDF?", outcome: "meta_trial_attachment_unavailable" };
    }

    let media: Awaited<ReturnType<typeof downloadMetaInboxAttachment>>;
    try {
      media = await downloadMetaInboxAttachment(input.message.attachmentUrl);
    } catch {
      return { reply: "No pude descargar ese comprobante de forma segura. Envíamelo otra vez como imagen o PDF, por favor.", outcome: "meta_trial_attachment_download_failed" };
    }

    const extension = media.mimeType === "application/pdf" ? "pdf"
      : media.mimeType === "image/png" ? "png"
        : media.mimeType === "image/webp" ? "webp" : "jpg";
    const storagePath = input.studioId + "/" + (input.crmContactId ?? "prospect") +
      "/meta-" + pending.id + "/" + createHash("sha256").update(input.eventId).digest("hex").slice(0, 16) + "." + extension;
    const { error: uploadError } = await input.supabase.storage.from("transfer-receipts")
      .upload(storagePath, media.bytes, {
        contentType: media.mimeType,
        upsert: false,
        cacheControl: "3600",
      });
    if (uploadError) throw new Error("meta_trial_receipt_storage_failed");

    let reading: Awaited<ReturnType<typeof readTransferReceipt>> | null = null;
    try {
      reading = await readTransferReceipt({ bytes: media.bytes, mimeType: media.mimeType });
    } catch {
      reading = null;
    }
    const expected = Number(payload.amount_minor);
    const currency = String(payload.currency ?? "MXN");
    const matches = reading?.amountMinor === expected &&
      reading.confidence >= 0.75 &&
      (!reading.currency || reading.currency === currency);

    await updateStage(input.supabase, input.studioId, pending.id, {
      ...payload,
      stage: "meta_awaiting_name",
      receipt_event_id: input.eventId,
      receipt_provider_message_id: input.message.providerMessageId,
      receipt_media_id: input.message.providerMessageId,
      receipt_storage_path: storagePath,
      receipt_mime_type: media.mimeType,
      receipt_file_size: media.fileSize,
      receipt_amount_minor: reading?.amountMinor ?? null,
      receipt_currency: reading?.currency ?? null,
      receipt_date: reading?.date ?? null,
      receipt_reference: reading?.reference ?? null,
      receipt_bank: reading?.bank ?? null,
      receipt_confidence: reading?.confidence ?? null,
      receipt_amount_matches: matches,
    });
    return {
      reply: matches
        ? "Ya recibí tu comprobante. Para registrar la solicitud, ¿me compartes tu nombre completo y tu celular de 10 dígitos en un solo mensaje?"
        : "Recibí tu comprobante. El monto todavía necesita revisión; no he reservado el lugar. Para registrar tu solicitud, ¿me compartes tu nombre completo?",
      outcome: matches ? "meta_trial_receipt_collected" : "meta_trial_receipt_needs_review",
    };
  }

  if (stage === "meta_awaiting_name") {
    const name = nameFromExplicitReply(input.history);
    if (!name) return { reply: "¿Me compartes tu nombre completo, por favor?", outcome: "meta_trial_name_waiting" };
    const { data: identity, error: identityError } = await input.supabase
      .from("assistant_channel_identities")
      .select("id,person_id,student_id,metadata")
      .eq("studio_id", input.studioId)
      .eq("provider", input.provider)
      .eq("provider_account_id", input.providerAccountId)
      .eq("provider_contact_id", input.providerContactId)
      .eq("crm_contact_id", input.crmContactId)
      .maybeSingle();
    if (identityError || !identity?.person_id || identity.student_id) {
      return { reply: "No pude registrar tus datos de forma segura. Tu comprobante quedó recibido, pero no se creó una reserva.", outcome: "meta_trial_identity_unavailable" };
    }
    const parts = name.split(" ");
    const { error: nameError } = await input.supabase.from("persons")
      .update({ first_name: parts[0], last_name: parts.slice(1).join(" ") })
      .eq("studio_id", input.studioId).eq("id", identity.person_id);
    if (nameError) throw new Error("meta_trial_name_save_failed");
    const { error: metadataError } = await input.supabase.from("assistant_channel_identities")
      .update({
        display_name: name,
        metadata: { ...object(identity.metadata), name_confirmed: true },
      }).eq("id", identity.id).eq("studio_id", input.studioId).is("student_id", null);
    if (metadataError) throw new Error("meta_trial_identity_update_failed");
    await updateStage(input.supabase, input.studioId, pending.id, {
      ...payload, stage: "meta_awaiting_phone",
    });
    return { reply: "Gracias. Ahora compárteme tu número de celular de 10 dígitos.", outcome: "meta_trial_phone_requested" };
  }

  if (stage === "meta_awaiting_phone") {
    const supplied = input.message.text.trim();
    const digits = supplied.replace(/[\s()-]/g, "");
    if (!/^[0-9]{10}$/.test(digits)) {
      return { reply: "Compárteme tu número de celular de 10 dígitos, por favor.", outcome: "meta_trial_phone_waiting" };
    }
    const normalized = "+52" + digits;
    const { data: identity, error: identityError } = await input.supabase
      .from("assistant_channel_identities")
      .select("person_id,student_id")
      .eq("studio_id", input.studioId)
      .eq("provider", input.provider)
      .eq("provider_account_id", input.providerAccountId)
      .eq("provider_contact_id", input.providerContactId)
      .eq("crm_contact_id", input.crmContactId)
      .maybeSingle();
    if (identityError || !identity?.person_id || identity.student_id || !input.crmContactId) {
      return { reply: "No pude verificar la ficha de tu solicitud. Tu comprobante sigue pendiente de revisión; no reservé el lugar.", outcome: "meta_trial_phone_identity_blocked" };
    }
    const { data: collision, error: collisionError } = await input.supabase
      .from("person_contacts")
      .select("id")
      .eq("studio_id", input.studioId)
      .eq("kind", "phone")
      .eq("value", normalized)
      .neq("person_id", identity.person_id)
      .limit(1);
    const { data: studentCollision, error: studentCollisionError } = await input.supabase
      .from("students")
      .select("id")
      .eq("studio_id", input.studioId)
      .eq("phone", normalized)
      .neq("person_id", identity.person_id)
      .limit(1);
    if (collisionError || studentCollisionError) throw new Error("meta_trial_phone_collision_lookup_failed");
    if ((collision ?? []).length || (studentCollision ?? []).length) {
      await createReviewHandoff(input.supabase, input.studioId, input.conversationId, null,
        "El celular aportado en Messenger/Instagram coincide con otra ficha. Revisar identidad sin vincular automáticamente.");
      return { reply: "Ese celular ya aparece en otra ficha. Para proteger tus datos, la solicitud necesita revisión; no se creó ninguna reserva.", outcome: "meta_trial_phone_collision" };
    }

    const { data: existing, error: existingError } = await input.supabase
      .from("person_contacts")
      .select("id,value")
      .eq("studio_id", input.studioId)
      .eq("person_id", identity.person_id)
      .eq("kind", "phone")
      .limit(1).maybeSingle();
    if (existingError) throw new Error("meta_trial_phone_lookup_failed");
    if (existing && existing.value !== normalized) {
      return { reply: "La ficha ya tiene otro celular. Por seguridad no lo cambiaré automáticamente; tu comprobante queda para revisión.", outcome: "meta_trial_phone_conflict" };
    }
    if (!existing) {
      const { error: phoneError } = await input.supabase.from("person_contacts").insert({
        studio_id: input.studioId,
        person_id: identity.person_id,
        kind: "phone",
        value: normalized,
        is_primary: true,
      });
      if (phoneError) throw new Error("meta_trial_phone_save_failed");
    }

    const { data: studentData, error: studentError } = await input.supabase.rpc(
      "assistant_ensure_trial_student", {
        target_studio_id: input.studioId,
        target_crm_contact_id: input.crmContactId,
      });
    const student = object(studentData);
    const newStudentId = String(student.student_id ?? "");
    if (studentError || student.ok !== true || !newStudentId) {
      return { reply: "Recibí tus datos y comprobante, pero todavía no pude completar tu ficha. No se creó una reserva.", outcome: "meta_trial_student_create_failed" };
    }

    const { error: conversationError } = await input.supabase.from("assistant_conversations")
      .update({ student_id: newStudentId, updated_at: new Date().toISOString() })
      .eq("studio_id", input.studioId).eq("id", input.conversationId);
    if (conversationError) throw new Error("meta_trial_conversation_link_failed");

    const { data: intentData, error: intentError } = await input.supabase.rpc(
      "service_prepare_trial_transfer", {
        target_studio_id: input.studioId,
        target_conversation_id: input.conversationId,
        target_student_id: newStudentId,
        target_session_id: String(payload.session_id),
        target_resource_id: null,
      });
    const intent = object(intentData);
    const intentId = String(intent.intent_id ?? "");
    if (intentError || intent.ok !== true || !intentId) {
      await createReviewHandoff(input.supabase, input.studioId, input.conversationId, newStudentId,
        "Comprobante Meta recibido antes del registro. La clase dejó de estar disponible o no pudo prepararse la transferencia. Revisar pago y ofrecer solución.");
      return { reply: "Ya registré tus datos y recibí el comprobante, pero no pude asegurar ese horario. Revisaremos el pago y la disponibilidad; todavía no hay reserva.", outcome: "meta_trial_intent_failed" };
    }

    const { error: receiptError } = await input.supabase.from("assistant_transfer_purchase_intents")
      .update({
        receipt_storage_path: payload.receipt_storage_path,
        receipt_mime_type: payload.receipt_mime_type,
        receipt_file_size: payload.receipt_file_size,
        receipt_stored_at: new Date().toISOString(),
        receipt_received_at: new Date().toISOString(),
        receipt_provider_message_id: payload.receipt_provider_message_id,
        receipt_media_id: payload.receipt_media_id,
        receipt_detected_amount_minor: payload.receipt_amount_minor,
        receipt_detected_currency: payload.receipt_currency,
        receipt_detected_date: payload.receipt_date,
        receipt_detected_reference: payload.receipt_reference,
        receipt_detected_bank: payload.receipt_bank,
        receipt_read_confidence: payload.receipt_confidence,
        receipt_amount_matches: payload.receipt_amount_matches === true,
        receipt_read_at: new Date().toISOString(),
        review_note: "Meta inbox event: " + String(payload.receipt_event_id ?? "") +
          ". Comprobante en revisión; no se ha confirmado ni cobrado la reserva.",
        updated_at: new Date().toISOString(),
      })
      .eq("studio_id", input.studioId).eq("id", intentId).eq("student_id", newStudentId);
    if (receiptError) throw new Error("meta_trial_receipt_link_failed");

    await createReviewHandoff(input.supabase, input.studioId, input.conversationId, newStudentId,
      "Primera clase: comprobante recibido por " + input.provider +
      ", importe " + (payload.receipt_amount_matches === true ? "coincidente" : "por revisar") +
      ". Solicitud de transferencia " + intentId +
      ". Validar ingreso bancario antes de confirmar reserva; el comprobante está en almacenamiento privado.");
    const { error: completedError } = await input.supabase.from("assistant_pending_actions")
      .update({
        status: "executed",
        executed_at: new Date().toISOString(),
        execution_ref: "meta-trial-review:" + intentId,
        action_payload: { ...payload, stage: "meta_receipt_under_review", student_id: newStudentId },
        updated_at: new Date().toISOString(),
      })
      .eq("id", pending.id).eq("studio_id", input.studioId).eq("status", "pending");
    if (completedError) throw new Error("meta_trial_completion_failed");

    return {
      reply: "Gracias. Ya registré tu nombre, celular y comprobante. El pago quedó para validación y tu lugar aún no está confirmado. Te avisaremos por este chat cuando se revise.",
      outcome: "meta_trial_registered_for_payment_review",
    };
  }
  return null;
}
