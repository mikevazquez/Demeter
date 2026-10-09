import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssistantStudioContext } from "./read-tools";
import { isExplicitAssistantConfirmation } from "./action-tools";
import { isActiveStudentPersona, isFirstVisitPersona, type TestPersona } from "./prompt-workbench";

type Summary = Record<string, unknown>;
export type TestSimulation = {
  persona: TestPersona;
  identityNeedsName: boolean;
  paymentBeforeBooking?: boolean;
  pending?: { tool: string; summary: Summary; preparedTurnId: string } | null;
  reservations: Summary[];
  credits: number;
};

export function createTestSimulation(persona: TestPersona): TestSimulation {
  const hasUpcomingReservation =
    persona === "trial_pending_reserved" || persona === "student_reserved";
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const reservationDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
  }).format(tomorrow);
  return {
    persona,
    identityNeedsName: persona === "prospect",
    reservations: hasUpcomingReservation
      ? [
          {
            reservation_ref: `reservation:test-${persona}`,
            activity: "Pole Fitness",
            date: reservationDate,
            starts_at_local: "18:00",
            ends_at_local: "19:00",
            location: "Estudio Demeter",
            space: null,
            credit_cost: 1,
            status: "reserved",
          },
        ]
      : [],
    credits: isActiveStudentPersona(persona) ? 8 : 0,
  };
}

export function confirmSimulatedProspectName(state: TestSimulation, message: string) {
  if (state.persona !== "prospect" || !state.identityNeedsName) return false;

  const cleanedMessage = message.trim().replace(/^(?:hola[,!\s]+)?/i, "");
  const explicitName = /^(?:me llamo|mi nombre es|soy)\s+/i.test(cleanedMessage);
  const candidate = cleanedMessage
    .replace(/^(?:me llamo|mi nombre es|soy)\s+/i, "")
    .replace(/^(?:sí[,!\s]+|claro[,!\s]+|ok[,!\s]+|va[,!\s]+)/i, "")
    .replace(/\s+y\s+(?=(?:sí|claro|ok|quiero|me gustaría|puedes|por favor)(?:\s|$)).*$/i, "")
    .replace(/[.,!?]+$/g, "")
    .trim();
  const parts = candidate.split(/\s+/).filter(Boolean);
  const isFullName =
    parts.length >= 2 &&
    parts.length <= 4 &&
    parts.every((part) => /^[\p{L}][\p{L}'’-]*$/u.test(part)) &&
    (explicitName || parts.every((part) => /^\p{Lu}/u.test(part)));

  if (!isFullName) return false;
  state.identityNeedsName = false;
  return true;
}

export function simulatedReadTool(state: TestSimulation, tool: string) {
  if (
    state.persona === "unresolved_identity" &&
    (tool === "get_student_package_status" || tool === "get_student_reservations")
  ) {
    return {
      ok: false,
      simulated: true,
      error: "identity_required",
      reason_message: "No se puede consultar información personal sin identidad resuelta.",
    };
  }
  if (tool === "get_student_package_status") {
    const category =
      state.persona === "unresolved_identity"
        ? "unresolved"
        : state.persona === "prospect"
          ? "prospect"
          : state.persona === "trial_pending_reserved"
            ? "trial_pending"
            : state.persona === "trial_cancelled"
              ? "trial_cancelled"
              : state.persona === "trial_no_show"
                ? "trial_no_show"
                : state.persona === "trial_attended"
                  ? "trial_attended"
                  : state.persona === "former_student"
                    ? "former_student"
                    : "active_student";
    const hasActivePackage = isActiveStudentPersona(state.persona);
    return {
      ok: true,
      simulated: true,
      student_state: {
        category,
        ...(state.persona === "former_student"
          ? { lifecycle_status: "inactive", enrollment_status: "expired", has_current_package: false, has_expired_package: true }
          : {}),
      },
      current_package: hasActivePackage
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
  if (tool === "prepare_booking" && state.persona === "former_student") {
    return result({
      ok: false,
      error: "enrollment_required",
      reason_code: "enrollment_required",
      reason_message: "Tu inscripción está vencida. Puedes renovar la inscripción por separado o elegir un paquete que la incluya. Después podrás reservar una clase.",
    });
  }
  if (tool === "prepare_booking" && state.identityNeedsName && state.paymentBeforeBooking !== true) {
    return result({
      ok: false,
      reason_code: "prospect_name_required",
      reason_message:
        "Antes de reservar, pide el nombre completo y espera a que Studio Flow lo confirme.",
    });
  }

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
      if (isFirstVisitPersona(state.persona) && pending.summary.payment_before_booking === true) {
        const { data: transferSettings } = await input.supabase
          .from("studio_bank_transfer_settings")
          .select("bank_name,account_holder,clabe,account_number,card_number,instructions")
          .eq("studio_id", input.studio.id)
          .eq("enabled", true)
          .maybeSingle();
        return result({
          ok: true,
          status: "payment_required",
          reservation_confirmed: false,
          payment_required: true,
          amount_minor: pending.summary.amount_minor,
          currency: pending.summary.currency,
          bank_details: transferSettings ?? null,
          summary: pending.summary,
        });
      }
      state.reservations.push({
        ...pending.summary,
        reservation_ref: `reservation:test-${input.turnId}`,
        status: "reserved",
      });
      if (isActiveStudentPersona(state.persona)) state.credits = Math.max(0, state.credits - 1);
    } else if (tool === "execute_cancellation") {
      state.reservations = state.reservations.filter(
        (row) => row.reservation_ref !== pending.summary.reservation_ref,
      );
      if (isActiveStudentPersona(state.persona) && pending.summary.credit_will_return === true)
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
        ? { ...existing, credit_will_return: isActiveStudentPersona(state.persona) }
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
      new Date(session.starts_at).getTime() <= Date.now() + 30 * 60_000
    ) {
      return result({ ok: false, error: "session_unavailable" });
    }
    const { data: template } = await input.supabase
      .from("class_templates")
      .select("name,drop_in_price_minor")
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
    const isTrialBooking = isFirstVisitPersona(state.persona) && tool === "prepare_booking";
    const target = {
      session_ref: sessionRef,
      activity: template?.name ?? "Clase",
      date: new Intl.DateTimeFormat("en-CA", { timeZone: input.studio.timezone }).format(
        new Date(session.starts_at),
      ),
      starts_at_local: localTime(session.starts_at),
      ends_at_local: localTime(session.ends_at),
      ...(isTrialBooking
        ? {
            trial_booking: true,
            payment_before_booking: state.paymentBeforeBooking === true,
            amount_minor: Number(template?.drop_in_price_minor ?? 0),
            currency: input.studio.currency,
          }
        : {}),
    };
    if (isActiveStudentPersona(state.persona) && tool === "prepare_booking" && state.credits <= 0)
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
