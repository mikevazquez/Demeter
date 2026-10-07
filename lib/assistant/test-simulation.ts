import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssistantStudioContext } from "./read-tools";
import { isExplicitAssistantConfirmation } from "./action-tools";
import type { TestPersona } from "./prompt-workbench";

type Summary = Record<string, unknown>;
export type TestSimulation = {
  persona: TestPersona;
  pending?: { tool: string; summary: Summary; preparedTurnId: string } | null;
  reservations: Summary[];
  credits: number;
};

export function createTestSimulation(persona: TestPersona): TestSimulation {
  return { persona, reservations: [], credits: persona === "student" ? 8 : 0 };
}

export function simulatedReadTool(state: TestSimulation, tool: string) {
  if (tool === "get_student_package_status") {
    return {
      ok: true,
      simulated: true,
      student_state: { category: state.persona === "student" ? "active_student" : "prospect" },
      current_package:
        state.persona === "student"
          ? {
              name: "Paquete de prueba: 8 clases",
              available_credits: state.credits,
              unlimited: false,
            }
          : null,
      packages: [],
    };
  }
  if (tool === "get_student_reservations") {
    return { ok: true, simulated: true, reservations: state.reservations };
  }
  return null;
}

export async function simulateAssistantAction(
  input: {
    state: TestSimulation;
    supabase: SupabaseClient;
    studio: AssistantStudioContext;
    turnId: string;
    currentUserMessage: string;
  },
  tool: string,
  args: Record<string, unknown>,
) {
  const { state } = input;
  const result = (data: Summary): Summary & { simulated: true } => ({ simulated: true, ...data });
  if (tool === "escalate_to_human") {
    return result({
      ok: true,
      status: "simulated",
      reason_message: "Se simula atención humana; no se genera una solicitud real.",
    });
  }
  if (tool.startsWith("execute_")) {
    const pending = state.pending;
    if (
      !pending ||
      pending.tool !== tool ||
      pending.preparedTurnId === input.turnId ||
      !isExplicitAssistantConfirmation(input.currentUserMessage)
    ) {
      return result({
        ok: false,
        error: "confirmation_required",
        reason_message: "Hace falta una nueva confirmación para esta acción de prueba.",
      });
    }
    state.pending = null;
    if (tool === "execute_booking") {
      state.reservations.push({
        ...pending.summary,
        reservation_ref: `reservation:test-${input.turnId}`,
        status: "reserved",
      });
      if (state.persona === "student") state.credits = Math.max(0, state.credits - 1);
    } else if (tool === "execute_cancellation") {
      state.reservations = state.reservations.filter(
        (row) => row.reservation_ref !== pending.summary.reservation_ref,
      );
      if (state.persona === "student" && pending.summary.credit_will_return === true)
        state.credits += 1;
    } else if (tool === "execute_reschedule") {
      const from = pending.summary.from as Summary;
      const to = pending.summary.to as Summary;
      state.reservations = state.reservations.map((row) =>
        row.reservation_ref === from.reservation_ref
          ? { ...to, reservation_ref: from.reservation_ref, status: "reserved" }
          : row,
      );
    }
    return result({ ok: true, status: "executed", summary: pending.summary });
  }

  if (tool === "record_trial_payment_preference") {
    return result({
      ok: true,
      status: "simulated",
      payment_method: args.payment_method,
      reason_message: "Preferencia simulada; no se registra ni valida ningún pago real.",
    });
  }
  const prepareToExecute: Record<string, string> = {
    prepare_booking: "execute_booking",
    prepare_cancellation: "execute_cancellation",
    prepare_reschedule: "execute_reschedule",
    prepare_waitlist_join: "execute_waitlist_join",
    prepare_student_access_activation: "execute_student_access_activation",
  };
  const execute = prepareToExecute[tool];
  if (!execute) {
    return result({
      ok: false,
      error: "simulation_not_supported",
      reason_message:
        "Esta acción no se ejecuta en el chat de pruebas. No se genera un pago, enlace de acceso ni mensaje real.",
    });
  }
  let summary: Summary = {};
  if (tool === "prepare_cancellation" || tool === "prepare_reschedule") {
    const existing = state.reservations.find((row) => row.reservation_ref === args.reservation_ref);
    if (!existing)
      return result({
        ok: false,
        error: "reservation_not_found",
        reason_message: "Primero crea una reserva dentro de esta prueba.",
      });
    if (tool === "prepare_cancellation" && !String(args.reason ?? "").trim()) {
      return result({ ok: false, error: "reason_required" });
    }
    summary =
      tool === "prepare_cancellation"
        ? { ...existing, credit_will_return: state.persona === "student" }
        : { from: existing };
  }
  const sessionRef = String(args.target_session_ref ?? args.session_ref ?? "");
  if (
    tool === "prepare_booking" ||
    tool === "prepare_waitlist_join" ||
    tool === "prepare_reschedule"
  ) {
    if (!/^session:[0-9a-f-]{36}$/i.test(sessionRef))
      return result({ ok: false, error: "invalid_session_ref" });
    const { data: session, error } = await input.supabase
      .from("class_sessions")
      .select("id,template_id,starts_at,ends_at,status")
      .eq("studio_id", input.studio.id)
      .eq("id", sessionRef.slice(8))
      .maybeSingle();
    if (
      error ||
      !session ||
      session.status !== "scheduled" ||
      new Date(session.starts_at).getTime() <= Date.now()
    ) {
      return result({ ok: false, error: "session_unavailable" });
    }
    const { data: template } = await input.supabase
      .from("class_templates")
      .select("name")
      .eq("studio_id", input.studio.id)
      .eq("id", session.template_id)
      .maybeSingle();
    const localTime = (date: string) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: input.studio.timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(date));
    const target = {
      session_ref: sessionRef,
      activity: template?.name ?? "Clase",
      date: new Intl.DateTimeFormat("en-CA", { timeZone: input.studio.timezone }).format(
        new Date(session.starts_at),
      ),
      starts_at_local: localTime(session.starts_at),
      ends_at_local: localTime(session.ends_at),
    };
    if (state.persona === "student" && tool === "prepare_booking" && state.credits <= 0)
      return result({ ok: false, error: "no_credits" });
    summary = tool === "prepare_reschedule" ? { ...summary, to: target } : target;
  }
  state.pending = { tool: execute, summary, preparedTurnId: input.turnId };
  return result({
    ok: true,
    status: "confirmation_required",
    summary,
    reason_message:
      "Es una simulación: no valida elegibilidad ni descuenta créditos reales. Pide confirmación para continuar la prueba.",
  });
}
