import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssistantStudioContext } from "./read-tools";
import { isExplicitAssistantConfirmation } from "./action-tools";
import {
  isActiveStudentPersona,
  isFirstVisitPersona,
  type TestPersona,
  type WorkbenchCase,
} from "./prompt-workbench";

type Summary = Record<string, unknown>;
type TransferQuote = {
  product_ref: string;
  package: { name: string; amount_minor: number; currency: string };
  enrollment: { name: string; amount_minor: number; currency: string } | null;
  enrollment_required: boolean;
  enrollment_included: boolean;
  total_amount_minor: number;
  credits: number | null;
  unlimited: boolean;
};

function transferQuoteSignature(quote: TransferQuote | undefined) {
  if (!quote) return null;
  // JSONB does not preserve object key order between workbench turns.
  return JSON.stringify([
    quote.product_ref,
    quote.package.name,
    quote.package.amount_minor,
    quote.package.currency,
    quote.enrollment?.name ?? null,
    quote.enrollment?.amount_minor ?? null,
    quote.enrollment?.currency ?? null,
    quote.enrollment_required,
    quote.enrollment_included,
    quote.total_amount_minor,
    quote.credits,
    quote.unlimited,
  ]);
}
export type TestSimulation = {
  persona: TestPersona;
  identityNeedsName: boolean;
  paymentBeforeBooking?: boolean;
  pending?: { tool: string; summary: Summary; preparedTurnId: string } | null;
  reservations: Summary[];
  credits: number;
  workbenchCase?: WorkbenchCase;
  enrollmentStatus?: "active" | "missing";
  transfer?: {
    status: "awaiting_receipt" | "awaiting_profile" | "provisional_active";
    quote: TransferQuote;
    receiptEvidence?: "seeded_fixture" | "admin_fixture_event";
  };
  transferPreview?: { quote: TransferQuote; turnId: string };
};

export function createTestSimulation(
  persona: TestPersona,
  workbenchCase: WorkbenchCase = "standard",
): TestSimulation {
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
    ...(workbenchCase !== "standard"
      ? {
          workbenchCase,
          enrollmentStatus: workbenchCase === "S15" ? ("active" as const) : ("missing" as const),
          ...(workbenchCase === "S14" ? { credits: 0 } : {}),
        }
      : {}),
  };
}

// Read-only quote for an explicitly selected fixture. This is not operational eligibility.
async function testTransferQuote(
  supabase: SupabaseClient,
  studioId: string,
  state: TestSimulation,
  productRef: string,
) {
  if (!/^product:[0-9a-f-]{36}$/i.test(productRef)) return null;
  const product = await supabase
    .from("product_templates")
    .select("id,name,price_minor,currency,enrollment_included,credit_limit,unlimited")
    .eq("studio_id", studioId)
    .eq("id", productRef.slice(8))
    .eq("active", true)
    .neq("product_type", "enrollment")
    .or("assistant_visible.is.null,assistant_visible.eq.true")
    .maybeSingle();
  if (product.error || !product.data || !Number.isInteger(product.data.price_minor)) return null;
  const policy = await supabase
    .from("enrollment_policies")
    .select("enabled,required_for_package_purchase,enrollment_product_template_id")
    .eq("studio_id", studioId)
    .maybeSingle();
  if (policy.error) return null;
  let enrollment: TransferQuote["enrollment"] = null;
  if (
    !product.data.enrollment_included &&
    state.enrollmentStatus !== "active" &&
    policy.data?.enabled &&
    policy.data.required_for_package_purchase
  ) {
    const item = await supabase
      .from("product_templates")
      .select("name,price_minor,currency")
      .eq("studio_id", studioId)
      .eq("id", policy.data.enrollment_product_template_id)
      .eq("active", true)
      .eq("product_type", "enrollment")
      .maybeSingle();
    if (
      item.error ||
      !item.data ||
      !Number.isInteger(item.data.price_minor) ||
      item.data.currency !== product.data.currency
    )
      return null;
    enrollment = {
      name: item.data.name,
      amount_minor: item.data.price_minor,
      currency: item.data.currency,
    };
  }
  return {
    product_ref: productRef,
    package: {
      name: product.data.name,
      amount_minor: product.data.price_minor,
      currency: product.data.currency,
    },
    enrollment,
    enrollment_required: Boolean(enrollment),
    enrollment_included: product.data.enrollment_included === true,
    total_amount_minor: product.data.price_minor + (enrollment?.amount_minor ?? 0),
    credits: product.data.credit_limit,
    unlimited: product.data.unlimited === true,
  } satisfies TransferQuote;
}

export async function initializeTestScenario(
  supabase: SupabaseClient,
  studioId: string,
  state: TestSimulation,
) {
  if (state.workbenchCase !== "S13") return true;
  const product = await supabase
    .from("product_templates")
    .select("id")
    .eq("studio_id", studioId)
    .eq("active", true)
    .eq("credit_limit", 8)
    .eq("enrollment_included", false)
    .or("assistant_visible.is.null,assistant_visible.eq.true")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (product.error || !product.data) return false;
  const quote = await testTransferQuote(supabase, studioId, state, `product:${product.data.id}`);
  if (!quote) return false;
  state.transfer = { status: "awaiting_profile", quote, receiptEvidence: "seeded_fixture" };
  return true;
}

// Only an explicit admin fixture event constitutes receipt evidence, never a chat claim.
export function recordSimulatedTransferReceipt(state: TestSimulation) {
  if (!state.workbenchCase || state.workbenchCase === "standard" || !state.transfer) return false;
  if (state.transfer.status !== "awaiting_receipt") return true;
  state.transfer.status = state.persona === "prospect" ? "awaiting_profile" : "provisional_active";
  state.transfer.receiptEvidence = "admin_fixture_event";
  if (state.persona !== "prospect") {
    state.credits = state.transfer.quote.credits ?? 0;
    if (state.transfer.quote.enrollment_required || state.transfer.quote.enrollment_included)
      state.enrollmentStatus = "active";
  }
  return true;
}

export function confirmSimulatedProspectName(state: TestSimulation, message: string) {
  if (state.workbenchCase && state.workbenchCase !== "standard") return false;
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

// Studio-local date (YYYY-MM-DD) offset by whole days, for synthetic validity windows.
function simulatedLocalDate(offsetDays: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(
    new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000),
  );
}

const FOLLOWUP_STAGES = new Set([
  "answering_questions",
  "awaiting_receipt",
  "awaiting_participant_data",
  "not_booked",
  "not_qualified",
  "opt_out",
]);

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
    const activeTransfer =
      state.transfer?.status === "provisional_active" ? state.transfer.quote : null;
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
    // Same shape as the real get_student_package_status, including validity dates (S03).
    const unlimited = activeTransfer?.unlimited ?? false;
    const creditLimit = unlimited ? null : (activeTransfer?.credits ?? 8);
    const availableCredits = unlimited ? null : state.credits;
    const currentPackage =
      hasActivePackage &&
      (state.workbenchCase !== "S14" || state.transfer?.status === "provisional_active")
        ? {
            name: activeTransfer?.package.name ?? "Paquete de prueba: 8 clases",
            unlimited,
            available_credits: availableCredits,
            credit_limit: creditLimit,
            starts_on: simulatedLocalDate(-5),
            expires_on: simulatedLocalDate(25),
            depleted: !unlimited && (availableCredits ?? 0) <= 0,
          }
        : null;
    return {
      ok: true,
      simulated: true,
      student_state: {
        category,
        ...(state.enrollmentStatus ? { enrollment_status: state.enrollmentStatus } : {}),
        ...(state.persona === "former_student"
          ? {
              lifecycle_status: "inactive",
              enrollment_status: "expired",
              has_current_package: false,
              has_expired_package: true,
            }
          : {}),
      },
      ...(state.workbenchCase && state.workbenchCase !== "standard"
        ? {
            workbench_context: {
              closed_first_class: state.workbenchCase === "S15",
              purchase_status: state.transfer?.status ?? null,
              purchase: state.transfer?.quote ?? null,
            },
          }
        : {}),
      current_package: currentPackage,
      packages: currentPackage ? [currentPackage] : [],
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
  if (
    state.workbenchCase &&
    state.workbenchCase !== "standard" &&
    tool === "prepare_bank_transfer_purchase"
  ) {
    if (state.transfer && state.transfer.status !== "awaiting_receipt") {
      return result({
        ok: false,
        reason_code: "purchase_already_received",
        status: state.transfer.status,
      });
    }
    const quote = await testTransferQuote(
      input.supabase,
      input.studio.id,
      state,
      String(args.product_ref ?? ""),
    );
    if (!quote) return result({ ok: false, reason_code: "purchase_quote_unavailable" });
    // Mirror the existing confirmation boundary without creating any purchase records.
    const confirmed =
      args.enrollment_accepted === true &&
      state.transferPreview?.turnId !== input.turnId &&
      transferQuoteSignature(state.transferPreview?.quote) === transferQuoteSignature(quote);
    if (quote.enrollment_required && !confirmed) {
      state.transferPreview = { quote, turnId: input.turnId };
      return result({
        ok: false,
        reason_code: "enrollment_confirmation_required",
        package: quote.package,
        enrollment: quote.enrollment,
        total_amount_minor: quote.total_amount_minor,
        instruction:
          "Explica paquete, inscripción y total. Pregunta si acepta pagarlos juntos; no prepares ni compartas datos bancarios antes de su aceptación.",
      });
    }
    state.transfer = { status: "awaiting_receipt", quote };
    return result({
      ok: true,
      status: "awaiting_receipt",
      ...quote,
      receipt_required: true,
      profile_required_after_payment: state.persona === "prospect",
      bank_details: {
        bank_name: "Banco de prueba",
        account_holder: "Simulación sin pago real",
        instructions:
          "No realices transferencias. Usa el botón de comprobante simulado para continuar.",
      },
      instruction:
        "Conserva este producto y total. No pidas datos personales antes del comprobante. No se ha creado una ficha, compra ni cobro real.",
    });
  }
  if (
    state.workbenchCase &&
    state.workbenchCase !== "standard" &&
    tool === "complete_purchase_profile"
  ) {
    if (!state.transfer || state.transfer.status === "awaiting_receipt")
      return result({ ok: false, reason_code: "payment_not_confirmed" });
    if (state.transfer.status === "provisional_active")
      return result({ ok: true, status: "provisional_active", idempotent: true });
    const name = String(args.full_name ?? "").trim();
    if (!/\S+\s+\S+/.test(name) || name.length > 160)
      return result({ ok: false, reason_code: "full_name_required" });
    const birth = String(args.birth_date ?? "");
    const date = new Date(birth + "T00:00:00Z");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: input.studio.timezone }).format(
      new Date(),
    );
    const oldest = new Date(today + "T00:00:00Z");
    oldest.setUTCFullYear(oldest.getUTCFullYear() - 100);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(birth) ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== birth ||
      birth > today ||
      date < oldest
    )
      return result({ ok: false, reason_code: "birth_date_invalid" });
    const email = String(args.email ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254)
      return result({ ok: false, reason_code: "email_invalid" });
    state.transfer.status = "provisional_active";
    state.persona = "student";
    state.identityNeedsName = false;
    if (state.transfer.quote.enrollment_required || state.transfer.quote.enrollment_included)
      state.enrollmentStatus = "active";
    state.credits = state.transfer.quote.credits ?? 0;
    return result({
      ok: true,
      status: "provisional_active",
      package_name: state.transfer.quote.package.name,
      enrollment_paid: state.transfer.quote.enrollment_required,
      enrollment_included: state.transfer.quote.enrollment_included,
      revocable_until_validated: true,
      instruction:
        "Perfil y paquete activados sólo en la simulación. La transferencia queda pendiente de validación definitiva; no afirmes pago validado.",
    });
  }
  if (
    tool === "prepare_booking" &&
    isFirstVisitPersona(state.persona) &&
    state.reservations.length > 0
  ) {
    return result({
      ok: false,
      error: "trial_reservation_exists",
      reason_code: "trial_reservation_exists",
      reason_message:
        "Ya tienes una clase de prueba reservada. Puedes modificar o cancelar esa reserva, pero no crear otra hasta completar tu inscripción.",
    });
  }
  if (tool === "prepare_booking" && state.persona === "former_student") {
    return result({
      ok: false,
      error: "enrollment_required",
      reason_code: "enrollment_required",
      reason_message:
        "Tu inscripción está vencida. Puedes renovar la inscripción por separado o elegir un paquete que la incluya. Después podrás reservar una clase.",
    });
  }
  if (
    tool === "prepare_booking" &&
    state.identityNeedsName &&
    state.paymentBeforeBooking !== true
  ) {
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

  // CRM stage only: validates like the real tool but never schedules or sends follow-ups.
  if (tool === "update_contact_followup") {
    const stage = String(args.stage ?? "");
    const reason = typeof args.reason === "string" ? args.reason.trim() : "";
    if (!FOLLOWUP_STAGES.has(stage)) return result({ ok: false, error: "invalid_stage" });
    if (stage === "not_qualified" && !reason)
      return result({ ok: false, error: "reason_required" });
    if (state.persona !== "prospect" && !state.persona.startsWith("trial_"))
      return result({ ok: false, error: "followup_not_applicable" });
    return result({
      ok: true,
      status: "simulated",
      stage,
      reason: reason || null,
      reason_message: "Etapa simulada; no se programan ni envían seguimientos reales.",
    });
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
