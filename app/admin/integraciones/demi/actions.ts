"use server";

import { createHash, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { runAssistantTurn } from "@/lib/assistant/orchestrator";
import { createServiceClient } from "@/lib/supabase/service";

type SendDemiInput = {
  conversationId?: string | null;
  studentId?: string | null;
  crmContactId?: string | null;
  message: string;
};

function errorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "assistant_failed";
  const safeCodes = new Set([
    "openai_not_configured",
    "assistant_budget_exceeded",
    "openai_network_error",
    "openai_request_failed",
    "assistant_empty_response",
    "assistant_parallel_tool_call_blocked",
    "assistant_tool_limit_exceeded",
    "assistant_model_call_limit_exceeded",
  ]);
  return safeCodes.has(code) ? code : "assistant_failed";
}

export async function sendDemiMessage(input: SendDemiInput) {
  const message = String(input.message ?? "").trim();
  if (!message || message.length > 2_000) {
    return { ok: false as const, error: "invalid_message" };
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const { data: config, error: configError } = await supabase
    .from("assistant_configs")
    .select(
      "assistant_name,mode,model,reasoning_effort,personality_instructions,monthly_budget_usd_micros,conversation_budget_usd_micros,max_model_calls_per_turn,max_tool_calls_per_turn",
    )
    .eq("studio_id", studio.id)
    .maybeSingle();

  if (configError || !config) {
    return { ok: false as const, error: "assistant_not_configured" };
  }
  if (config.mode !== "demo") {
    return { ok: false as const, error: "assistant_demo_disabled" };
  }

  const requestedStudentId = String(input.studentId ?? "").trim() || null;
  const requestedCrmContactId = String(input.crmContactId ?? "").trim() || null;
  if (requestedStudentId && requestedCrmContactId) {
    return { ok: false as const, error: "invalid_demo_identity" };
  }

  let conversationId = String(input.conversationId ?? "").trim();
  let conversationStudentId: string | null = null;
  let conversationCrmContactId: string | null = null;

  if (conversationId) {
    const { data: existing } = await supabase
      .from("assistant_conversations")
      .select("id,student_id,context")
      .eq("id", conversationId)
      .eq("studio_id", studio.id)
      .eq("channel", "internal_demo")
      .eq("status", "open")
      .maybeSingle();

    if (!existing) return { ok: false as const, error: "conversation_not_found" };

    conversationStudentId = existing.student_id ?? null;
    const existingContext =
      existing.context && typeof existing.context === "object" && !Array.isArray(existing.context)
        ? (existing.context as Record<string, unknown>)
        : {};
    conversationCrmContactId = String(existingContext.demo_crm_contact_id ?? "").trim() || null;

    if (conversationCrmContactId) {
      if (requestedCrmContactId !== conversationCrmContactId) {
        return { ok: false as const, error: "conversation_identity_mismatch" };
      }
    } else if (requestedStudentId !== conversationStudentId) {
      return { ok: false as const, error: "conversation_identity_mismatch" };
    }
  } else {
    if (requestedStudentId) {
      const { data: student, error: studentError } = await supabase
        .from("students")
        .select("id")
        .eq("id", requestedStudentId)
        .eq("studio_id", studio.id)
        .eq("active", true)
        .maybeSingle();

      if (studentError || !student) {
        return { ok: false as const, error: "invalid_demo_identity" };
      }
    }

    if (requestedCrmContactId) {
      const { data: contact, error: contactError } = await supabase
        .from("crm_contacts")
        .select("id,converted_student_id")
        .eq("id", requestedCrmContactId)
        .eq("studio_id", studio.id)
        .maybeSingle();

      if (contactError || !contact || contact.converted_student_id) {
        return { ok: false as const, error: "invalid_demo_identity" };
      }
    }

    const { data: created, error: createError } = await supabase
      .from("assistant_conversations")
      .insert({
        studio_id: studio.id,
        channel: "internal_demo",
        student_id: requestedStudentId,
        context: requestedCrmContactId ? { demo_crm_contact_id: requestedCrmContactId } : {},
        status: "open",
      })
      .select("id,student_id,context")
      .single();

    if (createError || !created) {
      return { ok: false as const, error: "conversation_create_failed" };
    }
    conversationId = created.id;
    conversationStudentId = created.student_id ?? null;
    conversationCrmContactId = requestedCrmContactId;
  }

  const { data: inboundTurn, error: turnError } = await supabase
    .from("assistant_turns")
    .insert({
      studio_id: studio.id,
      conversation_id: conversationId,
      direction: "inbound",
      role: "user",
      content: message,
      sanitized: true,
    })
    .select("id")
    .single();

  if (turnError || !inboundTurn) {
    return { ok: false as const, error: "turn_create_failed" };
  }

  const { data: recentTurns, error: historyError } = await supabase
    .from("assistant_turns")
    .select("role,content,created_at")
    .eq("studio_id", studio.id)
    .eq("conversation_id", conversationId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(12);

  if (historyError) {
    return { ok: false as const, error: "conversation_history_failed" };
  }

  const history = (recentTurns ?? [])
    .slice()
    .reverse()
    .map((item) => ({
      role: item.role as "user" | "assistant",
      content: item.content,
    }));

  try {
    const requestHeaders = await headers();
    const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwardedHost || requestHeaders.get("host")?.trim();
    const activationUrl = host
      ? new URL("/login/student/activar", `https://${host}`).toString()
      : null;

    const assistantSupabase = createServiceClient();
    const result = await runAssistantTurn({
      supabase: assistantSupabase,
      studio: {
        id: studio.id,
        name: studio.name,
        timezone: studio.timezone,
        currency: studio.currency,
      },
      config: {
        assistant_name: config.assistant_name,
        model: config.model,
        reasoning_effort: config.reasoning_effort as "none" | "low" | "medium" | "high",
        personality_instructions: config.personality_instructions,
        monthly_budget_usd_micros: config.monthly_budget_usd_micros,
        conversation_budget_usd_micros: config.conversation_budget_usd_micros,
        max_model_calls_per_turn: config.max_model_calls_per_turn,
        max_tool_calls_per_turn: config.max_tool_calls_per_turn,
      },
      conversationId,
      turnId: inboundTurn.id,
      studentId: conversationStudentId,
      crmContactId: conversationCrmContactId,
      activationUrl,
      serviceMode: true,
      history,
    });

    const persistedReply = result.reply.replace(
      /https:\/\/[^\s]+\/login\/student\/activar\?[^\s]+/g,
      "[enlace de activación enviado]",
    );

    const { error: replyError } = await supabase.from("assistant_turns").insert({
      studio_id: studio.id,
      conversation_id: conversationId,
      direction: "outbound",
      role: "assistant",
      content: persistedReply,
      sanitized: true,
    });
    if (replyError) {
      return { ok: false as const, error: "reply_persist_failed" };
    }

    await supabase
      .from("assistant_conversations")
      .update({
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId)
      .eq("studio_id", studio.id);

    return {
      ok: true as const,
      conversationId,
      reply: result.reply,
      trace: result.trace,
    };
  } catch (error) {
    return {
      ok: false as const,
      conversationId,
      error: errorMessage(error),
    };
  }
}

const RECEIPT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

export async function sendDemiReceipt(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "").trim();
  const requestedStudentId = String(formData.get("studentId") ?? "").trim();
  const file = formData.get("file");

  if (!conversationId || !requestedStudentId) {
    return { ok: false as const, error: "receipt_identity_required" };
  }
  if (!(file instanceof File) || file.size <= 0 || file.size > 10 * 1024 * 1024) {
    return { ok: false as const, error: "receipt_invalid_file" };
  }
  if (!RECEIPT_MIME_TYPES.has(file.type)) {
    return { ok: false as const, error: "receipt_invalid_file" };
  }

  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const { data: config } = await supabase
    .from("assistant_configs")
    .select("mode")
    .eq("studio_id", studio.id)
    .maybeSingle();

  if (!config) return { ok: false as const, error: "assistant_not_configured" };
  if (config.mode !== "demo") {
    return { ok: false as const, error: "assistant_demo_disabled" };
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("assistant_conversations")
    .select("id,student_id")
    .eq("id", conversationId)
    .eq("studio_id", studio.id)
    .eq("channel", "internal_demo")
    .eq("status", "open")
    .maybeSingle();

  if (conversationError || !conversation) {
    return { ok: false as const, error: "conversation_not_found" };
  }
  if (!conversation.student_id || conversation.student_id !== requestedStudentId) {
    return { ok: false as const, error: "conversation_identity_mismatch" };
  }

  const service = createServiceClient();
  const providerMessageId = `internal-demo-receipt-${randomUUID()}`;
  const mediaId = `internal-demo-media-${randomUUID()}`;
  const messageType = file.type === "application/pdf" ? "document" : "image";
  const payloadFingerprint = createHash("sha256")
    .update(`${providerMessageId}:${file.name}:${file.size}:${file.type}`)
    .digest("hex");

  const { data: event, error: eventError } = await service
    .from("assistant_whatsapp_events")
    .insert({
      studio_id: studio.id,
      provider: "meta_whatsapp",
      provider_event_id: providerMessageId,
      phone_number_id: "internal_demo",
      contact_wa_id: null,
      message_type: messageType,
      body_preview: "",
      media_id: mediaId,
      payload_fingerprint: payloadFingerprint,
      processing_status: "captured",
    })
    .select("id")
    .single();

  if (eventError || !event) {
    return { ok: false as const, error: "receipt_activation_failed" };
  }

  const { data: activationData, error: activationError } = await service.rpc(
    "service_activate_transfer_receipt",
    {
      target_studio_id: studio.id,
      target_conversation_id: conversationId,
      target_student_id: requestedStudentId,
      target_event_id: event.id,
      target_provider_message_id: providerMessageId,
      target_media_id: mediaId,
    },
  );

  const activation =
    activationData && typeof activationData === "object" && !Array.isArray(activationData)
      ? (activationData as Record<string, unknown>)
      : null;

  if (activationError || !activation || activation.ok !== true) {
    const reason = String(activation?.reason_code ?? "");
    return {
      ok: false as const,
      error:
        reason === "pending_transfer_not_found" || reason === "transfer_intent_expired"
          ? "receipt_no_pending_transfer"
          : "receipt_activation_failed",
    };
  }

  const intentId = String(activation.intent_id ?? "").trim();
  if (!intentId) {
    return { ok: false as const, error: "receipt_activation_failed" };
  }

  const extension =
    file.type === "application/pdf"
      ? "pdf"
      : file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
          ? "webp"
          : "jpg";
  const storagePath = `${studio.id}/${requestedStudentId}/${intentId}/receipt.${extension}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: storageError } = await service.storage
    .from("transfer-receipts")
    .upload(storagePath, bytes, {
      contentType: file.type,
      upsert: true,
      cacheControl: "3600",
    });

  if (storageError) {
    return { ok: false as const, error: "receipt_upload_failed" };
  }

  const { error: metadataError } = await service
    .from("assistant_transfer_purchase_intents")
    .update({
      receipt_storage_path: storagePath,
      receipt_mime_type: file.type,
      receipt_file_size: file.size,
      receipt_stored_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", intentId)
    .eq("studio_id", studio.id)
    .eq("student_id", requestedStudentId);

  if (metadataError) {
    return { ok: false as const, error: "receipt_upload_failed" };
  }

  const packageName = String(activation.package_name ?? "tu paquete").trim() || "tu paquete";
  const saleId = String(activation.sale_id ?? "").trim();

  const { data: handoffData, error: handoffError } = await service.rpc(
    "assistant_create_handoff",
    {
      target_studio_id: studio.id,
      target_conversation_id: conversationId,
      target_student_id: requestedStudentId,
      target_reason_code: "transfer_receipt_review",
      target_note:
        `Comprobante recibido en UAT. Paquete activado provisionalmente: ${packageName}. ` +
        `Intento: ${intentId}. Venta: ${saleId || "sin referencia"}. Validar transferencia.`,
    },
  );

  const handoffOk =
    handoffData &&
    typeof handoffData === "object" &&
    !Array.isArray(handoffData) &&
    (handoffData as Record<string, unknown>).ok === true;

  if (handoffError || !handoffOk) {
    return { ok: false as const, error: "receipt_activation_failed" };
  }

  const userTurn = `[Comprobante adjunto: ${file.name}]`;
  const reply =
    `Recibí tu comprobante. Activé provisionalmente ${packageName} para que puedas continuar. ` +
    "El pago queda pendiente de validación. Si al revisar la transferencia no se confirma correctamente, el paquete puede ser revocado.";

  await service.from("assistant_turns").insert([
    {
      studio_id: studio.id,
      conversation_id: conversationId,
      direction: "inbound",
      role: "user",
      content: userTurn,
      sanitized: true,
    },
    {
      studio_id: studio.id,
      conversation_id: conversationId,
      direction: "outbound",
      role: "assistant",
      content: reply,
      sanitized: true,
    },
  ]);

  await service
    .from("assistant_conversations")
    .update({
      last_activity_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
    .eq("studio_id", studio.id);

  return {
    ok: true as const,
    conversationId,
    reply,
    packageName,
    status: String(activation.status ?? "provisional_active"),
  };
}
