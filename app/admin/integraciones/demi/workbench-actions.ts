"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { runAssistantTurn } from "@/lib/assistant/orchestrator";
import { validPrompt, type TestPersona } from "@/lib/assistant/prompt-workbench";
import {
  confirmSimulatedProspectName,
  createTestSimulation,
  type TestSimulation,
} from "@/lib/assistant/test-simulation";
import { proposeDemiAdminPlan, type DemiAdminPlan } from "@/lib/assistant/admin-copilot";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

export async function saveDemiPrompt(instructions: string, note: string) {
  const { supabase, studio, user } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  if (!validPrompt(instructions)) return { ok: false as const, error: "invalid_prompt" };
  const { data, error } = await supabase
    .from("assistant_prompt_versions")
    .insert({
      studio_id: studio.id,
      kind: "draft",
      instructions,
      note: String(note ?? "")
        .trim()
        .slice(0, 500),
      created_by: user.id,
    })
    .select("id,kind,instructions,note,created_at")
    .single();
  if (error || !data) return { ok: false as const, error: "prompt_storage_unavailable" };
  revalidatePath("/admin/integraciones/demi");
  return { ok: true as const, version: data };
}

export async function activateDemiPrompt(versionId: string, expectedActive: string) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const { data, error } = await supabase.rpc("admin_activate_demi_prompt", {
    p_studio_id: studio.id,
    p_version_id: versionId,
    p_expected_active: expectedActive,
  });
  if (error) return { ok: false as const, error: "request_failed" };
  const result = data as { ok: boolean; error?: string } | null;
  if (!result?.ok) return { ok: false as const, error: result?.error ?? "request_failed" };
  revalidatePath("/admin/integraciones/demi");
  return { ok: true as const };
}

export async function testDemiPrompt(input: {
  conversationId?: string | null;
  instructions: string;
  message: string;
  persona: TestPersona;
  improve?: boolean;
}) {
  const { supabase, studio, user } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  if (!validPrompt(input.instructions)) return { ok: false as const, error: "invalid_prompt" };
  const message = String(input.message ?? "").trim();
  if (!message || message.length > 2000) return { ok: false as const, error: "invalid_message" };
  if (input.persona !== "prospect" && input.persona !== "student")
    return { ok: false as const, error: "request_failed" };
  const { data: config, error: configError } = await supabase
    .from("assistant_configs")
    .select(
      "assistant_name,model,reasoning_effort,monthly_budget_usd_micros,conversation_budget_usd_micros,max_model_calls_per_turn,max_tool_calls_per_turn",
    )
    .eq("studio_id", studio.id)
    .maybeSingle();
  if (configError || !config) return { ok: false as const, error: "assistant_not_configured" };

  const promptHash = hash(input.instructions);
  let conversationId = input.improve ? "" : String(input.conversationId ?? "");
  let state = createTestSimulation(input.persona);
  if (conversationId) {
    const { data: conversation, error } = await supabase
      .from("assistant_conversations")
      .select("id,context")
      .eq("studio_id", studio.id)
      .eq("id", conversationId)
      .eq("channel", "internal_demo")
      .eq("status", "open")
      .maybeSingle();
    const ctx = conversation?.context as Record<string, unknown> | null;
    if (error || !ctx || ctx.workbench !== true || ctx.owner !== user.id)
      return { ok: false as const, error: "conversation_not_found" };
    if (ctx.prompt_hash !== promptHash || ctx.persona !== input.persona || ctx.purpose !== "test")
      return { ok: false as const, error: "draft_changed" };
    state = ctx.simulation as TestSimulation;
  } else {
    const { data, error } = await supabase
      .from("assistant_conversations")
      .insert({
        studio_id: studio.id,
        channel: "internal_demo",
        status: "open",
        context: {
          workbench: true,
          owner: user.id,
          prompt_hash: promptHash,
          prompt_snapshot: input.instructions,
          persona: input.persona,
          purpose: input.improve ? "improve" : "test",
          simulation: state,
        },
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false as const, error: "request_failed" };
    conversationId = data.id;
  }

  if (!input.improve) confirmSimulatedProspectName(state, message);

  // A lease prevents two browser tabs from executing the same simulated turn concurrently.
  const lockUntil = new Date(Date.now() + 120_000).toISOString();
  const { data: locked, error: lockError } = await supabase
    .from("assistant_conversations")
    .update({ workbench_lock_until: lockUntil })
    .eq("studio_id", studio.id)
    .eq("id", conversationId)
    .or(`workbench_lock_until.is.null,workbench_lock_until.lt.${new Date().toISOString()}`)
    .select("id")
    .maybeSingle();
  if (lockError || !locked) return { ok: false as const, error: "assistant_busy" };

  try {
    const userContent = input.improve
      ? `PROMPT ORIGINAL:\n${input.instructions}\n\nCAMBIO SOLICITADO:\n${message}`
      : message;
    const { data: turn, error: turnError } = await supabase
      .from("assistant_turns")
      .insert({
        studio_id: studio.id,
        conversation_id: conversationId,
        direction: "inbound",
        role: "user",
        content: userContent,
        sanitized: true,
      })
      .select("id")
      .single();
    if (turnError || !turn) throw new Error("request_failed");
    const { data: turns, error: historyError } = await supabase
      .from("assistant_turns")
      .select("role,content")
      .eq("studio_id", studio.id)
      .eq("conversation_id", conversationId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: false })
      .limit(16);
    if (historyError) throw new Error("request_failed");
    const result = await runAssistantTurn({
      supabase,
      studio,
      config: { ...config, personality_instructions: input.instructions },
      conversationId,
      turnId: turn.id,
      studentId: null,
      crmContactId: null,
      activationUrl: null,
      history: (turns ?? [])
        .reverse()
        .map((row) => ({ role: row.role as "user" | "assistant", content: row.content })),
      testSimulation: state,
      improvePrompt: input.improve === true,
      identityNeedsName: state.identityNeedsName,
    });
    if (input.improve && !validPrompt(result.reply)) throw new Error("invalid_prompt");
    const { error: replyError } = await supabase.from("assistant_turns").insert({
      studio_id: studio.id,
      conversation_id: conversationId,
      direction: "outbound",
      role: "assistant",
      content: result.reply,
      sanitized: true,
    });
    if (replyError) throw new Error("request_failed");
    const { error: stateError } = await supabase
      .from("assistant_conversations")
      .update({
        context: {
          workbench: true,
          owner: user.id,
          prompt_hash: promptHash,
          prompt_snapshot: input.instructions,
          persona: input.persona,
          purpose: input.improve ? "improve" : "test",
          simulation: state,
        },
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("studio_id", studio.id)
      .eq("id", conversationId);
    if (stateError) throw new Error("request_failed");
    return { ok: true as const, conversationId, reply: result.reply };
  } catch (error) {
    const code = error instanceof Error ? error.message : "request_failed";
    return {
      ok: false as const,
      error: ["openai_not_configured", "assistant_budget_exceeded", "invalid_prompt"].includes(code)
        ? code
        : "request_failed",
    };
  } finally {
    await supabase
      .from("assistant_conversations")
      .update({ workbench_lock_until: null })
      .eq("studio_id", studio.id)
      .eq("id", conversationId)
      .eq("workbench_lock_until", lockUntil);
  }
}

export async function setDemiHandoffPolicy(policyId: string, enabled: boolean) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const { error } = await supabase.from("assistant_handoff_policies").update({
    enabled,
    updated_at: new Date().toISOString(),
  }).eq("studio_id", studio.id).eq("id", policyId);
  if (error) return { ok: false as const, error: "request_failed" };
  revalidatePath("/admin/integraciones/demi");
  return { ok: true as const };
}

export async function reviewDemiLearning(proposalId: string, decision: "approved" | "rejected") {
  const { supabase, studio, user } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const { data: proposal, error: readError } = await supabase
    .from("assistant_learning_proposals")
    .select("id,proposed_instruction,status")
    .eq("studio_id", studio.id).eq("id", proposalId).maybeSingle();
  if (readError || !proposal || proposal.status !== "pending")
    return { ok: false as const, error: "request_failed" };

  const { error } = await supabase.from("assistant_learning_proposals").update({
    status: decision,
    reviewed_at: new Date().toISOString(),
    reviewed_by: user.id,
    updated_at: new Date().toISOString(),
  }).eq("studio_id", studio.id).eq("id", proposalId).eq("status", "pending");
  if (error) return { ok: false as const, error: "request_failed" };
  revalidatePath("/admin/integraciones/demi");
  return { ok: true as const, proposedInstruction: decision === "approved" ? proposal.proposed_instruction : null };
}


export async function proposeDemiAdminChange(instructionInput: string) {
  const { supabase, studio, user } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const instruction = String(instructionInput ?? "").trim();
  if (!instruction || instruction.length > 4000)
    return { ok: false as const, error: "invalid_message" };

  const [
    { data: config },
    { data: trialPolicy },
    { data: bookingBehavior },
    { data: handoffPolicies },
    { data: products },
    { data: activities },
    { data: managedRules },
  ] = await Promise.all([
    supabase
      .from("assistant_configs")
      .select("assistant_name,model,reasoning_effort")
      .eq("studio_id", studio.id)
      .maybeSingle(),
    supabase
      .from("trial_booking_policies")
      .select("enabled,allow_without_enrollment_until_first_attendance,max_active_trial_reservations,prepayment_after_no_shows,require_payment_before_attendance,require_payment_before_booking")
      .eq("studio_id", studio.id)
      .maybeSingle(),
    supabase
      .from("assistant_booking_behaviors")
      .select("prospect_require_payment_before_booking")
      .eq("studio_id", studio.id)
      .maybeSingle(),
    supabase
      .from("assistant_handoff_policies")
      .select("reason_code,label,enabled,blocking")
      .eq("studio_id", studio.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("product_templates")
      .select("name,price_minor,currency,active,assistant_visible,online_purchasable,product_type")
      .eq("studio_id", studio.id)
      .order("name", { ascending: true }),
    supabase
      .from("class_templates")
      .select("name,active,drop_in_price_minor")
      .eq("studio_id", studio.id)
      .eq("active", true)
      .order("name", { ascending: true }),
    supabase
      .from("assistant_admin_rules")
      .select("rule_key,category,instruction,enabled")
      .eq("studio_id", studio.id)
      .order("updated_at", { ascending: false }),
  ]);

  if (!config) return { ok: false as const, error: "assistant_not_configured" };

  try {
    const plan = await proposeDemiAdminPlan({
      instruction,
      model: config.model,
      state: {
        studio: { name: studio.name, currency: studio.currency },
        studio_flow_rules: {
          trial_booking_policy: trialPolicy,
          note: "Restricciones duras. Demi no puede relajarlas ni saltarlas.",
        },
        demi_booking_behavior: bookingBehavior,
        effective_trial_payment_before_booking:
          trialPolicy?.require_payment_before_booking === true ||
          bookingBehavior?.prospect_require_payment_before_booking === true,
        handoff_policies: handoffPolicies ?? [],
        products: products ?? [],
        activities: activities ?? [],
        managed_rules: managedRules ?? [],
      },
    });

    const { data: request, error } = await supabase
      .from("assistant_admin_change_requests")
      .insert({
        studio_id: studio.id,
        instruction,
        summary: plan.summary,
        plan,
        status: "proposed",
        created_by: user.id,
      })
      .select("id,instruction,summary,plan,status,created_at")
      .single();
    if (error || !request) return { ok: false as const, error: "request_failed" };
    revalidatePath("/admin/integraciones/demi");
    return { ok: true as const, request: { ...request, plan: request.plan as DemiAdminPlan } };
  } catch (error) {
    const code = error instanceof Error ? error.message : "request_failed";
    return {
      ok: false as const,
      error: ["openai_not_configured", "admin_plan_failed", "admin_plan_invalid"].includes(code)
        ? code
        : "request_failed",
    };
  }
}

export async function applyDemiAdminChange(requestIdInput: string) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const requestId = String(requestIdInput ?? "").trim();
  if (!requestId) return { ok: false as const, error: "request_failed" };

  const { data, error } = await supabase.rpc("admin_apply_demi_change_plan", {
    p_studio_id: studio.id,
    p_request_id: requestId,
  });
  const result = data as { ok?: boolean; error?: string } | null;
  if (error || !result?.ok) {
    await supabase
      .from("assistant_admin_change_requests")
      .update({
        status: "failed",
        error_code: result?.error ?? "request_failed",
        updated_at: new Date().toISOString(),
      })
      .eq("studio_id", studio.id)
      .eq("id", requestId)
      .eq("status", "proposed");
    revalidatePath("/admin/integraciones/demi");
    return { ok: false as const, error: "request_failed" };
  }

  revalidatePath("/admin/integraciones/demi");
  return { ok: true as const };
}

export async function rejectDemiAdminChange(requestIdInput: string) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.SETTINGS_WRITE);
  const requestId = String(requestIdInput ?? "").trim();
  const { error } = await supabase
    .from("assistant_admin_change_requests")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("studio_id", studio.id)
    .eq("id", requestId)
    .eq("status", "proposed");
  if (error) return { ok: false as const, error: "request_failed" };
  revalidatePath("/admin/integraciones/demi");
  return { ok: true as const };
}
