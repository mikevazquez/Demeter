"use server";

import { headers } from "next/headers";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { runAssistantTurn } from "@/lib/assistant/orchestrator";

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
    conversationCrmContactId =
      String(existingContext.demo_crm_contact_id ?? "").trim() || null;

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
        context: requestedCrmContactId
          ? { demo_crm_contact_id: requestedCrmContactId }
          : {},
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

    const result = await runAssistantTurn({
      supabase,
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
      history,
    });

    const { error: replyError } = await supabase.from("assistant_turns").insert({
      studio_id: studio.id,
      conversation_id: conversationId,
      direction: "outbound",
      role: "assistant",
      content: result.reply,
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
