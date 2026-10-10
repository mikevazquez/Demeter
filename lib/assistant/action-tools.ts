import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getCommercialOptions, type AssistantStudioContext } from "./read-tools";
import { groupBookingAction } from "./group-booking";
import type {
  ExecuteBookingArgs,
  ExecuteCancellationArgs,
  ExecuteRescheduleArgs,
  ExecuteWaitlistJoinArgs,
  PrepareBookingArgs,
  PrepareCancellationArgs,
  PrepareRescheduleArgs,
  PrepareWaitlistJoinArgs,
  RecordTrialPaymentPreferenceArgs,
  PrepareStudentAccessActivationArgs,
  SelectResourceOptionArgs,
  PrepareBankTransferPurchaseArgs,
  PrepareTransferPackageChoiceArgs,
} from "./tool-contracts";

type AssistantActionToolContext = {
  supabase: SupabaseClient;
  studio: AssistantStudioContext;
  conversationId: string;
  turnId: string;
  studentId: string | null;
  crmContactId: string | null;
  identityNeedsName?: boolean;
  channel?: string;
  activationUrl: string | null;
  serviceMode?: boolean;
  currentUserMessage: string;
};

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function studentAuthEmailFromPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) return null;
  return `student.${digits}@auth.studioflow.invalid`;
}

function buildStudentActivationLink(baseUrl: string, tokenHash: string) {
  const activationLink = new URL(baseUrl);
  activationLink.searchParams.set("token_hash", tokenHash);
  activationLink.searchParams.set("type", "recovery");
  return activationLink.toString();
}

async function provisionStudentAccessWithServiceClient(
  ctx: AssistantActionToolContext,
  studentId: string,
  mode: "provision" | "resend",
) {
  if (!ctx.activationUrl) {
    return {
      generated: false,
      error: "activation_url_unavailable",
      activation_url: null as string | null,
    };
  }

  const { data: student, error: studentError } = await ctx.supabase
    .from("students")
    .select("id,user_id,phone,full_name,active,lifecycle_status")
    .eq("id", studentId)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  if (studentError || !student) {
    return {
      generated: false,
      error: "student_access_lookup_failed",
      activation_url: null as string | null,
    };
  }

  if (!student.active || student.lifecycle_status !== "active") {
    return {
      generated: false,
      error: "student_not_active",
      activation_url: null as string | null,
    };
  }

  const authEmail = studentAuthEmailFromPhone(String(student.phone ?? ""));
  if (!authEmail) {
    return {
      generated: false,
      error: "student_phone_invalid",
      activation_url: null as string | null,
    };
  }

  let userId = student.user_id as string | null;

  if (!userId) {
    const internalPassword = `Sf!${randomUUID()}A9`;
    const { data: created, error: createError } = await ctx.supabase.auth.admin.createUser({
      email: authEmail,
      password: internalPassword,
      email_confirm: true,
      user_metadata: {
        full_name: student.full_name,
        login_phone: student.phone,
      },
    });

    if (createError || !created.user) {
      return {
        generated: false,
        error: "auth_create_failed",
        activation_url: null as string | null,
      };
    }

    userId = created.user.id;

    const { error: linkError } = await ctx.supabase.rpc("service_link_student_access", {
      target_student_id: studentId,
      target_user_id: userId,
    });

    if (linkError) {
      await ctx.supabase.auth.admin.deleteUser(userId);
      return {
        generated: false,
        error: "student_access_link_failed",
        activation_url: null as string | null,
      };
    }
  } else if (mode === "provision") {
    return {
      generated: false,
      already_has_access: true,
      activation_url: null as string | null,
    };
  }

  const { data: activationData, error: activationError } =
    await ctx.supabase.auth.admin.generateLink({
      type: "recovery",
      email: authEmail,
      options: { redirectTo: ctx.activationUrl },
    });

  if (activationError || !activationData.properties?.action_link) {
    return {
      generated: false,
      error: "activation_link_failed",
      activation_url: null as string | null,
    };
  }

  const generatedActionLink = new URL(activationData.properties.action_link);
  const tokenHash = generatedActionLink.searchParams.get("token");
  if (!tokenHash) {
    return {
      generated: false,
      error: "activation_link_failed",
      activation_url: null as string | null,
    };
  }

  return {
    generated: true,
    already_has_access: false,
    activation_url: buildStudentActivationLink(ctx.activationUrl, tokenHash),
  };
}

function parseOpaqueRef(value: unknown, prefix: string) {
  const raw = String(value ?? "").trim();
  const match = raw.match(
    new RegExp(
      `^${prefix}:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$`,
      "i",
    ),
  );
  return match?.[1] ?? null;
}

function localParts(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    date: `${map.get("year")}-${map.get("month")}-${map.get("day")}`,
    time: `${map.get("hour")}:${map.get("minute")}`,
  };
}

function normalizeConfirmation(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isExplicitAssistantConfirmation(value: string) {
  if (!value.trim() || value.includes("?")) return false;

  const normalized = normalizeConfirmation(value);
  if (!normalized) return false;

  const accepted = new Set([
    "si",
    "si por favor",
    "si confirmo",
    "si confirmo la reserva",
    "si confirmo esa reserva",
    "confirmo esa reserva",
    "si confirmo esta reserva",
    "confirmo esta reserva",
    "si confirmo la compra",
    "si confirmo la compra del paquete",
    "si confirmo la compra del paquete en efectivo",
    "confirmo la compra",
    "confirmo la reserva",
    "si confirma la reserva",
    "si reservame esa clase",
    "si preparame los datos para transferir",
    "si prepara los datos para transferir",
    "si enviame los datos para transferir",
    "confirmo",
    "confirmado",
    "confirma",
    "confirmala",
    "si cancelala",
    "cancelala",
    "si cancelalo",
    "cancelalo",
    "si reagendala",
    "reagendala",
    "si reagendalo",
    "reagendalo",
    "si muevela",
    "muevela",
    "adelante",
    "hazlo",
    "reservala",
    "reserva",
    "dale",
    "va",
    "ok",
    "okay",
    "de acuerdo",
    "correcto",
  ]);

  return accepted.has(normalized);
}

export function isExplicitCashPurchaseConfirmation(
  value: string,
  summary?: { amount_minor?: number; product_name?: string },
) {
  if (isExplicitAssistantConfirmation(value)) return true;
  if (!value.trim() || /[?¿]/.test(value)) return false;
  const normalized = normalizeConfirmation(value);
  const match = normalized.match(
    /^(?:si )?confirmo la compra del paquete(?: de (\d+) clases)?(?: por (\d+)(?: (\d{1,2}))?(?: mxn| pesos)?)? en efectivo$/,
  );
  if (!match) return false;
  if (summary && match[2]) {
    const amountMinor = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
    if (amountMinor !== summary.amount_minor) return false;
  }
  if (summary && match[1]) {
    const packageClasses = normalizeConfirmation(summary.product_name ?? "").match(/(\d+) clases/);
    if (!packageClasses || packageClasses[1] !== match[1]) return false;
  }
  return true;
}

const BOOKING_REASON_MESSAGES: Record<string, string> = {
  session_not_found: "La clase ya no está disponible.",
  student_not_found: "No pude identificar a la alumna.",
  student_not_operable: "La cuenta no está habilitada para reservar.",
  session_not_bookable: "La clase ya no admite nuevas reservas.",
  already_reserved: "Ya existe una reserva para esa clase.",
  document_required: "Hay un documento pendiente antes de poder reservar.",
  enrollment_required: "Hace falta completar la inscripción requerida.",
  payment_pending: "Hay un pago pendiente que bloquea nuevas reservas.",
  no_active_product: "No hay un paquete o membresía vigente que cubra la clase.",
  outside_product: "El paquete vigente no aplica para esta actividad.",
  outside_product_schedule: "El paquete vigente no aplica para este horario.",
  session_full: "La clase ya está llena.",
  no_credits: "No hay créditos suficientes para reservar.",
  resource_required: "Esta clase requiere seleccionar un recurso.",
  resource_not_available: "El recurso seleccionado ya no está disponible.",
  resource_full: "El recurso seleccionado ya no tiene disponibilidad.",
  resource_unavailable: "No hay recursos disponibles para esta clase.",
  account_restricted: "La cuenta tiene una restricción que impide reservar.",
  trial_active_booking_exists:
    "Ya tienes una clase de prueba reservada. Solo puedes tener una reserva de prueba activa a la vez.",
  trial_completed_enrollment_required:
    "Ya asististe a tu primera clase de prueba. Para volver a reservar necesitas completar la inscripción.",
  trial_credit_payment_required:
    "El crédito de prueba anterior ya se consumió o venció. Necesitas un pago nuevo para volver a reservar; el pago anterior no se puede reutilizar.",
  trial_credit_requires_standard_booking:
    "La clase debe reservarse con el crédito de prueba vigente, sin crear otra excepción de pago.",
  trial_prepayment_required:
    "Como en dos ocasiones anteriores reservaste una clase y no pudiste asistir, para volver a agendar necesitamos el pago anticipado de la siguiente clase.",
};

function safeBookingReason(reason: unknown) {
  const code = String(reason ?? "booking_not_eligible");
  return {
    reason_code: code,
    reason_message:
      BOOKING_REASON_MESSAGES[code] ?? "Studio Flow indicó que esta reserva no puede realizarse.",
  };
}

async function getSessionSummary(ctx: AssistantActionToolContext, sessionId: string) {
  const { data: session, error: sessionError } = await ctx.supabase
    .from("class_sessions")
    .select("id,template_id,starts_at,ends_at,status,requires_resource,location_id,space_id")
    .eq("id", sessionId)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  if (sessionError || !session) return null;

  const [{ data: template }, { data: location }, { data: space }] = await Promise.all([
    ctx.supabase
      .from("class_templates")
      .select("name,credit_cost,drop_in_price_minor")
      .eq("id", session.template_id)
      .eq("studio_id", ctx.studio.id)
      .maybeSingle(),
    session.location_id
      ? ctx.supabase
          .from("studio_locations")
          .select("name")
          .eq("id", session.location_id)
          .eq("studio_id", ctx.studio.id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    session.space_id
      ? ctx.supabase
          .from("spaces")
          .select("name")
          .eq("id", session.space_id)
          .eq("studio_id", ctx.studio.id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const start = localParts(session.starts_at, ctx.studio.timezone);
  const end = localParts(session.ends_at, ctx.studio.timezone);

  return {
    session,
    summary: {
      activity: template?.name ?? "Clase",
      date: start.date,
      starts_at_local: start.time,
      ends_at_local: end.time,
      credit_cost: Math.max(Number(template?.credit_cost ?? 1), 1),
      drop_in_price_minor:
        template?.drop_in_price_minor == null ? null : Number(template.drop_in_price_minor),
      currency: ctx.studio.currency,
      location: location?.name ?? null,
      space: space?.name ?? null,
      timezone: ctx.studio.timezone,
    },
  };
}

type AssistantResourceOption = {
  option_number: number;
  resource_id: string;
  label: string;
  short_label: string | null;
  type_name: string | null;
};

async function getAvailableResourceOptions(
  ctx: AssistantActionToolContext,
  sessionId: string,
): Promise<
  | { ok: true; requires_resource: false; options: AssistantResourceOption[] }
  | { ok: true; requires_resource: true; options: AssistantResourceOption[] }
  | { ok: false; error: string }
> {
  const { data: session, error: sessionError } = await ctx.supabase
    .from("class_sessions")
    .select("id,requires_resource,space_id,resource_uses_per_item")
    .eq("id", sessionId)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  if (sessionError || !session) {
    return { ok: false, error: "session_not_found" };
  }

  if (!session.requires_resource) {
    return { ok: true, requires_resource: false, options: [] };
  }

  if (!session.space_id) {
    return { ok: true, requires_resource: true, options: [] };
  }

  if (!ctx.serviceMode) {
    const { data, error } = await ctx.supabase.rpc("student_session_resource_map", {
      target_session_id: sessionId,
    });
    const result = asObject(data);
    if (error || !result) {
      return { ok: false, error: "resource_options_unavailable" };
    }

    const resources = Array.isArray(result.resources) ? result.resources : [];
    const available = resources
      .map((item) => asObject(item))
      .filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && item!.enabled === true && Number(item!.available ?? 0) > 0,
      )
      .map((item) => ({
        resource_id: String(item.resource_id ?? ""),
        label: String(item.name ?? "").trim() || String(item.short_label ?? "").trim() || "Recurso",
        short_label: typeof item.short_label === "string" ? item.short_label : null,
        type_name: typeof item.type_name === "string" ? item.type_name : null,
      }))
      .filter((item) => Boolean(item.resource_id))
      .sort((a, b) => a.label.localeCompare(b.label, "es-MX"))
      .map((item, index) => ({ ...item, option_number: index + 1 }));

    return { ok: true, requires_resource: true, options: available };
  }

  const { data: settings, error: settingsError } = await ctx.supabase
    .from("session_resources")
    .select("resource_id,enabled,capacity_override")
    .eq("studio_id", ctx.studio.id)
    .eq("session_id", sessionId);

  if (settingsError) {
    return { ok: false, error: "resource_options_unavailable" };
  }

  const enabledSettings = (settings ?? []).filter((item) => item.enabled);
  const resourceIds = enabledSettings.map((item) => item.resource_id);
  if (!resourceIds.length) {
    return { ok: true, requires_resource: true, options: [] };
  }

  const [resourcesResult, assignmentsResult] = await Promise.all([
    ctx.supabase
      .from("resources")
      .select("id,name,short_label,resource_type_id,active")
      .eq("studio_id", ctx.studio.id)
      .eq("space_id", session.space_id)
      .eq("active", true)
      .in("id", resourceIds),
    ctx.supabase
      .from("reservation_resource_assignments")
      .select("resource_id")
      .eq("studio_id", ctx.studio.id)
      .eq("session_id", sessionId)
      .is("released_at", null)
      .in("resource_id", resourceIds),
  ]);

  if (resourcesResult.error || assignmentsResult.error) {
    return { ok: false, error: "resource_options_unavailable" };
  }

  const resources = resourcesResult.data ?? [];
  const typeIds = [
    ...new Set(resources.map((item) => item.resource_type_id).filter(Boolean)),
  ] as string[];
  const { data: types, error: typesError } = typeIds.length
    ? await ctx.supabase
        .from("resource_types")
        .select("id,name")
        .eq("studio_id", ctx.studio.id)
        .in("id", typeIds)
    : { data: [], error: null };

  if (typesError) {
    return { ok: false, error: "resource_options_unavailable" };
  }

  const typeMap = new Map((types ?? []).map((item) => [item.id, item.name]));
  const used = new Map<string, number>();
  for (const assignment of assignmentsResult.data ?? []) {
    used.set(assignment.resource_id, (used.get(assignment.resource_id) ?? 0) + 1);
  }

  const settingMap = new Map(enabledSettings.map((item) => [item.resource_id, item]));

  const available = resources
    .filter((resource) => {
      const setting = settingMap.get(resource.id);
      const capacity = Math.max(
        Number(setting?.capacity_override ?? session.resource_uses_per_item ?? 1),
        1,
      );
      return (used.get(resource.id) ?? 0) < capacity;
    })
    .map((resource) => ({
      resource_id: resource.id,
      label:
        String(resource.name ?? "").trim() ||
        String(resource.short_label ?? "").trim() ||
        "Recurso",
      short_label: resource.short_label ?? null,
      type_name: resource.resource_type_id
        ? (typeMap.get(resource.resource_type_id) ?? null)
        : null,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "es-MX"))
    .map((item, index) => ({ ...item, option_number: index + 1 }));

  return { ok: true, requires_resource: true, options: available };
}

async function createResourceSelectionPending(
  ctx: AssistantActionToolContext,
  input: {
    actionType: "booking.create" | "booking.reschedule";
    sessionId: string;
    payload: Record<string, unknown>;
    summary: Record<string, unknown>;
  },
) {
  const resourceResult = await getAvailableResourceOptions(ctx, input.sessionId);
  if (!resourceResult.ok) return resourceResult;
  if (!resourceResult.requires_resource) {
    return { ok: false, error: "resource_not_required" };
  }
  if (!resourceResult.options.length) {
    return {
      ok: false,
      error: "resource_unavailable",
      reason_code: "resource_unavailable",
      reason_message: "La clase requiere un recurso, pero ahora mismo no hay ninguno disponible.",
    };
  }

  const now = new Date().toISOString();
  await ctx.supabase
    .from("assistant_pending_actions")
    .update({ status: "cancelled", updated_at: now })
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", input.actionType)
    .eq("status", "pending");

  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const secretToken = randomUUID();
  const tokenHash = createHash("sha256").update(secretToken).digest("hex");
  const safeOptions = resourceResult.options.map((option) => ({
    option_number: option.option_number,
    label: option.label,
    short_label: option.short_label,
    type_name: option.type_name,
  }));

  const { data: pending, error: pendingError } = await ctx.supabase
    .from("assistant_pending_actions")
    .insert({
      studio_id: ctx.studio.id,
      conversation_id: ctx.conversationId,
      action_type: input.actionType,
      action_token_hash: tokenHash,
      action_payload: {
        ...input.payload,
        stage: "resource_selection",
        prepared_turn_id: ctx.turnId,
        resource_options: resourceResult.options.map((option) => ({
          option_number: option.option_number,
          resource_id: option.resource_id,
          label: option.label,
          short_label: option.short_label,
          type_name: option.type_name,
        })),
      },
      confirmation_summary: {
        ...input.summary,
        resource_selection_required: true,
        resource_options: safeOptions,
      },
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (pendingError || !pending) {
    return { ok: false, error: "pending_action_create_failed" };
  }

  return {
    ok: true,
    status: "resource_selection_required",
    expires_at: expiresAt,
    resource_options: safeOptions,
    summary: {
      ...input.summary,
      resource_selection_required: true,
      resource_options: safeOptions,
    },
  };
}

async function getDemiTrialPrepaymentRequirement(ctx: AssistantActionToolContext) {
  const [
    { data: studioPolicy, error: studioPolicyError },
    { data: demiBehavior, error: demiBehaviorError },
  ] = await Promise.all([
    ctx.supabase
      .from("trial_booking_policies")
      .select("require_payment_before_booking")
      .eq("studio_id", ctx.studio.id)
      .maybeSingle(),
    ctx.supabase
      .from("assistant_booking_behaviors")
      .select("prospect_require_payment_before_booking")
      .eq("studio_id", ctx.studio.id)
      .maybeSingle(),
  ]);

  if (studioPolicyError || demiBehaviorError) {
    return { ok: false as const, error: "trial_booking_policy_unavailable" };
  }

  const studioRequiresPayment = studioPolicy?.require_payment_before_booking === true;
  const demiRequiresPayment = demiBehavior?.prospect_require_payment_before_booking === true;

  return {
    ok: true as const,
    studioRequiresPayment,
    demiRequiresPayment,
    effectiveRequiresPayment: studioRequiresPayment || demiRequiresPayment,
  };
}

function isSessionBookableNow(session: { status: string; starts_at: string }, now = Date.now()) {
  return (
    session.status === "scheduled" && new Date(session.starts_at).getTime() > now + 30 * 60_000
  );
}

async function prepareCashPackage(ctx: AssistantActionToolContext, args: Record<string, unknown>) {
  const product = parseOpaqueRef(args.product_ref, "product");
  if (!ctx.serviceMode || !ctx.studentId || !product)
    return { ok: false, reason_code: "cash_students_only" };
  const { data: student } = await ctx.supabase
    .from("students")
    .select("student_type,active,lifecycle_status")
    .eq("studio_id", ctx.studio.id)
    .eq("id", ctx.studentId)
    .maybeSingle();
  const { data: item } = await ctx.supabase
    .from("product_templates")
    .select("id,name,price_minor,currency,product_type")
    .eq("studio_id", ctx.studio.id)
    .eq("id", product)
    .eq("active", true)
    .eq("assistant_visible", true)
    .maybeSingle();
  if (
    !student?.active ||
    student.lifecycle_status !== "active" ||
    student.student_type !== "regular" ||
    !item ||
    !["package", "membership"].includes(item.product_type) ||
    item.price_minor <= 0
  )
    return { ok: false, reason_code: "cash_package_not_available" };
  const { data: method } = await ctx.supabase
    .from("studio_payment_methods")
    .select("code")
    .eq("studio_id", ctx.studio.id)
    .eq("code", "cash")
    .eq("active", true)
    .maybeSingle();
  if (!method) return { ok: false, reason_code: "cash_payment_disabled" };
  const summary = {
    product_name: item.name,
    amount_minor: item.price_minor,
    currency: item.currency,
    payment_received: false,
    first_reservation_allowed: true,
    second_reservation_requires_payment: true,
    starts_with_first_reservation: true,
  };
  const expires = new Date(Date.now() + 600000).toISOString();
  const { error: cancelError } = await ctx.supabase
    .from("assistant_pending_actions")
    .update({ status: "cancelled" })
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "commerce.cash_purchase")
    .eq("status", "pending");
  if (cancelError) return { ok: false, reason_code: "pending_action_update_failed" };
  const { error } = await ctx.supabase.from("assistant_pending_actions").insert({
    studio_id: ctx.studio.id,
    conversation_id: ctx.conversationId,
    action_type: "commerce.cash_purchase",
    action_token_hash: createHash("sha256").update(randomUUID()).digest("hex"),
    action_payload: {
      student_id: ctx.studentId,
      product_id: product,
      expected_amount: item.price_minor,
      prepared_turn_id: ctx.turnId,
    },
    confirmation_summary: summary,
    status: "pending",
    expires_at: expires,
  });
  return error
    ? { ok: false, reason_code: "pending_action_create_failed" }
    : { ok: true, status: "confirmation_required", summary, expires_at: expires };
}

async function confirmCashPackage(ctx: AssistantActionToolContext) {
  if (!ctx.serviceMode || !ctx.studentId)
    return { ok: false, reason_code: "explicit_confirmation_required" };
  const { data: pending, error } = await ctx.supabase
    .from("assistant_pending_actions")
    .select("id,status,action_payload,confirmation_summary,expires_at")
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "commerce.cash_purchase")
    .in("status", ["pending", "executed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const payload = asObject(pending?.action_payload);
  if (
    error ||
    !pending ||
    !payload ||
    payload.student_id !== ctx.studentId ||
    payload.prepared_turn_id === ctx.turnId ||
    (pending.status === "pending" && Date.parse(pending.expires_at) <= Date.now())
  )
    return { ok: false, reason_code: "cash_confirmation_unavailable" };
  const summary = asObject(pending.confirmation_summary);
  if (
    !isExplicitCashPurchaseConfirmation(ctx.currentUserMessage, {
      amount_minor: Number(summary?.amount_minor ?? payload.expected_amount),
      product_name: String(summary?.product_name ?? ""),
    })
  )
    return { ok: false, reason_code: "explicit_confirmation_required" };
  const { data: result, error: purchaseError } = await ctx.supabase.rpc(
    "service_create_demi_cash_purchase",
    {
      p_studio: ctx.studio.id,
      p_conversation: ctx.conversationId,
      p_student: ctx.studentId,
      p_product: payload.product_id,
      p_key: pending.id,
      p_expected_amount: payload.expected_amount,
    },
  );
  if (purchaseError) return { ok: false, reason_code: "cash_purchase_failed" };
  if (result?.ok)
    await ctx.supabase
      .from("assistant_pending_actions")
      .update({ status: "executed", updated_at: new Date().toISOString() })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id);
  return result;
}

async function prepareBooking(ctx: AssistantActionToolContext, args: PrepareBookingArgs) {
  if (
    ctx.serviceMode &&
    !ctx.studentId &&
    ["facebook_messenger", "instagram"].includes(ctx.channel ?? "")
  ) {
    const identity = await ctx.supabase.rpc("service_check_demi_minimal_identity", {
      p_studio: ctx.studio.id,
      p_conversation: ctx.conversationId,
    });
    if (identity.error || identity.data?.ok !== true)
      return identity.error ? { ok: false, reason_code: "identity_lookup_failed" } : identity.data;
  }
  const sessionId = parseOpaqueRef(args.session_ref, "session");
  if (!sessionId) {
    return { ok: false, error: "invalid_session_ref" };
  }

  const sessionInfo = await getSessionSummary(ctx, sessionId);
  if (!sessionInfo) {
    return { ok: false, error: "session_not_found" };
  }
  if (!isSessionBookableNow(sessionInfo.session)) {
    return {
      ok: false,
      error: "booking_not_eligible",
      ...safeBookingReason("session_not_bookable"),
    };
  }

  const studentId = ctx.studentId;
  let resolvedStudentType: string | null = null;

  if (studentId) {
    const { data: student } = await ctx.supabase
      .from("students")
      .select("student_type")
      .eq("id", studentId)
      .eq("studio_id", ctx.studio.id)
      .maybeSingle();
    resolvedStudentType = student?.student_type ?? null;
  }

  let hasPaidTrialCredit = false;
  if (studentId && resolvedStudentType === "trial") {
    const { data: paidTrials, error: paidCreditError } = await ctx.supabase
      .from("assistant_transfer_purchase_intents")
      .select("acquisition_id")
      .eq("studio_id", ctx.studio.id)
      .eq("student_id", studentId)
      .eq("intent_kind", "trial_class")
      .in("status", ["provisional_active", "validated"])
      .not("acquisition_id", "is", null)
      .limit(1);
    if (paidCreditError) return { ok: false, error: "trial_credit_unavailable" };
    if (paidTrials?.length) {
      const creditEligibility = ctx.serviceMode
        ? await ctx.supabase.rpc("service_booking_eligibility", {
            target_studio_id: ctx.studio.id,
            target_session_id: sessionId,
            target_student_id: studentId,
          })
        : await ctx.supabase.rpc("booking_eligibility", {
            target_session_id: sessionId,
            target_student_id: studentId,
          });
      if (creditEligibility.error) return { ok: false, error: "trial_credit_unavailable" };
      hasPaidTrialCredit = asObject(creditEligibility.data)?.eligible === true;
    }
  }
  const shouldEvaluateTrial =
    Boolean(ctx.crmContactId && !studentId) ||
    (resolvedStudentType === "trial" && !hasPaidTrialCredit);

  if (shouldEvaluateTrial) {
    const prepaymentPolicy = await getDemiTrialPrepaymentRequirement(ctx);
    if (!prepaymentPolicy.ok) return prepaymentPolicy;

    const requirePaymentBeforeBooking = prepaymentPolicy.effectiveRequiresPayment;
    if (ctx.identityNeedsName === true && !studentId && !requirePaymentBeforeBooking) {
      return {
        ok: false,
        reason_code: "prospect_name_required",
        reason_message:
          "Antes de reservar, pide el nombre completo y espera a que Studio Flow lo guarde en el CRM.",
      };
    }

    const { data: preview, error: previewError } = await ctx.supabase.rpc(
      "assistant_trial_booking_preview",
      {
        target_studio_id: ctx.studio.id,
        target_session_id: sessionId,
        target_student_id: studentId,
        target_crm_contact_id: studentId ? null : ctx.crmContactId,
      },
    );

    if (previewError) {
      return { ok: false, error: "trial_booking_preview_unavailable" };
    }

    const previewObject = asObject(preview);
    const prepaidTrialOverridesLegacyNoShowBlock =
      requirePaymentBeforeBooking && previewObject?.reason_code === "trial_prepayment_required";

    if (
      !previewObject ||
      ((!previewObject.ok || previewObject.eligible !== true) &&
        !prepaidTrialOverridesLegacyNoShowBlock)
    ) {
      const reasonCode = String(previewObject?.reason_code ?? "booking_not_eligible");

      if (reasonCode === "trial_credit_payment_required" && studentId && ctx.serviceMode) {
        const prepared = await ctx.supabase.rpc("service_prepare_trial_transfer", {
          target_studio_id: ctx.studio.id,
          target_conversation_id: ctx.conversationId,
          target_student_id: studentId,
          target_session_id: sessionId,
          target_resource_id: null,
        });
        const payment = asObject(prepared.data);
        if (prepared.error || payment?.ok !== true) {
          return {
            ok: false,
            error: "trial_payment_setup_failed",
            ...safeBookingReason(payment?.reason_code),
          };
        }
        return {
          ok: true,
          status: "payment_required",
          reservation_confirmed: false,
          payment_required: true,
          previous_payment_reusable: false,
          ...safeBookingReason(reasonCode),
          intent_id: payment.intent_id,
          amount_minor: payment.amount_minor,
          currency: payment.currency,
          bank_details: payment.bank_details,
        };
      }

      if (reasonCode === "trial_prepayment_required") {
        return {
          ok: false,
          error: "prepayment_required",
          reason_code: reasonCode,
          reason_message: BOOKING_REASON_MESSAGES.trial_prepayment_required,
          prepayment_required: true,
          no_show_count: Number(previewObject?.no_show_count ?? 2),
          prepayment_threshold: Number(previewObject?.prepayment_threshold ?? 2),
          amount_minor:
            previewObject?.amount_minor == null
              ? sessionInfo.summary.drop_in_price_minor
              : Number(previewObject.amount_minor),
          currency: String(previewObject?.currency ?? ctx.studio.currency),
        };
      }

      if (reasonCode === "trial_completed_enrollment_required" && studentId) {
        const { data: requirementData, error: requirementError } = await ctx.supabase.rpc(
          "assistant_post_trial_requirement",
          {
            target_studio_id: ctx.studio.id,
            target_student_id: studentId,
          },
        );

        const requirement = asObject(requirementData);
        if (requirementError || !requirement || requirement.ok !== true) {
          return { ok: false, error: "post_trial_requirement_unavailable" };
        }

        const now = new Date().toISOString();
        await ctx.supabase
          .from("assistant_pending_actions")
          .update({ status: "cancelled", updated_at: now })
          .eq("studio_id", ctx.studio.id)
          .eq("conversation_id", ctx.conversationId)
          .eq("action_type", "enrollment.resolve")
          .eq("status", "pending");

        const secretToken = randomUUID();
        const tokenHash = createHash("sha256").update(secretToken).digest("hex");
        const expiresAt = new Date(Date.now() + 20 * 60_000).toISOString();

        const { error: pendingError } = await ctx.supabase
          .from("assistant_pending_actions")
          .insert({
            studio_id: ctx.studio.id,
            conversation_id: ctx.conversationId,
            action_type: "enrollment.resolve",
            action_token_hash: tokenHash,
            action_payload: {
              session_id: sessionId,
              student_id: studentId,
              prepared_turn_id: ctx.turnId,
            },
            confirmation_summary: {
              ...requirement,
              target_session: sessionInfo.summary,
            },
            status: "pending",
            expires_at: expiresAt,
          });

        if (pendingError) {
          return { ok: false, error: "pending_action_create_failed" };
        }

        return {
          ok: true,
          status: "payment_method_required",
          expires_at: expiresAt,
          summary: {
            ...requirement,
            target_session: sessionInfo.summary,
          },
        };
      }

      return {
        ok: false,
        error: "booking_not_eligible",
        ...safeBookingReason(reasonCode),
      };
    }

    const confirmationSummary = {
      ...sessionInfo.summary,
      commercial_status: "payment_pending",
      payment_pending: true,
      trial_booking: true,
      payment_before_booking: requirePaymentBeforeBooking,
      no_show_count: Number(previewObject.no_show_count ?? 0),
      prepayment_threshold: Number(previewObject.prepayment_threshold ?? 2),
      amount_minor:
        previewObject.amount_minor == null
          ? sessionInfo.summary.drop_in_price_minor
          : Number(previewObject.amount_minor),
      currency: String(previewObject.currency ?? ctx.studio.currency),
      enrollment_required_now: false,
    };

    if (sessionInfo.session.requires_resource) {
      return createResourceSelectionPending(ctx, {
        actionType: "booking.create",
        sessionId,
        payload: {
          session_id: sessionId,
          student_id: studentId,
          crm_contact_id: studentId ? null : ctx.crmContactId,
          trial_exception: true,
          commercial_pending: true,
        },
        summary: confirmationSummary,
      });
    }

    const now = new Date().toISOString();
    await ctx.supabase
      .from("assistant_pending_actions")
      .update({ status: "cancelled", updated_at: now })
      .eq("studio_id", ctx.studio.id)
      .eq("conversation_id", ctx.conversationId)
      .eq("action_type", "booking.create")
      .eq("status", "pending");

    const secretToken = randomUUID();
    const tokenHash = createHash("sha256").update(secretToken).digest("hex");
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

    const { data: pending, error: pendingError } = await ctx.supabase
      .from("assistant_pending_actions")
      .insert({
        studio_id: ctx.studio.id,
        conversation_id: ctx.conversationId,
        action_type: "booking.create",
        action_token_hash: tokenHash,
        action_payload: {
          session_id: sessionId,
          student_id: studentId,
          crm_contact_id: studentId ? null : ctx.crmContactId,
          trial_exception: true,
          commercial_pending: true,
          prepared_turn_id: ctx.turnId,
        },
        confirmation_summary: confirmationSummary,
        status: "pending",
        expires_at: expiresAt,
      })
      .select("id")
      .single();

    if (pendingError || !pending) {
      return { ok: false, error: "pending_action_create_failed" };
    }

    return {
      ok: true,
      status: "confirmation_required",
      expires_at: expiresAt,
      summary: confirmationSummary,
    };
  }

  if (!studentId) {
    return { ok: false, error: "identity_required" };
  }

  const eligibilityRequest = ctx.serviceMode
    ? await ctx.supabase.rpc("service_booking_eligibility", {
        target_studio_id: ctx.studio.id,
        target_session_id: sessionId,
        target_student_id: studentId,
      })
    : await ctx.supabase.rpc("booking_eligibility", {
        target_session_id: sessionId,
        target_student_id: studentId,
      });
  const { data: eligibility, error: eligibilityError } = eligibilityRequest;

  if (eligibilityError) {
    return { ok: false, error: "booking_eligibility_unavailable" };
  }

  const eligibilityObject = asObject(eligibility);
  const eligibilityReason = String(eligibilityObject?.reason_code ?? "");

  if (!eligibilityObject || eligibilityObject.eligible !== true) {
    const safeReason = safeBookingReason(eligibilityReason);
    return {
      ok: false,
      error: ["document_required", "birth_date_required", "guardian_required"].includes(
        eligibilityReason,
      )
        ? "onboarding_required"
        : "booking_not_eligible",
      onboarding_required: [
        "document_required",
        "birth_date_required",
        "guardian_required",
      ].includes(eligibilityReason),
      ...safeReason,
    };
  }

  const confirmationSummary = {
    ...sessionInfo.summary,
    commercial_status: "package_covered",
    payment_pending: false,
    trial_booking: false,
  };

  if (sessionInfo.session.requires_resource) {
    return createResourceSelectionPending(ctx, {
      actionType: "booking.create",
      sessionId,
      payload: {
        session_id: sessionId,
        student_id: studentId,
        trial_exception: false,
        commercial_pending: false,
      },
      summary: confirmationSummary,
    });
  }

  const now = new Date().toISOString();
  await ctx.supabase
    .from("assistant_pending_actions")
    .update({ status: "cancelled", updated_at: now })
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "booking.create")
    .eq("status", "pending");

  const secretToken = randomUUID();
  const tokenHash = createHash("sha256").update(secretToken).digest("hex");
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

  const { data: pending, error: pendingError } = await ctx.supabase
    .from("assistant_pending_actions")
    .insert({
      studio_id: ctx.studio.id,
      conversation_id: ctx.conversationId,
      action_type: "booking.create",
      action_token_hash: tokenHash,
      action_payload: {
        session_id: sessionId,
        student_id: studentId,
        trial_exception: false,
        commercial_pending: false,
        prepared_turn_id: ctx.turnId,
      },
      confirmation_summary: confirmationSummary,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (pendingError || !pending) {
    return { ok: false, error: "pending_action_create_failed" };
  }

  return {
    ok: true,
    status: "confirmation_required",
    expires_at: expiresAt,
    summary: confirmationSummary,
  };
}

async function provisionTrialActivationLink(ctx: AssistantActionToolContext, studentId: string) {
  if (ctx.serviceMode) {
    return provisionStudentAccessWithServiceClient(ctx, studentId, "provision");
  }

  if (!ctx.activationUrl) {
    return {
      generated: false,
      error: "activation_url_unavailable",
      activation_url: null as string | null,
    };
  }

  const { data: student, error: studentError } = await ctx.supabase
    .from("students")
    .select("user_id")
    .eq("id", studentId)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  if (studentError || !student) {
    return {
      generated: false,
      error: "student_access_lookup_failed",
      activation_url: null as string | null,
    };
  }

  if (student.user_id) {
    return {
      generated: false,
      already_has_access: true,
      activation_url: null as string | null,
    };
  }

  const {
    data: { session },
  } = await ctx.supabase.auth.getSession();

  if (!session?.access_token) {
    return {
      generated: false,
      error: "activation_authorization_unavailable",
      activation_url: null as string | null,
    };
  }

  const { data, error } = await ctx.supabase.functions.invoke("provision-student-access", {
    body: {
      studentId,
      activationUrl: ctx.activationUrl,
      delivery: "return_link",
    },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  const response = asObject(data);
  const activationUrl =
    typeof response?.activationLink === "string" ? String(response.activationLink) : null;

  if (error || !response || response.ok !== true || !activationUrl) {
    return {
      generated: false,
      error: String(response?.error ?? "activation_link_failed"),
      activation_url: null as string | null,
    };
  }

  return {
    generated: true,
    already_has_access: false,
    activation_url: activationUrl,
  };
}

async function prepareFirstClassPayment(
  ctx: AssistantActionToolContext,
  args: Record<string, unknown>,
) {
  if (
    args.recipient_mode === "other" ||
    /(?:s[oó]lo para otra persona|yo no asistir[eé]|no voy a asistir|no asisto|para mi (?:amiga|amigo|hermana|hermano|hija|hijo))/i.test(
      ctx.currentUserMessage,
    )
  )
    return { ok: false, reason_code: "use_prepare_group_booking_for_other_person" };
  if (!ctx.serviceMode || ctx.studentId || !ctx.crmContactId)
    return { ok: false, reason_code: "verified_prospect_required" };
  const sessionId = parseOpaqueRef(args.session_ref, "session");
  const resourceId = args.resource_ref ? parseOpaqueRef(args.resource_ref, "resource") : null;
  if (!sessionId || (args.resource_ref && !resourceId))
    return { ok: false, reason_code: "invalid_reference" };
  const policy = await getDemiTrialPrepaymentRequirement(ctx);
  if (!policy.ok) return policy;
  if (!policy.effectiveRequiresPayment) return { ok: false, reason_code: "use_prepare_booking" };
  const info = await getSessionSummary(ctx, sessionId);
  if (!info || !isSessionBookableNow(info.session))
    return { ok: false, ...safeBookingReason("session_not_bookable") };
  if (info.session.requires_resource && !resourceId) {
    const resources = await getAvailableResourceOptions(ctx, sessionId);
    if (!resources.ok) return resources;
    return {
      ok: false,
      reason_code: "resource_selection_required",
      resource_options:
        resources.options?.map((option) => ({
          resource_ref: `resource:${option.resource_id}`,
          label: option.label,
        })) ?? [],
    };
  }
  const bank = await ctx.supabase
    .from("studio_bank_transfer_settings")
    .select("bank_name,account_holder,clabe,account_number,card_number,instructions")
    .eq("studio_id", ctx.studio.id)
    .eq("enabled", true)
    .maybeSingle();
  const method = await ctx.supabase
    .from("studio_payment_methods")
    .select("code")
    .eq("studio_id", ctx.studio.id)
    .eq("code", "bank_transfer")
    .eq("active", true)
    .maybeSingle();
  const bankAvailable =
    !method.error &&
    Boolean(method.data) &&
    !bank.error &&
    Boolean(
      bank.data?.bank_name &&
      bank.data?.account_holder &&
      (bank.data?.clabe || bank.data?.account_number || bank.data?.card_number),
    );
  const options = await ctx.supabase.rpc("service_get_demi_first_class_payment_options", {
    p_studio: ctx.studio.id,
    p_session: sessionId,
  });
  const externalCheckout = !options.error
    ? asObject(asObject(options.data)?.external_checkout)
    : null;
  const autoSetting = await ctx.supabase
    .from("demi_mercadopago_settings")
    .select("enabled")
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();
  const automaticAvailable = !autoSetting.error && autoSetting.data?.enabled === true;
  const manualRequested = /transferencia|bancomer|bbva|oxxo|dep[oó]sito/i.test(
    ctx.currentUserMessage,
  );
  if (!bankAvailable && !externalCheckout && !automaticAvailable)
    return { ok: false, reason_code: "transfer_details_unavailable" };
  const prepared = await ctx.supabase.rpc("service_prepare_demi_prospect_payment", {
    p_studio: ctx.studio.id,
    p_conversation: ctx.conversationId,
    p_contact: ctx.crmContactId,
    p_session: sessionId,
    p_resource: resourceId,
  });
  const payment = asObject(prepared.data);
  if (prepared.error || payment?.ok !== true)
    return { ok: false, reason_code: payment?.reason_code ?? "trial_payment_setup_failed" };
  if (!["awaiting_receipt", "awaiting_participants"].includes(String(payment.status)))
    return { ok: false, reason_code: "payment_requires_review", reservation_confirmed: false };
  let automaticCheckout: Record<string, unknown> | null = null;
  if (automaticAvailable && !manualRequested && payment.status === "awaiting_receipt") {
    const order = await ctx.supabase.functions.invoke("create-demi-mercadopago-order", {
      body: {
        studio_id: ctx.studio.id,
        conversation_id: ctx.conversationId,
        group_id: payment.group_id,
      },
    });
    if (order.error || order.data?.ok !== true)
      return {
        ok: false,
        reason_code: order.data?.error ?? "automatic_checkout_unavailable",
        reservation_confirmed: false,
      };
    automaticCheckout = asObject(order.data.external_checkout);
  }
  const providerProof = await ctx.supabase
    .from("demi_payment_requests")
    .select("status")
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("group_id", payment.group_id)
    .maybeSingle();
  const paidAutomatically = !providerProof.error && providerProof.data?.status === "approved";
  const matchingCheckout =
    automaticCheckout ??
    (externalCheckout?.amount_minor === payment.amount_minor &&
    externalCheckout?.currency === payment.currency
      ? externalCheckout
      : null);
  if (!bankAvailable && !matchingCheckout)
    return {
      ok: false,
      reason_code: "external_checkout_amount_mismatch",
      reservation_confirmed: false,
    };
  return {
    ...payment,
    status:
      payment.status === "awaiting_receipt" && !paidAutomatically
        ? "payment_required"
        : "participant_data_required",
    reservation_confirmed: false,
    receipt_required: payment.status === "awaiting_receipt" && !automaticCheckout,
    payment_verified: paidAutomatically,
    bank_details: bankAvailable ? bank.data : null,
    external_checkout: matchingCheckout,
    summary: {
      ...info.summary,
      trial_booking: true,
      payment_before_booking: true,
      payment_pending: !paidAutomatically,
    },
  };
}

async function replayTrialPayment(
  ctx: AssistantActionToolContext,
  executionRef: string,
  summary: unknown,
) {
  const prospect = executionRef.startsWith("prospect-payment:");
  const id = executionRef.slice(executionRef.indexOf(":") + 1);
  const lookup = await ctx.supabase
    .from(prospect ? "demi_group_bookings" : "assistant_transfer_purchase_intents")
    .select(
      prospect
        ? "id,status,amount_minor,currency"
        : "id,status,amount_minor,currency,reservation_id",
    )
    .eq("id", id)
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .maybeSingle();
  const payment = asObject(lookup.data);
  if (lookup.error || !payment) return { ok: false, error: "payment_state_unavailable" };
  const paymentSummary = {
    ...(asObject(summary) ?? {}),
    trial_booking: true,
    payment_before_booking: true,
    payment_pending: payment.status !== "validated",
  };
  if (payment.status === "awaiting_receipt") {
    const bank = await ctx.supabase
      .from("studio_bank_transfer_settings")
      .select("bank_name,account_holder,clabe,account_number,card_number,instructions")
      .eq("studio_id", ctx.studio.id)
      .eq("enabled", true)
      .maybeSingle();
    if (bank.error || !bank.data)
      return { ok: false, error: "bank_transfer_details_not_configured" };
    return {
      ok: true,
      already_executed: true,
      status: "payment_required",
      reservation_confirmed: false,
      payment_required: true,
      amount_minor: payment.amount_minor,
      currency: payment.currency,
      bank_details: bank.data,
      summary: paymentSummary,
      ...(prospect ? { group_id: id, participant_count: 1 } : { intent_id: id }),
    };
  }
  if (prospect && payment.status === "awaiting_participants")
    return {
      ok: true,
      status: "participant_data_required",
      reservation_confirmed: false,
      group_id: id,
      participant_count: 1,
      summary: paymentSummary,
    };
  if (!["provisional", "provisional_active", "validated"].includes(String(payment.status)))
    return { ok: false, error: "payment_not_booked", reservation_confirmed: false };
  let reservationId = String(payment.reservation_id ?? "");
  if (prospect) {
    const participant = await ctx.supabase
      .from("demi_group_participants")
      .select("reservation_id")
      .eq("group_id", id)
      .maybeSingle();
    if (participant.error) return { ok: false, error: "reservation_state_unavailable" };
    reservationId = String(participant.data?.reservation_id ?? "");
  }
  if (!reservationId)
    return { ok: false, error: "payment_not_booked", reservation_confirmed: false };
  const reservation = await ctx.supabase
    .from("reservations")
    .select("id,status")
    .eq("id", reservationId)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();
  if (reservation.error || reservation.data?.status !== "reserved")
    return { ok: false, error: "reservation_not_active", reservation_confirmed: false };
  return {
    ok: true,
    status: "executed",
    already_executed: true,
    reservation_confirmed: true,
    reservation_ref: reservationId,
    summary: paymentSummary,
  };
}

async function executeBooking(ctx: AssistantActionToolContext, args: ExecuteBookingArgs) {
  let result: Awaited<ReturnType<typeof executeBookingOperation>>;
  try {
    result = await executeBookingOperation(ctx, args);
  } catch {
    result = { ok: false, error: "booking_execution_failed" };
  }
  const value = asObject(result);
  if (
    ctx.serviceMode &&
    value?.ok === false &&
    ["booking_execution_failed", "booking_eligibility_unavailable"].includes(String(value.error))
  ) {
    const { data: pending } = await ctx.supabase
      .from("assistant_pending_actions")
      .select("id")
      .eq("studio_id", ctx.studio.id)
      .eq("conversation_id", ctx.conversationId)
      .eq("action_type", "booking.create")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pending?.id) {
      const failure = await ctx.supabase.rpc("service_demi_booking_failure_status", {
        p_studio: ctx.studio.id,
        p_conversation: ctx.conversationId,
        p_pending: pending.id,
        p_turn: ctx.turnId,
        p_error: String(value.error),
      });
      if (!failure.error && failure.data?.ok)
        return {
          ...value,
          ...failure.data,
          ok: false,
          human_review_created: Boolean(failure.data.handoff_id),
        };
    }
  }
  return result;
}

async function executeBookingOperation(ctx: AssistantActionToolContext, args: ExecuteBookingArgs) {
  void args;

  const { data: pending, error: pendingError } = await ctx.supabase
    .from("assistant_pending_actions")
    .select("id,action_type,action_payload,confirmation_summary,status,expires_at,execution_ref")
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "booking.create")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingError || !pending) {
    return { ok: false, error: "pending_action_not_found" };
  }

  if (pending.status === "executed") {
    if (/^(prospect|trial)-payment:/.test(String(pending.execution_ref ?? "")))
      return replayTrialPayment(ctx, String(pending.execution_ref), pending.confirmation_summary);
    return {
      ok: true,
      status: "executed",
      already_executed: true,
      summary: pending.confirmation_summary,
      reservation_ref: pending.execution_ref ?? null,
    };
  }

  if (pending.status !== "pending" || pending.action_type !== "booking.create") {
    return { ok: false, error: "pending_action_not_available" };
  }

  if (new Date(pending.expires_at).getTime() <= Date.now()) {
    await ctx.supabase
      .from("assistant_pending_actions")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");
    return { ok: false, error: "confirmation_expired" };
  }

  const payload = asObject(pending.action_payload);
  if (!payload) return { ok: false, error: "pending_action_invalid" };

  if (String(payload.prepared_turn_id ?? "") === ctx.turnId) {
    return { ok: false, error: "confirmation_requires_new_turn" };
  }

  if (!isExplicitAssistantConfirmation(ctx.currentUserMessage)) {
    return { ok: false, error: "explicit_confirmation_required" };
  }

  const sessionId = String(payload.session_id ?? "");
  const studentId = String(payload.student_id ?? "") || null;
  const crmContactId = String(payload.crm_contact_id ?? "") || null;
  const trialException = payload.trial_exception === true;

  if (!trialException) {
    if (!ctx.studentId || !studentId || studentId !== ctx.studentId) {
      return { ok: false, error: "conversation_identity_changed" };
    }
  } else if (studentId && ctx.studentId && studentId !== ctx.studentId) {
    return { ok: false, error: "conversation_identity_changed" };
  } else if (!studentId && !crmContactId) {
    return { ok: false, error: "conversation_identity_changed" };
  }

  const sessionInfo = await getSessionSummary(ctx, sessionId);
  if (!sessionInfo) {
    return { ok: false, error: "session_not_found" };
  }
  if (!isSessionBookableNow(sessionInfo.session)) {
    return {
      ok: false,
      error: "booking_not_eligible",
      ...safeBookingReason("session_not_bookable"),
    };
  }
  const resourceId = String(payload.resource_id ?? "") || null;
  const resourceLabel = String(payload.resource_label ?? "") || null;
  if (sessionInfo.session.requires_resource && !resourceId) {
    return { ok: false, error: "resource_selection_required" };
  }

  let reservationId: string | null = null;
  let finalCommercialStatus = "package_covered";
  let finalStudentId = studentId;

  if (trialException) {
    // A previously prepared confirmation cannot bypass a consumed or expired paid trial.
    const preview = await ctx.supabase.rpc("assistant_trial_booking_preview", {
      target_studio_id: ctx.studio.id,
      target_session_id: sessionId,
      target_student_id: studentId,
      target_crm_contact_id: studentId ? null : crmContactId,
    });
    const eligibility = asObject(preview.data);
    if (preview.error) return { ok: false, error: "trial_credit_unavailable" };
    if (
      ["trial_credit_payment_required", "trial_credit_requires_standard_booking"].includes(
        String(eligibility?.reason_code),
      )
    ) {
      await ctx.supabase
        .from("assistant_pending_actions")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", pending.id)
        .eq("studio_id", ctx.studio.id)
        .eq("status", "pending");
      return {
        ok: false,
        error: "booking_not_eligible",
        ...safeBookingReason(eligibility?.reason_code),
        reservation_confirmed: false,
      };
    }
    const prepaymentPolicy = await getDemiTrialPrepaymentRequirement(ctx);
    if (!prepaymentPolicy.ok) return prepaymentPolicy;

    if (prepaymentPolicy.effectiveRequiresPayment) {
      if (!ctx.serviceMode) {
        return { ok: false, error: "trial_prepay_requires_service_mode" };
      }

      const paymentStudentId = studentId;
      if (!paymentStudentId) {
        const bank = await ctx.supabase
          .from("studio_bank_transfer_settings")
          .select("bank_name,account_holder,clabe,account_number,card_number,instructions")
          .eq("studio_id", ctx.studio.id)
          .eq("enabled", true)
          .maybeSingle();
        if (
          bank.error ||
          !bank.data ||
          !bank.data.bank_name ||
          !bank.data.account_holder ||
          !(bank.data.clabe || bank.data.account_number || bank.data.card_number)
        )
          return { ok: false, error: "bank_transfer_details_not_configured" };
        const prepared = await ctx.supabase.rpc("service_prepare_demi_prospect_payment", {
          p_studio: ctx.studio.id,
          p_conversation: ctx.conversationId,
          p_contact: crmContactId,
          p_session: sessionId,
          p_resource: resourceId,
        });
        const payment = asObject(prepared.data);
        if (prepared.error || payment?.ok !== true || !payment.group_id)
          return {
            ok: false,
            error: "trial_payment_setup_failed",
            ...safeBookingReason(payment?.reason_code),
          };
        const executedAt = new Date().toISOString();
        const update = await ctx.supabase
          .from("assistant_pending_actions")
          .update({
            status: "executed",
            confirmed_at: executedAt,
            executed_at: executedAt,
            execution_ref: `prospect-payment:${payment.group_id}`,
            updated_at: executedAt,
          })
          .eq("id", pending.id)
          .eq("studio_id", ctx.studio.id)
          .eq("status", "pending");
        if (update.error) return { ok: false, error: "pending_action_update_failed" };
        return {
          ok: true,
          status:
            payment.status === "awaiting_participants"
              ? "participant_data_required"
              : "payment_required",
          reservation_confirmed: false,
          payment_required: payment.status === "awaiting_receipt",
          group_id: payment.group_id,
          participant_count: 1,
          amount_minor: payment.amount_minor,
          currency: payment.currency,
          bank_details: bank.data,
          summary: {
            ...sessionInfo.summary,
            ...(asObject(pending.confirmation_summary) ?? {}),
            commercial_status: "payment_pending",
            payment_pending: true,
            payment_before_booking: true,
            trial_booking: true,
          },
        };
      }

      if (ctx.studentId !== paymentStudentId) {
        ctx.studentId = paymentStudentId;
        const { error: conversationUpdateError } = await ctx.supabase
          .from("assistant_conversations")
          .update({
            student_id: paymentStudentId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", ctx.conversationId)
          .eq("studio_id", ctx.studio.id);

        if (conversationUpdateError) {
          return { ok: false, error: "trial_identity_link_failed" };
        }
      }

      const { data: transferData, error: transferError } = await ctx.supabase.rpc(
        "service_prepare_trial_transfer",
        {
          target_studio_id: ctx.studio.id,
          target_conversation_id: ctx.conversationId,
          target_student_id: paymentStudentId,
          target_session_id: sessionId,
          target_resource_id: resourceId,
        },
      );
      const transfer = asObject(transferData);

      if (transferError || !transfer || transfer.ok !== true) {
        return {
          ok: false,
          error: "trial_payment_setup_failed",
          ...safeBookingReason(transfer?.reason_code),
        };
      }

      const intentId = String(transfer.intent_id ?? "").trim();
      const executedAt = new Date().toISOString();
      const { error: pendingUpdateError } = await ctx.supabase
        .from("assistant_pending_actions")
        .update({
          status: "executed",
          confirmed_at: executedAt,
          executed_at: executedAt,
          execution_ref: intentId ? `trial-payment:${intentId}` : "trial-payment:prepared",
          updated_at: executedAt,
        })
        .eq("id", pending.id)
        .eq("studio_id", ctx.studio.id)
        .eq("status", "pending");

      if (pendingUpdateError) {
        return { ok: false, error: "pending_action_update_failed" };
      }

      return {
        ok: true,
        status: "payment_required",
        reservation_confirmed: false,
        payment_required: true,
        student_id: paymentStudentId,
        intent_id: intentId || null,
        amount_minor: Number(transfer.amount_minor ?? sessionInfo.summary.drop_in_price_minor ?? 0),
        currency: String(transfer.currency ?? ctx.studio.currency),
        bank_details: transfer.bank_details ?? null,
        summary: {
          ...sessionInfo.summary,
          ...(asObject(pending.confirmation_summary) ?? {}),
          commercial_status: "payment_pending",
          payment_pending: true,
          payment_before_booking: true,
          trial_booking: true,
          selected_resource: resourceId
            ? {
                resource_id: resourceId,
                label: resourceLabel,
              }
            : null,
        },
      };
    }

    const trialBookingRequest =
      resourceId && ctx.serviceMode
        ? await ctx.supabase.rpc("service_confirm_trial_booking_with_resource", {
            target_studio_id: ctx.studio.id,
            target_session_id: sessionId,
            target_student_id: studentId,
            target_crm_contact_id: crmContactId,
            target_assistant_conversation_id: ctx.conversationId,
            target_resource_id: resourceId,
          })
        : resourceId
          ? {
              data: null,
              error: new Error("resource_booking_requires_service_mode"),
            }
          : await ctx.supabase.rpc("assistant_confirm_trial_booking", {
              target_studio_id: ctx.studio.id,
              target_session_id: sessionId,
              target_student_id: studentId,
              target_crm_contact_id: crmContactId,
              target_assistant_conversation_id: ctx.conversationId,
            });
    const { data: trialBooking, error: trialBookingError } = trialBookingRequest;

    const trialBookingObject = asObject(trialBooking);
    if (
      trialBookingError ||
      !trialBookingObject ||
      trialBookingObject.ok !== true ||
      !trialBookingObject.reservation_id
    ) {
      const reasonCode = String(trialBookingObject?.reason_code ?? "booking_execution_failed");

      await ctx.supabase
        .from("assistant_pending_actions")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", pending.id)
        .eq("studio_id", ctx.studio.id)
        .eq("status", "pending");

      if (reasonCode === "trial_prepayment_required") {
        return {
          ok: false,
          error: "prepayment_required",
          reason_code: reasonCode,
          reason_message: BOOKING_REASON_MESSAGES.trial_prepayment_required,
          prepayment_required: true,
          no_show_count: Number(trialBookingObject?.no_show_count ?? 2),
          prepayment_threshold: Number(trialBookingObject?.prepayment_threshold ?? 2),
          amount_minor:
            trialBookingObject?.amount_minor == null
              ? sessionInfo.summary.drop_in_price_minor
              : Number(trialBookingObject.amount_minor),
          currency: String(trialBookingObject?.currency ?? ctx.studio.currency),
        };
      }

      return {
        ok: false,
        error: "booking_execution_failed",
        ...safeBookingReason(reasonCode),
      };
    }

    reservationId = String(trialBookingObject.reservation_id);
    finalStudentId = String(trialBookingObject.student_id ?? "") || studentId;
    finalCommercialStatus = "payment_pending";

    if (finalStudentId && ctx.studentId !== finalStudentId) {
      ctx.studentId = finalStudentId;
      await ctx.supabase
        .from("assistant_conversations")
        .update({
          student_id: finalStudentId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", ctx.conversationId)
        .eq("studio_id", ctx.studio.id);
    }
  } else {
    if (!studentId) return { ok: false, error: "conversation_identity_changed" };

    const existing = await ctx.supabase
      .from("reservations")
      .select("id")
      .eq("studio_id", ctx.studio.id)
      .eq("student_id", studentId)
      .eq("session_id", sessionId)
      .eq("status", "reserved")
      .limit(1)
      .maybeSingle();
    if (existing.error) return { ok: false, error: "booking_reconciliation_unavailable" };
    if (existing.data?.id) {
      if (resourceId) {
        const assignment = await ctx.supabase
          .from("reservation_resource_assignments")
          .select("resource_id")
          .eq("studio_id", ctx.studio.id)
          .eq("reservation_id", existing.data.id)
          .is("released_at", null)
          .maybeSingle();
        if (assignment.error || assignment.data?.resource_id !== resourceId)
          return { ok: false, error: "existing_reservation_requires_review" };
      }
      reservationId = existing.data.id;
    }
    const retryStatus =
      ctx.serviceMode && !reservationId
        ? await ctx.supabase.rpc("service_demi_booking_failure_status", {
            p_studio: ctx.studio.id,
            p_conversation: ctx.conversationId,
            p_pending: pending.id,
            p_turn: ctx.turnId,
            p_error: null,
          })
        : null;
    if (retryStatus && (retryStatus.error || retryStatus.data?.ok !== true))
      return { ok: false, error: "booking_retry_status_unavailable" };
    if (retryStatus?.data?.retry_allowed === false)
      return { ...retryStatus.data, ok: false, error: "booking_retry_limit_reached" };
    if (retryStatus?.data?.inject_failure_before === true)
      return { ok: false, error: "booking_execution_failed", injected_uat_failure: true };

    const eligibilityRequest = reservationId
      ? { data: { eligible: true }, error: null }
      : ctx.serviceMode
        ? await ctx.supabase.rpc("service_booking_eligibility", {
            target_studio_id: ctx.studio.id,
            target_session_id: sessionId,
            target_student_id: studentId,
          })
        : await ctx.supabase.rpc("booking_eligibility", {
            target_session_id: sessionId,
            target_student_id: studentId,
          });
    const { data: eligibility, error: eligibilityError } = eligibilityRequest;
    if (eligibilityError) {
      return { ok: false, error: "booking_eligibility_unavailable" };
    }

    const eligibilityObject = asObject(eligibility);
    const eligibilityReason = String(eligibilityObject?.reason_code ?? "");
    if (!eligibilityObject || eligibilityObject.eligible !== true) {
      await ctx.supabase
        .from("assistant_pending_actions")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", pending.id)
        .eq("studio_id", ctx.studio.id)
        .eq("status", "pending");

      return {
        ok: false,
        error: "booking_no_longer_eligible",
        ...safeBookingReason(eligibilityReason),
      };
    }

    if (reservationId) {
      // Reconciled the earlier successful transaction; no booking RPC or second credit debit.
    } else if (ctx.serviceMode) {
      const bookingRequest = resourceId
        ? await ctx.supabase.rpc("service_book_student_with_resource", {
            target_studio_id: ctx.studio.id,
            target_session_id: sessionId,
            target_student_id: studentId,
            target_resource_id: resourceId,
          })
        : await ctx.supabase.rpc("service_book_student", {
            target_studio_id: ctx.studio.id,
            target_session_id: sessionId,
            target_student_id: studentId,
          });
      const { data, error: bookingError } = bookingRequest;
      const bookingResult = asObject(data);
      if (
        bookingError ||
        !bookingResult ||
        bookingResult.eligible !== true ||
        !bookingResult.reservation_id
      ) {
        return {
          ok: false,
          error: "booking_execution_failed",
          ...safeBookingReason(bookingResult?.reason_code),
        };
      }
      reservationId = String(bookingResult.reservation_id);
      if (retryStatus?.data?.inject_timeout_after === true)
        return {
          ok: false,
          error: "booking_execution_failed",
          outcome_unknown: true,
          injected_uat_failure: true,
        };
    } else {
      if (resourceId) {
        const { data, error: bookingError } = await ctx.supabase.rpc(
          "student_book_session_with_resource",
          {
            target_session_id: sessionId,
            target_resource_id: resourceId,
          },
        );
        const bookingResult = asObject(data);
        if (
          bookingError ||
          !bookingResult ||
          bookingResult.eligible !== true ||
          !bookingResult.reservation_id
        ) {
          return {
            ok: false,
            error: "booking_execution_failed",
            ...safeBookingReason(bookingResult?.reason_code),
          };
        }
        reservationId = String(bookingResult.reservation_id);
      } else {
        const { data, error: bookingError } = await ctx.supabase.rpc("admin_book_student", {
          target_session_id: sessionId,
          target_student_id: studentId,
        });

        if (bookingError || !data) {
          return { ok: false, error: "booking_execution_failed" };
        }

        reservationId = String(data);
      }
    }
  }

  if (!reservationId) {
    return { ok: false, error: "booking_execution_failed" };
  }

  let accessProvision: {
    generated: boolean;
    already_has_access?: boolean;
    error?: string;
    activation_url: string | null;
  } | null = null;

  if (trialException && finalStudentId) {
    accessProvision = await provisionTrialActivationLink(ctx, finalStudentId);
  }

  const executedAt = new Date().toISOString();
  const reservationRef = `reservation:${reservationId}`;
  await ctx.supabase
    .from("assistant_pending_actions")
    .update({
      status: "executed",
      confirmed_at: executedAt,
      executed_at: executedAt,
      execution_ref: reservationRef,
      updated_at: executedAt,
    })
    .eq("id", pending.id)
    .eq("studio_id", ctx.studio.id)
    .eq("status", "pending");

  return {
    ok: true,
    status: "executed",
    reservation_ref: reservationRef,
    student_id: finalStudentId,
    commercial_status: finalCommercialStatus,
    activation_url: accessProvision?.activation_url ?? null,
    access_link_generated: accessProvision?.generated === true,
    access_already_available: accessProvision?.already_has_access === true,
    access_error: accessProvision?.error ?? null,
    summary: {
      ...sessionInfo.summary,
      ...(trialException && asObject(pending.confirmation_summary)
        ? asObject(pending.confirmation_summary)
        : {}),
      commercial_status: finalCommercialStatus,
      payment_pending: finalCommercialStatus === "payment_pending",
      trial_booking: trialException,
      selected_resource: resourceId
        ? {
            resource_id: resourceId,
            label: resourceLabel,
          }
        : null,
    },
  };
}

type CancellationSnapshot = {
  reservationId: string;
  sessionId: string;
  status: string;
  summary: {
    activity: string;
    date: string;
    starts_at_local: string;
    ends_at_local: string;
    location: string | null;
    space: string | null;
    cancellation_status: "cancelled_on_time" | "cancelled_late";
    late: boolean;
    credit_cost: number;
    credit_will_return: boolean | null;
    unlimited_penalty_minor: number;
    currency: string;
    cancellation_cutoff_minutes: number;
  };
};

async function getCancellationSnapshot(
  ctx: AssistantActionToolContext,
  reservationId: string,
): Promise<CancellationSnapshot | null> {
  if (!ctx.studentId) return null;

  const { data: reservation, error: reservationError } = await ctx.supabase
    .from("reservations")
    .select("id,session_id,student_id,status,credits_held,acquisition_id")
    .eq("id", reservationId)
    .eq("studio_id", ctx.studio.id)
    .eq("student_id", ctx.studentId)
    .maybeSingle();

  if (reservationError || !reservation) return null;

  const { data: session, error: sessionError } = await ctx.supabase
    .from("class_sessions")
    .select("id,template_id,starts_at,ends_at,location_id,space_id")
    .eq("id", reservation.session_id)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  if (sessionError || !session) return null;

  const [templateResult, locationResult, spaceResult, policyResult, acquisitionResult] =
    await Promise.all([
      ctx.supabase
        .from("class_templates")
        .select("name")
        .eq("id", session.template_id)
        .eq("studio_id", ctx.studio.id)
        .maybeSingle(),
      session.location_id
        ? ctx.supabase
            .from("studio_locations")
            .select("name")
            .eq("id", session.location_id)
            .eq("studio_id", ctx.studio.id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      session.space_id
        ? ctx.supabase
            .from("spaces")
            .select("name")
            .eq("id", session.space_id)
            .eq("studio_id", ctx.studio.id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      ctx.supabase
        .from("studio_operating_policies")
        .select(
          "cancellation_cutoff_minutes,late_cancellation_consumes_credit,unlimited_late_cancellation_penalty_minor",
        )
        .eq("studio_id", ctx.studio.id)
        .maybeSingle(),
      reservation.acquisition_id
        ? ctx.supabase
            .from("product_acquisitions")
            .select("unlimited")
            .eq("id", reservation.acquisition_id)
            .eq("studio_id", ctx.studio.id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

  if (templateResult.error || policyResult.error || acquisitionResult.error) {
    return null;
  }

  const cutoffMinutes = Math.max(Number(policyResult.data?.cancellation_cutoff_minutes ?? 0), 0);
  const late = Date.now() > new Date(session.starts_at).getTime() - cutoffMinutes * 60_000;
  const usesCredits = Boolean(reservation.acquisition_id);
  const unlimited = usesCredits && Boolean(acquisitionResult.data?.unlimited);
  const creditCost = usesCredits ? Math.max(Number(reservation.credits_held ?? 1), 1) : 0;
  const lateConsumesCredit = Boolean(policyResult.data?.late_cancellation_consumes_credit);

  const start = localParts(session.starts_at, ctx.studio.timezone);
  const end = localParts(session.ends_at, ctx.studio.timezone);

  return {
    reservationId: reservation.id,
    sessionId: reservation.session_id,
    status: String(reservation.status),
    summary: {
      activity: templateResult.data?.name ?? "Clase",
      date: start.date,
      starts_at_local: start.time,
      ends_at_local: end.time,
      location: locationResult.data?.name ?? null,
      space: spaceResult.data?.name ?? null,
      cancellation_status: late ? "cancelled_late" : "cancelled_on_time",
      late,
      credit_cost: creditCost,
      credit_will_return: usesCredits ? (unlimited ? null : !(late && lateConsumesCredit)) : null,
      unlimited_penalty_minor:
        unlimited && late
          ? Math.max(Number(policyResult.data?.unlimited_late_cancellation_penalty_minor ?? 0), 0)
          : 0,
      currency: ctx.studio.currency,
      cancellation_cutoff_minutes: cutoffMinutes,
    },
  };
}

function cancellationConsequenceKey(snapshot: CancellationSnapshot["summary"]) {
  return JSON.stringify({
    cancellation_status: snapshot.cancellation_status,
    credit_will_return: snapshot.credit_will_return,
    unlimited_penalty_minor: snapshot.unlimited_penalty_minor,
    credit_cost: snapshot.credit_cost,
  });
}

async function prepareCancellation(ctx: AssistantActionToolContext, args: PrepareCancellationArgs) {
  if (!ctx.studentId) {
    return { ok: false, error: "identity_required" };
  }

  const reservationId = parseOpaqueRef(args.reservation_ref, "reservation");
  if (!reservationId) {
    return { ok: false, error: "invalid_reservation_ref" };
  }

  const reason = String(args.reason ?? "").trim();
  if (reason.length < 2 || reason.length > 240) {
    return { ok: false, error: "cancellation_reason_required" };
  }

  const snapshot = await getCancellationSnapshot(ctx, reservationId);
  if (!snapshot) {
    return { ok: false, error: "reservation_not_found" };
  }
  if (snapshot.status !== "reserved") {
    return { ok: false, error: "reservation_not_cancellable" };
  }

  if (!snapshot.summary.late) {
    const cancellationRequest = ctx.serviceMode
      ? await ctx.supabase.rpc("service_cancel_reservation", {
          target_studio_id: ctx.studio.id,
          target_student_id: ctx.studentId,
          target_reservation_id: reservationId,
          target_reason: reason,
        })
      : await ctx.supabase.rpc("cancel_reservation", {
          target_reservation_id: reservationId,
          target_reason: reason,
        });

    const { data: cancellation, error: cancellationError } = cancellationRequest;
    const cancellationObject = asObject(cancellation);
    if (cancellationError || !cancellationObject || cancellationObject.ok !== true) {
      return {
        ok: false,
        error: String(cancellationObject?.reason_code ?? "") || "cancellation_execution_failed",
      };
    }

    return {
      ok: true,
      status: "executed",
      reservation_ref: `reservation:${reservationId}`,
      cancellation_status: cancellationObject.status,
      credit_cost: cancellationObject.credit_cost,
      summary: {
        ...snapshot.summary,
        reason,
      },
    };
  }

  const now = new Date().toISOString();
  await ctx.supabase
    .from("assistant_pending_actions")
    .update({ status: "cancelled", updated_at: now })
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "booking.cancel")
    .eq("status", "pending");

  const secretToken = randomUUID();
  const tokenHash = createHash("sha256").update(secretToken).digest("hex");
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

  const confirmationSummary = {
    ...snapshot.summary,
    reason,
  };

  const { data: pending, error: pendingError } = await ctx.supabase
    .from("assistant_pending_actions")
    .insert({
      studio_id: ctx.studio.id,
      conversation_id: ctx.conversationId,
      action_type: "booking.cancel",
      action_token_hash: tokenHash,
      action_payload: {
        reservation_id: reservationId,
        student_id: ctx.studentId,
        reason,
        prepared_turn_id: ctx.turnId,
        consequence_key: cancellationConsequenceKey(snapshot.summary),
      },
      confirmation_summary: confirmationSummary,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (pendingError || !pending) {
    return { ok: false, error: "pending_action_create_failed" };
  }

  return {
    ok: true,
    status: "confirmation_required",
    expires_at: expiresAt,
    summary: confirmationSummary,
  };
}

async function executeCancellation(ctx: AssistantActionToolContext, args: ExecuteCancellationArgs) {
  void args;

  const { data: pending, error: pendingError } = await ctx.supabase
    .from("assistant_pending_actions")
    .select("id,action_type,action_payload,confirmation_summary,status,expires_at,execution_ref")
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "booking.cancel")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingError || !pending) {
    return { ok: false, error: "pending_action_not_found" };
  }

  if (pending.status === "executed") {
    return {
      ok: true,
      status: "executed",
      already_executed: true,
      summary: pending.confirmation_summary,
      reservation_ref: pending.execution_ref ?? null,
    };
  }

  if (pending.status !== "pending" || pending.action_type !== "booking.cancel") {
    return { ok: false, error: "pending_action_not_available" };
  }

  if (new Date(pending.expires_at).getTime() <= Date.now()) {
    await ctx.supabase
      .from("assistant_pending_actions")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");
    return { ok: false, error: "confirmation_expired" };
  }

  const payload = asObject(pending.action_payload);
  if (!payload) return { ok: false, error: "pending_action_invalid" };

  if (String(payload.prepared_turn_id ?? "") === ctx.turnId) {
    return { ok: false, error: "confirmation_requires_new_turn" };
  }

  if (!isExplicitAssistantConfirmation(ctx.currentUserMessage)) {
    return { ok: false, error: "explicit_confirmation_required" };
  }

  const studentId = String(payload.student_id ?? "");
  const reservationId = String(payload.reservation_id ?? "");
  const reason = String(payload.reason ?? "").trim();

  if (!ctx.studentId || studentId !== ctx.studentId) {
    return { ok: false, error: "conversation_identity_changed" };
  }
  if (!reservationId || reason.length < 2) {
    return { ok: false, error: "pending_action_invalid" };
  }

  const snapshot = await getCancellationSnapshot(ctx, reservationId);
  if (!snapshot) {
    return { ok: false, error: "reservation_not_found" };
  }
  if (snapshot.status !== "reserved") {
    return { ok: false, error: "reservation_not_cancellable" };
  }

  const previousConsequence = String(payload.consequence_key ?? "");
  const currentConsequence = cancellationConsequenceKey(snapshot.summary);
  if (previousConsequence !== currentConsequence) {
    const refreshedAt = new Date().toISOString();
    const refreshedExpiry = new Date(Date.now() + 10 * 60_000).toISOString();
    const refreshedSummary = { ...snapshot.summary, reason };

    await ctx.supabase
      .from("assistant_pending_actions")
      .update({
        action_payload: {
          ...payload,
          prepared_turn_id: ctx.turnId,
          consequence_key: currentConsequence,
        },
        confirmation_summary: refreshedSummary,
        expires_at: refreshedExpiry,
        updated_at: refreshedAt,
      })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");

    return {
      ok: true,
      status: "confirmation_required",
      consequence_changed: true,
      expires_at: refreshedExpiry,
      summary: refreshedSummary,
    };
  }

  const cancellationRequest = ctx.serviceMode
    ? await ctx.supabase.rpc("service_cancel_reservation", {
        target_studio_id: ctx.studio.id,
        target_student_id: ctx.studentId,
        target_reservation_id: reservationId,
        target_reason: reason,
      })
    : await ctx.supabase.rpc("cancel_reservation", {
        target_reservation_id: reservationId,
        target_reason: reason,
      });

  const { data: cancellation, error: cancellationError } = cancellationRequest;
  const cancellationObject = asObject(cancellation);
  if (cancellationError || !cancellationObject || cancellationObject.ok !== true) {
    return {
      ok: false,
      error: String(cancellationObject?.reason_code ?? "") || "cancellation_execution_failed",
    };
  }

  const executedAt = new Date().toISOString();
  const reservationRef = `reservation:${reservationId}`;
  await ctx.supabase
    .from("assistant_pending_actions")
    .update({
      status: "executed",
      confirmed_at: executedAt,
      executed_at: executedAt,
      execution_ref: reservationRef,
      updated_at: executedAt,
    })
    .eq("id", pending.id)
    .eq("studio_id", ctx.studio.id)
    .eq("status", "pending");

  return {
    ok: true,
    status: "executed",
    reservation_ref: reservationRef,
    cancellation_status: cancellationObject.status,
    credit_cost: cancellationObject.credit_cost,
    summary: {
      ...snapshot.summary,
      reason,
    },
  };
}

async function prepareReschedule(ctx: AssistantActionToolContext, args: PrepareRescheduleArgs) {
  if (!ctx.studentId) return { ok: false, error: "identity_required" };

  const reservationId = parseOpaqueRef(args.reservation_ref, "reservation");
  const targetSessionId = parseOpaqueRef(args.target_session_ref, "session");
  if (!reservationId) return { ok: false, error: "invalid_reservation_ref" };
  if (!targetSessionId) return { ok: false, error: "invalid_session_ref" };

  const source = await getCancellationSnapshot(ctx, reservationId);
  if (!source) return { ok: false, error: "reservation_not_found" };
  if (source.status !== "reserved") {
    return { ok: false, error: "reservation_not_reschedulable" };
  }
  if (source.sessionId === targetSessionId) {
    return { ok: false, error: "same_session" };
  }

  const target = await getSessionSummary(ctx, targetSessionId);
  if (!target) return { ok: false, error: "session_not_found" };
  const eligibilityRequest = ctx.serviceMode
    ? await ctx.supabase.rpc("service_booking_eligibility", {
        target_studio_id: ctx.studio.id,
        target_session_id: targetSessionId,
        target_student_id: ctx.studentId,
      })
    : await ctx.supabase.rpc("booking_eligibility", {
        target_session_id: targetSessionId,
        target_student_id: ctx.studentId,
      });
  const { data: eligibility, error: eligibilityError } = eligibilityRequest;
  if (eligibilityError) {
    return { ok: false, error: "booking_eligibility_unavailable" };
  }

  const eligibilityObject = asObject(eligibility);
  const reasonCode = String(eligibilityObject?.reason_code ?? "");
  const canUseReleasedCredit =
    reasonCode === "no_credits" && source.summary.credit_will_return === true;

  if (eligibilityObject?.eligible !== true && !canUseReleasedCredit) {
    return {
      ok: false,
      error: "reschedule_not_eligible",
      ...safeBookingReason(reasonCode),
    };
  }

  const now = new Date().toISOString();
  await ctx.supabase
    .from("assistant_pending_actions")
    .update({ status: "cancelled", updated_at: now })
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "booking.reschedule")
    .eq("status", "pending");

  const secretToken = randomUUID();
  const tokenHash = createHash("sha256").update(secretToken).digest("hex");
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

  const summary = {
    from: source.summary,
    to: target.summary,
    atomic: true,
    original_preserved_if_failed: true,
    late_reschedule: source.summary.late === true,
    source_credit_will_return: source.summary.credit_will_return,
    target_credit_cost: target.summary.credit_cost,
    additional_credit_required:
      source.summary.late === true && source.summary.credit_will_return === false
        ? target.summary.credit_cost
        : 0,
    target_may_use_released_credit: canUseReleasedCredit,
  };

  if (target.session.requires_resource) {
    return createResourceSelectionPending(ctx, {
      actionType: "booking.reschedule",
      sessionId: targetSessionId,
      payload: {
        reservation_id: reservationId,
        target_session_id: targetSessionId,
        student_id: ctx.studentId,
        source_consequence_key: cancellationConsequenceKey(source.summary),
      },
      summary,
    });
  }

  const { data: pending, error: pendingError } = await ctx.supabase
    .from("assistant_pending_actions")
    .insert({
      studio_id: ctx.studio.id,
      conversation_id: ctx.conversationId,
      action_type: "booking.reschedule",
      action_token_hash: tokenHash,
      action_payload: {
        reservation_id: reservationId,
        target_session_id: targetSessionId,
        student_id: ctx.studentId,
        prepared_turn_id: ctx.turnId,
        source_consequence_key: cancellationConsequenceKey(source.summary),
      },
      confirmation_summary: summary,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (pendingError || !pending) {
    return { ok: false, error: "pending_action_create_failed" };
  }

  return {
    ok: true,
    status: "confirmation_required",
    expires_at: expiresAt,
    summary,
  };
}

async function executeReschedule(ctx: AssistantActionToolContext, args: ExecuteRescheduleArgs) {
  void args;

  const { data: pending, error: pendingError } = await ctx.supabase
    .from("assistant_pending_actions")
    .select("id,action_type,action_payload,confirmation_summary,status,expires_at,execution_ref")
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "booking.reschedule")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingError || !pending) {
    return { ok: false, error: "pending_action_not_found" };
  }
  if (pending.status === "executed") {
    return {
      ok: true,
      status: "executed",
      already_executed: true,
      summary: pending.confirmation_summary,
      reservation_ref: pending.execution_ref ?? null,
    };
  }
  if (pending.status !== "pending") {
    return { ok: false, error: "pending_action_not_available" };
  }
  if (new Date(pending.expires_at).getTime() <= Date.now()) {
    await ctx.supabase
      .from("assistant_pending_actions")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");
    return { ok: false, error: "confirmation_expired" };
  }

  const payload = asObject(pending.action_payload);
  if (!payload) return { ok: false, error: "pending_action_invalid" };
  if (String(payload.prepared_turn_id ?? "") === ctx.turnId) {
    return { ok: false, error: "confirmation_requires_new_turn" };
  }
  if (!isExplicitAssistantConfirmation(ctx.currentUserMessage)) {
    return { ok: false, error: "explicit_confirmation_required" };
  }

  const studentId = String(payload.student_id ?? "");
  const reservationId = String(payload.reservation_id ?? "");
  const targetSessionId = String(payload.target_session_id ?? "");
  if (!ctx.studentId || studentId !== ctx.studentId) {
    return { ok: false, error: "conversation_identity_changed" };
  }

  const source = await getCancellationSnapshot(ctx, reservationId);
  const target = await getSessionSummary(ctx, targetSessionId);
  if (!source || source.status !== "reserved") {
    return { ok: false, error: "reservation_not_reschedulable" };
  }
  if (!target) return { ok: false, error: "session_not_found" };
  const resourceId = String(payload.resource_id ?? "") || null;
  const resourceLabel = String(payload.resource_label ?? "") || null;
  if (target.session.requires_resource && !resourceId) {
    return { ok: false, error: "resource_selection_required" };
  }

  const previousConsequence = String(payload.source_consequence_key ?? "");
  const currentConsequence = cancellationConsequenceKey(source.summary);
  if (previousConsequence !== currentConsequence) {
    const refreshedExpiry = new Date(Date.now() + 10 * 60_000).toISOString();
    const currentPendingSummary = asObject(pending.confirmation_summary) ?? {};
    const refreshedSummary = {
      from: source.summary,
      to: target.summary,
      atomic: true,
      original_preserved_if_failed: true,
      late_reschedule: source.summary.late === true,
      source_credit_will_return: source.summary.credit_will_return,
      target_credit_cost: target.summary.credit_cost,
      additional_credit_required:
        source.summary.late === true && source.summary.credit_will_return === false
          ? target.summary.credit_cost
          : 0,
      selected_resource: currentPendingSummary.selected_resource ?? null,
    };

    await ctx.supabase
      .from("assistant_pending_actions")
      .update({
        action_payload: {
          ...payload,
          prepared_turn_id: ctx.turnId,
          source_consequence_key: currentConsequence,
        },
        confirmation_summary: refreshedSummary,
        expires_at: refreshedExpiry,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");

    return {
      ok: true,
      status: "confirmation_required",
      consequence_changed: true,
      expires_at: refreshedExpiry,
      summary: refreshedSummary,
    };
  }

  const eligibilityRequest = ctx.serviceMode
    ? await ctx.supabase.rpc("service_booking_eligibility", {
        target_studio_id: ctx.studio.id,
        target_session_id: targetSessionId,
        target_student_id: studentId,
      })
    : await ctx.supabase.rpc("booking_eligibility", {
        target_session_id: targetSessionId,
        target_student_id: studentId,
      });
  const { data: eligibility, error: eligibilityError } = eligibilityRequest;
  if (eligibilityError) {
    return { ok: false, error: "booking_eligibility_unavailable" };
  }

  const eligibilityObject = asObject(eligibility);
  const reasonCode = String(eligibilityObject?.reason_code ?? "");
  const canUseReleasedCredit =
    reasonCode === "no_credits" && source.summary.credit_will_return === true;

  if (eligibilityObject?.eligible !== true && !canUseReleasedCredit) {
    return {
      ok: false,
      error: "reschedule_no_longer_eligible",
      original_reservation_preserved: true,
      ...safeBookingReason(reasonCode),
    };
  }

  const rescheduleRequest = ctx.serviceMode
    ? resourceId
      ? await ctx.supabase.rpc("service_reschedule_student_reservation_with_resource", {
          target_studio_id: ctx.studio.id,
          target_student_id: studentId,
          target_reservation_id: reservationId,
          target_session_id: targetSessionId,
          target_resource_id: resourceId,
          target_reason: "Reagendado por Demi",
        })
      : await ctx.supabase.rpc("service_reschedule_student_reservation", {
          target_studio_id: ctx.studio.id,
          target_student_id: studentId,
          target_reservation_id: reservationId,
          target_session_id: targetSessionId,
          target_reason: "Reagendado por Demi",
        })
    : resourceId
      ? {
          data: null,
          error: new Error("resource_reschedule_requires_service_mode"),
        }
      : await ctx.supabase.rpc("admin_reschedule_student_reservation", {
          target_reservation_id: reservationId,
          target_session_id: targetSessionId,
          target_reason: "Reagendado por Demi",
        });

  const { data: result, error: rescheduleError } = rescheduleRequest;
  const resultObject = asObject(result);
  if (rescheduleError || !resultObject || resultObject.ok !== true) {
    return {
      ok: false,
      error: "reschedule_execution_failed",
      original_reservation_preserved: true,
      ...safeBookingReason(resultObject?.reason_code),
    };
  }

  const newReservationId = String(resultObject.target_reservation_id ?? "");
  const executedAt = new Date().toISOString();
  const reservationRef = newReservationId ? `reservation:${newReservationId}` : null;

  await ctx.supabase
    .from("assistant_pending_actions")
    .update({
      status: "executed",
      confirmed_at: executedAt,
      executed_at: executedAt,
      execution_ref: reservationRef,
      updated_at: executedAt,
    })
    .eq("id", pending.id)
    .eq("studio_id", ctx.studio.id)
    .eq("status", "pending");

  return {
    ok: true,
    status: "executed",
    reservation_ref: reservationRef,
    source_status: resultObject.source_status,
    summary: {
      from: source.summary,
      to: target.summary,
      selected_resource: resourceId
        ? {
            resource_id: resourceId,
            label: resourceLabel,
          }
        : null,
    },
  };
}

async function selectResourceOption(
  ctx: AssistantActionToolContext,
  args: SelectResourceOptionArgs,
) {
  const optionNumber = Number(args.option_number);
  if (!Number.isInteger(optionNumber) || optionNumber < 1) {
    return { ok: false, error: "invalid_resource_option" };
  }

  const { data: pending, error: pendingError } = await ctx.supabase
    .from("assistant_pending_actions")
    .select("id,action_type,action_payload,confirmation_summary,status,expires_at")
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .in("action_type", ["booking.create", "booking.reschedule"])
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingError || !pending) {
    return { ok: false, error: "resource_selection_not_found" };
  }

  if (new Date(pending.expires_at).getTime() <= Date.now()) {
    await ctx.supabase
      .from("assistant_pending_actions")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");
    return { ok: false, error: "resource_selection_expired" };
  }

  const payload = asObject(pending.action_payload);
  if (!payload || payload.stage !== "resource_selection") {
    return { ok: false, error: "resource_selection_not_available" };
  }

  const sessionId =
    pending.action_type === "booking.reschedule"
      ? String(payload.target_session_id ?? "")
      : String(payload.session_id ?? "");

  if (!sessionId) {
    return { ok: false, error: "resource_selection_invalid" };
  }

  const storedOptions = Array.isArray(payload.resource_options)
    ? payload.resource_options
        .map((item) => asObject(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  const selected = storedOptions.find((item) => Number(item.option_number) === optionNumber);

  if (!selected) {
    return {
      ok: false,
      error: "invalid_resource_option",
      reason_message: "Elige uno de los números de recurso que te mostré.",
    };
  }

  const current = await getAvailableResourceOptions(ctx, sessionId);
  if (!current.ok) return current;
  const selectedResourceId = String(selected.resource_id ?? "");
  const currentSelected = current.options.find(
    (option) => option.resource_id === selectedResourceId,
  );

  if (!currentSelected) {
    if (!current.options.length) {
      await ctx.supabase
        .from("assistant_pending_actions")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", pending.id)
        .eq("studio_id", ctx.studio.id)
        .eq("status", "pending");

      return {
        ok: false,
        error: "resource_unavailable",
        reason_message:
          "Ese recurso ya no está disponible y no quedan otros recursos libres para esta clase.",
      };
    }

    const safeOptions = current.options.map((option) => ({
      option_number: option.option_number,
      label: option.label,
      short_label: option.short_label,
      type_name: option.type_name,
    }));
    const currentSummary = asObject(pending.confirmation_summary) ?? {};

    await ctx.supabase
      .from("assistant_pending_actions")
      .update({
        action_payload: {
          ...payload,
          prepared_turn_id: ctx.turnId,
          resource_options: current.options.map((option) => ({
            option_number: option.option_number,
            resource_id: option.resource_id,
            label: option.label,
            short_label: option.short_label,
            type_name: option.type_name,
          })),
        },
        confirmation_summary: {
          ...currentSummary,
          resource_selection_required: true,
          resource_options: safeOptions,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");

    return {
      ok: true,
      status: "resource_selection_required",
      resource_changed: true,
      resource_options: safeOptions,
      summary: {
        ...currentSummary,
        resource_selection_required: true,
        resource_options: safeOptions,
      },
    };
  }

  const currentSummary = asObject(pending.confirmation_summary) ?? {};
  const selectedSummary = {
    option_number: currentSelected.option_number,
    label: currentSelected.label,
    short_label: currentSelected.short_label,
    type_name: currentSelected.type_name,
  };
  const updatedPayload = {
    ...payload,
    stage: "confirmation",
    prepared_turn_id: ctx.turnId,
    resource_id: currentSelected.resource_id,
    resource_label: currentSelected.label,
  };
  const updatedSummary = {
    ...currentSummary,
    resource_selection_required: false,
    selected_resource: selectedSummary,
  };
  const refreshedExpiry = new Date(Date.now() + 10 * 60_000).toISOString();

  const { error: updateError } = await ctx.supabase
    .from("assistant_pending_actions")
    .update({
      action_payload: updatedPayload,
      confirmation_summary: updatedSummary,
      expires_at: refreshedExpiry,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pending.id)
    .eq("studio_id", ctx.studio.id)
    .eq("status", "pending");

  if (updateError) {
    return { ok: false, error: "resource_selection_update_failed" };
  }

  return {
    ok: true,
    status: "confirmation_required",
    expires_at: refreshedExpiry,
    selected_resource: selectedSummary,
    summary: updatedSummary,
  };
}

function safeWaitlistReason(reason: unknown) {
  const code = String(reason ?? "waitlist_not_eligible");
  const messages: Record<string, string> = {
    session_not_found: "La clase ya no está disponible.",
    session_not_bookable: "La clase ya no admite lista de espera.",
    student_not_found: "No pude identificar a la alumna.",
    student_not_operable: "La cuenta no está habilitada para usar lista de espera.",
    already_reserved: "Ya tienes una reserva para esa clase.",
    module_not_enabled: "La lista de espera no está habilitada para este estudio.",
    seat_available: "Ya hay un lugar disponible; no hace falta entrar a lista de espera.",
    document_required: "Hay un documento pendiente antes de poder usar la lista de espera.",
    enrollment_required: "Hace falta completar la inscripción requerida.",
    payment_pending: "Hay un pago pendiente que bloquea esta acción.",
    no_active_product: "No hay un paquete o membresía vigente que cubra la clase.",
    outside_product: "El paquete vigente no aplica para esta actividad.",
    no_credits: "No hay créditos suficientes para entrar a la lista de espera.",
    account_restricted: "La cuenta tiene una restricción que impide entrar a la lista.",
  };

  return {
    reason_code: code,
    reason_message:
      messages[code] ??
      "Studio Flow indicó que no puedes entrar a la lista de espera de esta clase.",
  };
}

async function prepareWaitlistJoin(ctx: AssistantActionToolContext, args: PrepareWaitlistJoinArgs) {
  if (!ctx.studentId) return { ok: false, error: "identity_required" };

  const sessionId = parseOpaqueRef(args.session_ref, "session");
  if (!sessionId) return { ok: false, error: "invalid_session_ref" };

  const sessionInfo = await getSessionSummary(ctx, sessionId);
  if (!sessionInfo) return { ok: false, error: "session_not_found" };

  const previewRequest = ctx.serviceMode
    ? await ctx.supabase.rpc("service_waitlist_preview", {
        target_studio_id: ctx.studio.id,
        target_session_id: sessionId,
        target_student_id: ctx.studentId,
      })
    : await ctx.supabase.rpc("admin_waitlist_preview", {
        target_session_id: sessionId,
        target_student_id: ctx.studentId,
      });
  const { data: preview, error: previewError } = previewRequest;

  if (previewError) {
    return { ok: false, error: "waitlist_preview_unavailable" };
  }

  const previewObject = asObject(preview);
  if (!previewObject || previewObject.ok !== true) {
    return {
      ok: false,
      error: "waitlist_not_eligible",
      ...safeWaitlistReason(previewObject?.reason_code),
    };
  }

  const summary = {
    ...sessionInfo.summary,
    waitlist: true,
    class_is_full: true,
    credit_cost: Number(previewObject.credit_cost ?? sessionInfo.summary.credit_cost ?? 1),
    credit_charged_now: false,
  };

  if (previewObject.reused === true) {
    return {
      ok: true,
      status: "already_active",
      reused: true,
      summary,
    };
  }

  const now = new Date().toISOString();
  await ctx.supabase
    .from("assistant_pending_actions")
    .update({ status: "cancelled", updated_at: now })
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "waitlist.join")
    .eq("status", "pending");

  const secretToken = randomUUID();
  const tokenHash = createHash("sha256").update(secretToken).digest("hex");
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

  const { data: pending, error: pendingError } = await ctx.supabase
    .from("assistant_pending_actions")
    .insert({
      studio_id: ctx.studio.id,
      conversation_id: ctx.conversationId,
      action_type: "waitlist.join",
      action_token_hash: tokenHash,
      action_payload: {
        session_id: sessionId,
        student_id: ctx.studentId,
        prepared_turn_id: ctx.turnId,
      },
      confirmation_summary: summary,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (pendingError || !pending) {
    return { ok: false, error: "pending_action_create_failed" };
  }

  return {
    ok: true,
    status: "confirmation_required",
    expires_at: expiresAt,
    summary,
  };
}

async function executeWaitlistJoin(ctx: AssistantActionToolContext, args: ExecuteWaitlistJoinArgs) {
  void args;

  const { data: pending, error: pendingError } = await ctx.supabase
    .from("assistant_pending_actions")
    .select("id,action_type,action_payload,confirmation_summary,status,expires_at,execution_ref")
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "waitlist.join")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingError || !pending) {
    return { ok: false, error: "pending_action_not_found" };
  }

  if (pending.status === "executed") {
    return {
      ok: true,
      status: "executed",
      already_executed: true,
      summary: pending.confirmation_summary,
      waitlist_ref: pending.execution_ref ?? null,
    };
  }

  if (pending.status !== "pending") {
    return { ok: false, error: "pending_action_not_available" };
  }

  if (new Date(pending.expires_at).getTime() <= Date.now()) {
    await ctx.supabase
      .from("assistant_pending_actions")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");
    return { ok: false, error: "confirmation_expired" };
  }

  const payload = asObject(pending.action_payload);
  if (!payload) return { ok: false, error: "pending_action_invalid" };

  if (String(payload.prepared_turn_id ?? "") === ctx.turnId) {
    return { ok: false, error: "confirmation_requires_new_turn" };
  }

  if (!isExplicitAssistantConfirmation(ctx.currentUserMessage)) {
    return { ok: false, error: "explicit_confirmation_required" };
  }

  const studentId = String(payload.student_id ?? "");
  const sessionId = String(payload.session_id ?? "");
  if (!ctx.studentId || studentId !== ctx.studentId) {
    return { ok: false, error: "conversation_identity_changed" };
  }

  const sessionInfo = await getSessionSummary(ctx, sessionId);
  if (!sessionInfo) return { ok: false, error: "session_not_found" };

  const previewRequest = ctx.serviceMode
    ? await ctx.supabase.rpc("service_waitlist_preview", {
        target_studio_id: ctx.studio.id,
        target_session_id: sessionId,
        target_student_id: studentId,
      })
    : await ctx.supabase.rpc("admin_waitlist_preview", {
        target_session_id: sessionId,
        target_student_id: studentId,
      });
  const { data: preview, error: previewError } = previewRequest;

  if (previewError) {
    return { ok: false, error: "waitlist_preview_unavailable" };
  }

  const previewObject = asObject(preview);
  if (!previewObject || previewObject.ok !== true) {
    await ctx.supabase
      .from("assistant_pending_actions")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");

    return {
      ok: false,
      error: "waitlist_no_longer_eligible",
      ...safeWaitlistReason(previewObject?.reason_code),
    };
  }

  if (previewObject.reused === true) {
    const executedAt = new Date().toISOString();
    const waitlistRef = previewObject.waitlist_entry_id
      ? `waitlist:${String(previewObject.waitlist_entry_id)}`
      : null;

    await ctx.supabase
      .from("assistant_pending_actions")
      .update({
        status: "executed",
        confirmed_at: executedAt,
        executed_at: executedAt,
        execution_ref: waitlistRef,
        updated_at: executedAt,
      })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");

    return {
      ok: true,
      status: "executed",
      already_active: true,
      waitlist_ref: waitlistRef,
      summary: {
        ...sessionInfo.summary,
        waitlist: true,
        credit_charged_now: false,
      },
    };
  }

  const joinRequest = ctx.serviceMode
    ? await ctx.supabase.rpc("service_join_waitlist", {
        target_studio_id: ctx.studio.id,
        target_session_id: sessionId,
        target_student_id: studentId,
      })
    : await ctx.supabase.rpc("admin_join_waitlist", {
        target_session_id: sessionId,
        target_student_id: studentId,
      });
  const { data: joined, error: joinError } = joinRequest;

  const joinedObject = asObject(joined);
  if (joinError || !joinedObject || joinedObject.ok !== true) {
    return {
      ok: false,
      error: "waitlist_join_failed",
      ...safeWaitlistReason(joinedObject?.reason_code),
    };
  }

  const executedAt = new Date().toISOString();
  const waitlistRef = joinedObject.waitlist_entry_id
    ? `waitlist:${String(joinedObject.waitlist_entry_id)}`
    : null;

  await ctx.supabase
    .from("assistant_pending_actions")
    .update({
      status: "executed",
      confirmed_at: executedAt,
      executed_at: executedAt,
      execution_ref: waitlistRef,
      updated_at: executedAt,
    })
    .eq("id", pending.id)
    .eq("studio_id", ctx.studio.id)
    .eq("status", "pending");

  return {
    ok: true,
    status: "executed",
    waitlist_ref: waitlistRef,
    summary: {
      ...sessionInfo.summary,
      waitlist: true,
      credit_charged_now: false,
    },
  };
}

async function prepareStudentAccessActivation(
  ctx: AssistantActionToolContext,
  args: PrepareStudentAccessActivationArgs,
) {
  void args;
  if (!ctx.studentId) return { ok: false, error: "identity_required" };

  const { data, error } = await ctx.supabase.rpc("assistant_post_trial_requirement", {
    target_studio_id: ctx.studio.id,
    target_student_id: ctx.studentId,
  });

  const requirement = asObject(data);
  if (error || !requirement || requirement.ok !== true) {
    return { ok: false, error: "post_trial_requirement_unavailable" };
  }

  if (requirement.post_trial !== true) {
    return { ok: false, error: "post_trial_not_reached" };
  }

  const accessState = String(requirement.access_state ?? "");
  if (accessState === "active") {
    return {
      ok: true,
      status: "already_active",
      summary: requirement,
    };
  }

  if (!["not_provisioned", "activation_pending"].includes(accessState)) {
    return {
      ok: false,
      error: "student_access_inconsistent",
      summary: requirement,
    };
  }

  const now = new Date().toISOString();
  await ctx.supabase
    .from("assistant_pending_actions")
    .update({ status: "cancelled", updated_at: now })
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "account.activate")
    .eq("status", "pending");

  const secretToken = randomUUID();
  const tokenHash = createHash("sha256").update(secretToken).digest("hex");
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

  const { data: pending, error: pendingError } = await ctx.supabase
    .from("assistant_pending_actions")
    .insert({
      studio_id: ctx.studio.id,
      conversation_id: ctx.conversationId,
      action_type: "account.activate",
      action_token_hash: tokenHash,
      action_payload: {
        student_id: ctx.studentId,
        mode: accessState === "activation_pending" ? "resend" : "provision",
        prepared_turn_id: ctx.turnId,
      },
      confirmation_summary: requirement,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (pendingError || !pending) {
    return { ok: false, error: "pending_action_create_failed" };
  }

  return {
    ok: true,
    status: "confirmation_required",
    expires_at: expiresAt,
    summary: requirement,
  };
}

async function executeStudentAccessActivation(ctx: AssistantActionToolContext) {
  const { data: pending, error: pendingError } = await ctx.supabase
    .from("assistant_pending_actions")
    .select("id,action_type,action_payload,confirmation_summary,status,expires_at,execution_ref")
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "account.activate")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingError || !pending) {
    return { ok: false, error: "pending_action_not_found" };
  }

  if (pending.status === "executed") {
    return {
      ok: true,
      status: "executed",
      already_executed: true,
      summary: pending.confirmation_summary,
      execution_ref: pending.execution_ref ?? null,
    };
  }

  if (pending.status !== "pending") {
    return { ok: false, error: "pending_action_not_available" };
  }

  if (new Date(pending.expires_at).getTime() <= Date.now()) {
    await ctx.supabase
      .from("assistant_pending_actions")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");
    return { ok: false, error: "confirmation_expired" };
  }

  const payload = asObject(pending.action_payload);
  if (!payload) return { ok: false, error: "pending_action_invalid" };

  if (String(payload.prepared_turn_id ?? "") === ctx.turnId) {
    return { ok: false, error: "confirmation_requires_new_turn" };
  }

  if (!isExplicitAssistantConfirmation(ctx.currentUserMessage)) {
    return { ok: false, error: "explicit_confirmation_required" };
  }

  const studentId = String(payload.student_id ?? "");
  const mode = String(payload.mode ?? "");
  if (!ctx.studentId || studentId !== ctx.studentId) {
    return { ok: false, error: "conversation_identity_changed" };
  }

  if (!ctx.activationUrl) {
    return { ok: false, error: "activation_url_unavailable" };
  }

  if (ctx.serviceMode) {
    const provision = await provisionStudentAccessWithServiceClient(
      ctx,
      studentId,
      mode === "resend" ? "resend" : "provision",
    );

    if (!provision.generated || !provision.activation_url) {
      return {
        ok: false,
        error: "student_access_provision_failed",
        reason_code: provision.error ?? "student_access_provision_failed",
      };
    }

    const executedAt = new Date().toISOString();
    await ctx.supabase
      .from("assistant_pending_actions")
      .update({
        status: "executed",
        confirmed_at: executedAt,
        executed_at: executedAt,
        execution_ref: `student-access:${studentId}`,
        updated_at: executedAt,
      })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");

    return {
      ok: true,
      status: "executed",
      activation_url: provision.activation_url,
      summary: pending.confirmation_summary,
    };
  }

  const {
    data: { session },
  } = await ctx.supabase.auth.getSession();

  if (!session?.access_token) {
    return { ok: false, error: "activation_authorization_unavailable" };
  }

  const body =
    mode === "resend"
      ? {
          studentId,
          mode: "resend",
          activationUrl: ctx.activationUrl,
          delivery: "return_link",
        }
      : {
          studentId,
          activationUrl: ctx.activationUrl,
          delivery: "return_link",
        };

  const { data, error } = await ctx.supabase.functions.invoke("provision-student-access", {
    body,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  const response = asObject(data);
  if (error || !response || response.ok !== true || typeof response.activationLink !== "string") {
    return {
      ok: false,
      error: "student_access_provision_failed",
      reason_code: String(response?.error ?? "student_access_provision_failed"),
    };
  }

  const executedAt = new Date().toISOString();
  await ctx.supabase
    .from("assistant_pending_actions")
    .update({
      status: "executed",
      confirmed_at: executedAt,
      executed_at: executedAt,
      execution_ref: `student-access:${studentId}`,
      updated_at: executedAt,
    })
    .eq("id", pending.id)
    .eq("studio_id", ctx.studio.id)
    .eq("status", "pending");

  return {
    ok: true,
    status: "executed",
    activation_url: response.activationLink,
    summary: pending.confirmation_summary,
  };
}

export function parsePostTrialEnrollmentMethod(value: string) {
  const normalized = normalizeConfirmation(value);
  if (!normalized) return null;

  if (
    normalized === "efectivo" ||
    normalized === "en efectivo" ||
    normalized === "cash" ||
    normalized.includes("efectivo en el estudio")
  ) {
    return "cash" as const;
  }

  if (
    normalized === "transferencia" ||
    normalized === "transfer" ||
    normalized.includes("transferencia bancaria") ||
    normalized.includes("por transferencia")
  ) {
    return "bank_transfer" as const;
  }

  if (
    normalized === "app" ||
    normalized === "aplicacion" ||
    normalized === "aplicacion movil" ||
    normalized.includes("desde la app") ||
    normalized.includes("en la app") ||
    normalized.includes("mercado pago") ||
    normalized.includes("pagar en linea")
  ) {
    return "app" as const;
  }

  return null;
}

async function resolvePostTrialEnrollmentMethod(
  ctx: AssistantActionToolContext,
  method: "cash" | "bank_transfer" | "app",
) {
  const { data: pending, error: pendingError } = await ctx.supabase
    .from("assistant_pending_actions")
    .select("id,action_payload,confirmation_summary,status,expires_at")
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "enrollment.resolve")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingError || !pending) {
    return { ok: false, error: "pending_enrollment_not_found" };
  }

  if (pending.status !== "pending") {
    return { ok: false, error: "pending_enrollment_not_available" };
  }

  if (new Date(pending.expires_at).getTime() <= Date.now()) {
    await ctx.supabase
      .from("assistant_pending_actions")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");
    return { ok: false, error: "enrollment_choice_expired" };
  }

  const payload = asObject(pending.action_payload);
  const summary = asObject(pending.confirmation_summary);
  if (!payload || !summary) {
    return { ok: false, error: "pending_enrollment_invalid" };
  }

  const studentId = String(payload.student_id ?? "");
  const sessionId = String(payload.session_id ?? "");
  if (!ctx.studentId || studentId !== ctx.studentId || !sessionId) {
    return { ok: false, error: "conversation_identity_changed" };
  }

  if (method === "cash" || method === "bank_transfer") {
    const { data, error } = await ctx.supabase.rpc("assistant_create_post_trial_reservation", {
      target_studio_id: ctx.studio.id,
      target_conversation_id: ctx.conversationId,
      target_student_id: studentId,
      target_session_id: sessionId,
      target_payment_method: method,
    });

    const result = asObject(data);
    if (error || !result || result.ok !== true) {
      return {
        ok: false,
        error: "post_trial_reservation_failed",
        reason_code: String(result?.reason_code ?? "post_trial_reservation_failed"),
      };
    }

    await ctx.supabase
      .from("assistant_pending_actions")
      .update({
        status: "executed",
        confirmed_at: new Date().toISOString(),
        executed_at: new Date().toISOString(),
        execution_ref: `enrollment-intent:${String(result.intent_id ?? "")}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pending.id)
      .eq("studio_id", ctx.studio.id)
      .eq("status", "pending");

    return {
      ok: true,
      status: "executed",
      payment_method: method,
      review_required: result.review_required === true,
      enrollment_amount_minor: Number(result.enrollment_amount_minor ?? 0),
      currency: String(result.currency ?? ctx.studio.currency),
      reservation_id: String(result.reservation_id ?? ""),
      summary,
    };
  }

  const requirement = asObject(summary);
  const accessState = String(requirement?.access_state ?? "");

  if (!ctx.activationUrl) {
    return { ok: false, error: "activation_url_unavailable" };
  }

  const appOrigin = new URL(ctx.activationUrl).origin;
  let directUrl = `${appOrigin}/student/paquete?inscripcion=1`;
  let activationLink: string | null = null;

  if (accessState === "active") {
    directUrl = `${appOrigin}/student/paquete?inscripcion=1`;
  } else if (["not_provisioned", "activation_pending"].includes(accessState)) {
    if (ctx.serviceMode) {
      const provision = await provisionStudentAccessWithServiceClient(
        ctx,
        studentId,
        accessState === "activation_pending" ? "resend" : "provision",
      );
      if (!provision.generated || !provision.activation_url) {
        return {
          ok: false,
          error: "student_access_provision_failed",
          reason_code: provision.error ?? "student_access_provision_failed",
        };
      }
      activationLink = provision.activation_url;
    } else {
      const {
        data: { session },
      } = await ctx.supabase.auth.getSession();

      if (!session?.access_token) {
        return { ok: false, error: "activation_authorization_unavailable" };
      }

      const body =
        accessState === "activation_pending"
          ? {
              studentId,
              mode: "resend",
              activationUrl: ctx.activationUrl,
              delivery: "return_link",
            }
          : {
              studentId,
              activationUrl: ctx.activationUrl,
              delivery: "return_link",
            };

      const { data, error } = await ctx.supabase.functions.invoke("provision-student-access", {
        body,
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      const provision = asObject(data);
      if (error || !provision || provision.ok !== true) {
        return {
          ok: false,
          error: "student_access_provision_failed",
          reason_code: String(provision?.error ?? "student_access_provision_failed"),
        };
      }

      activationLink =
        typeof provision.activationLink === "string" ? provision.activationLink : null;

      if (!activationLink && provision.mustChangePassword !== false) {
        return { ok: false, error: "activation_link_missing" };
      }
    }
  } else {
    return { ok: false, error: "student_access_inconsistent" };
  }

  const enrollmentProduct = asObject(requirement?.enrollment_product);
  if (!enrollmentProduct?.id) {
    return { ok: false, error: "enrollment_product_not_configured" };
  }

  const { data: intentData, error: intentError } = await ctx.supabase.rpc(
    "assistant_create_online_enrollment_intent",
    {
      target_studio_id: ctx.studio.id,
      target_conversation_id: ctx.conversationId,
      target_student_id: studentId,
      target_session_id: sessionId,
    },
  );

  const intent = asObject(intentData);
  if (intentError || !intent || intent.ok !== true) {
    return {
      ok: false,
      error: "enrollment_intent_create_failed",
      reason_code: String(intent?.reason_code ?? "enrollment_intent_create_failed"),
    };
  }

  await ctx.supabase
    .from("assistant_pending_actions")
    .update({
      status: "executed",
      confirmed_at: new Date().toISOString(),
      executed_at: new Date().toISOString(),
      execution_ref: `student-access:${studentId}`,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pending.id)
    .eq("studio_id", ctx.studio.id)
    .eq("status", "pending");

  return {
    ok: true,
    status: "executed",
    payment_method: "app",
    activation_url: activationLink,
    app_url: directUrl,
    enrollment_amount_minor: Number(enrollmentProduct.price_minor ?? 0),
    currency: String(enrollmentProduct.currency ?? ctx.studio.currency),
    summary,
  };
}

async function prepareTransferPackageChoice(
  ctx: AssistantActionToolContext,
  args: PrepareTransferPackageChoiceArgs,
) {
  if (!ctx.studentId) return { ok: false, error: "identity_required" };

  const rawSessionRef = args.session_ref?.trim() || null;
  const sessionId = rawSessionRef ? parseOpaqueRef(rawSessionRef, "session") : null;
  if (rawSessionRef && !sessionId) return { ok: false, error: "invalid_session_ref" };

  const requestedRefs = Array.from(
    new Set((args.product_refs ?? []).map((value) => String(value ?? "").trim()).filter(Boolean)),
  ).slice(0, 10);
  if (!requestedRefs.length) return { ok: false, error: "transfer_package_options_required" };

  const commercialRaw = await getCommercialOptions(
    { supabase: ctx.supabase, studio: ctx.studio, studentId: ctx.studentId },
    { session_ref: rawSessionRef },
  );
  const commercial = asObject(commercialRaw);
  if (!commercial || commercial.ok !== true) return commercialRaw;

  const paymentOptions = Array.isArray(commercial.payment_options)
    ? commercial.payment_options
        .map((item) => asObject(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  if (!paymentOptions.some((item) => String(item.code ?? "") === "bank_transfer")) {
    return { ok: false, error: "bank_transfer_not_available" };
  }

  const commercialOptions = Array.isArray(commercial.options)
    ? commercial.options
        .map((item) => asObject(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  const selectedOptions = commercialOptions.filter((item) =>
    requestedRefs.includes(String(item.product_ref ?? "")),
  );
  if (!selectedOptions.length) return { ok: false, error: "transfer_package_options_invalid" };

  const now = new Date().toISOString();
  await ctx.supabase
    .from("assistant_pending_actions")
    .update({ status: "cancelled", updated_at: now })
    .eq("studio_id", ctx.studio.id)
    .eq("conversation_id", ctx.conversationId)
    .eq("action_type", "commerce.transfer_package_choice")
    .eq("status", "pending");

  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const tokenHash = createHash("sha256").update(randomUUID()).digest("hex");
  const options = selectedOptions.map((item, index) => ({
    option_number: index + 1,
    product_ref: String(item.product_ref ?? ""),
    name: String(item.name ?? ""),
    price_minor: Number(item.price_minor ?? 0),
    currency: String(item.currency ?? ctx.studio.currency),
    credit_limit: item.credit_limit == null ? null : Number(item.credit_limit),
    unlimited: item.unlimited === true,
    package_term: item.package_term == null ? null : String(item.package_term),
  }));

  const { error } = await ctx.supabase.from("assistant_pending_actions").insert({
    studio_id: ctx.studio.id,
    conversation_id: ctx.conversationId,
    action_type: "commerce.transfer_package_choice",
    action_token_hash: tokenHash,
    action_payload: {
      stage: "package_choice",
      session_ref: rawSessionRef,
      session_id: sessionId,
      student_id: ctx.studentId,
      payment_method: "bank_transfer",
      options,
      prepared_turn_id: ctx.turnId,
    },
    confirmation_summary: {
      session_ref: rawSessionRef,
      payment_method: "bank_transfer",
      options,
    },
    status: "pending",
    expires_at: expiresAt,
  });
  if (error) return { ok: false, error: "transfer_package_choice_create_failed" };

  return {
    ok: true,
    status: "package_choice_required",
    expires_at: expiresAt,
    payment_method: "bank_transfer",
    session_ref: rawSessionRef,
    options,
  };
}

async function prepareBankTransferPurchase(
  ctx: AssistantActionToolContext,
  args: PrepareBankTransferPurchaseArgs,
) {
  if (!ctx.serviceMode) return { ok: false, error: "bank_transfer_purchase_requires_service_mode" };
  if (!ctx.studentId) return { ok: false, error: "identity_required" };

  const rawSessionRef = args.session_ref?.trim() || null;
  const sessionId = rawSessionRef ? parseOpaqueRef(rawSessionRef, "session") : null;
  const productId = parseOpaqueRef(args.product_ref, "product");
  if (rawSessionRef && !sessionId) return { ok: false, error: "invalid_session_ref" };
  if (!productId) return { ok: false, error: "invalid_product_ref" };

  const { data, error } = await ctx.supabase.rpc("service_prepare_transfer_purchase", {
    target_studio_id: ctx.studio.id,
    target_conversation_id: ctx.conversationId,
    target_student_id: ctx.studentId,
    target_session_id: sessionId,
    target_product_template_id: productId,
  });

  const result = asObject(data);
  if (error || !result || result.ok !== true) {
    return {
      ok: false,
      error: "bank_transfer_purchase_prepare_failed",
      reason_code: String(result?.reason_code ?? "bank_transfer_purchase_prepare_failed"),
    };
  }

  return {
    ok: true,
    status: "awaiting_receipt",
    intent_id: result.intent_id,
    package: result.package,
    bank_details: result.bank_details,
    receipt_required: result.receipt_required === true,
    revocable_until_validated: result.revocable_until_validated === true,
    activation_rule: result.activation_rule,
  };
}

async function escalateToHuman(ctx: AssistantActionToolContext, args: Record<string, unknown>) {
  const requestedReason = String(args.reason_code ?? "").trim();
  const aliases: Record<string, string> = {
    user_requested_human: "human_requested",
    assistant_cannot_resolve: "technical_block",
    transfer_receipt_review: "receipt_validation_failed",
    payment_validation: "receipt_validation_failed",
  };
  const reasonCode = aliases[requestedReason] ?? requestedReason;
  const note = String(args.note ?? "").trim() || null;
  if (!reasonCode) return { ok: false, error: "handoff_reason_required" };

  const { data: policy, error: policyError } = await ctx.supabase
    .from("assistant_handoff_policies")
    .select("reason_code,label,enabled,blocking")
    .eq("studio_id", ctx.studio.id)
    .eq("reason_code", reasonCode)
    .maybeSingle();

  if (policyError || !policy || policy.enabled !== true) {
    return { ok: false, error: "handoff_reason_not_enabled", reason_code: reasonCode };
  }

  const { data, error } = await ctx.supabase.rpc("assistant_create_handoff", {
    target_studio_id: ctx.studio.id,
    target_conversation_id: ctx.conversationId,
    target_student_id: ctx.studentId,
    target_reason_code: reasonCode,
    target_note: note,
  });

  const result = asObject(data);
  if (error || !result || result.ok !== true) {
    return { ok: false, error: "human_handoff_failed" };
  }

  return {
    ok: true,
    status: "human_handoff",
    reason_code: reasonCode,
    blocking: policy.blocking === true,
  };
}

async function recordTrialPaymentPreference(
  ctx: AssistantActionToolContext,
  args: RecordTrialPaymentPreferenceArgs,
) {
  const method = args.payment_method;
  if (!["cash", "bank_transfer"].includes(method)) {
    return { ok: false, error: "payment_method_not_supported" };
  }

  const { data, error } = await ctx.supabase.rpc("assistant_record_trial_payment_preference", {
    target_studio_id: ctx.studio.id,
    target_assistant_conversation_id: ctx.conversationId,
    target_payment_preference: method,
  });

  const result = asObject(data);
  if (error || !result || result.ok !== true) {
    return {
      ok: false,
      error: "payment_preference_record_failed",
      reason_code: String(result?.reason_code ?? "payment_preference_record_failed"),
    };
  }

  return {
    ok: true,
    status: "recorded",
    payment_method: method,
    amount_minor: result.amount_minor == null ? null : Number(result.amount_minor),
    currency: String(result.currency ?? ctx.studio.currency),
    first_class_no_enrollment: result.first_class_no_enrollment === true,
    enrollment_required_after_first_attendance:
      result.enrollment_required_after_first_attendance === true,
    marks_payment_received: false,
    transfer_details_configured: result.transfer_details_configured === true,
  };
}

export async function executeAssistantActionTool(
  ctx: AssistantActionToolContext,
  toolName: string,
  args: Record<string, unknown>,
) {
  switch (toolName) {
    case "prepare_enrollment_payment": {
      if (!ctx.serviceMode || !ctx.studentId)
        return { ok: false, reason_code: "verified_student_required" };
      const result = await ctx.supabase.rpc("service_prepare_demi_enrollment_payment", {
        p_studio: ctx.studio.id,
        p_conversation: ctx.conversationId,
        p_student: ctx.studentId,
        p_method: args.payment_method,
      });
      if (result.error) return { ok: false, reason_code: "enrollment_payment_prepare_failed" };
      if (result.data?.ok && args.payment_method === "app") {
        const access = await provisionStudentAccessWithServiceClient(
          ctx,
          ctx.studentId,
          "provision",
        );
        if (!access.already_has_access && (!access.generated || !access.activation_url))
          return { ok: false, reason_code: "enrollment_access_unavailable" };
        return {
          ...result.data,
          activation_url: access.activation_url,
          app_url: ctx.activationUrl
            ? new URL("/student/paquete?inscripcion=1", ctx.activationUrl).toString()
            : null,
        };
      }
      return result.data;
    }
    case "identify_meta_contact": {
      if (!ctx.serviceMode || !["facebook_messenger", "instagram"].includes(ctx.channel ?? ""))
        return { ok: false, reason_code: "meta_conversation_required" };
      const result = await ctx.supabase.rpc("service_identify_demi_meta_contact", {
        p_studio: ctx.studio.id,
        p_conversation: ctx.conversationId,
        p_phone: args.phone,
      });
      return result.error ? { ok: false, reason_code: "identity_lookup_failed" } : result.data;
    }
    case "update_contact_followup": {
      const result = await ctx.supabase.rpc("service_update_demi_followup_stage", {
        p_studio: ctx.studio.id,
        p_conversation: ctx.conversationId,
        p_stage: args.stage,
        p_reason: args.reason,
        p_source: ctx.turnId,
      });
      return result.error
        ? { ok: false, reason_code: "crm_followup_update_failed", error_code: result.error.code }
        : result.data;
    }
    case "prepare_first_class_payment":
      return prepareFirstClassPayment(ctx, args);
    case "prepare_group_booking":
    case "complete_group_booking":
      return groupBookingAction({
        supabase: ctx.supabase,
        studioId: ctx.studio.id,
        conversationId: ctx.conversationId,
        tool: toolName,
        args,
        currentUserMessage: ctx.currentUserMessage,
      });
    case "prepare_cash_package_purchase":
      return prepareCashPackage(ctx, args as Record<string, unknown>);
    case "confirm_cash_package_purchase":
      return confirmCashPackage(ctx);
    case "prepare_booking":
      return prepareBooking(ctx, args as PrepareBookingArgs);
    case "execute_booking":
      return executeBooking(ctx, args as ExecuteBookingArgs);
    case "prepare_cancellation":
      return prepareCancellation(ctx, args as PrepareCancellationArgs);
    case "execute_cancellation":
      return executeCancellation(ctx, args as ExecuteCancellationArgs);
    case "prepare_reschedule":
      return prepareReschedule(ctx, args as PrepareRescheduleArgs);
    case "execute_reschedule":
      return executeReschedule(ctx, args as ExecuteRescheduleArgs);
    case "select_resource_option":
      return selectResourceOption(ctx, args as SelectResourceOptionArgs);
    case "prepare_waitlist_join":
      return prepareWaitlistJoin(ctx, args as PrepareWaitlistJoinArgs);
    case "execute_waitlist_join":
      return executeWaitlistJoin(ctx, args as ExecuteWaitlistJoinArgs);
    case "prepare_transfer_package_choice":
      return prepareTransferPackageChoice(ctx, args as PrepareTransferPackageChoiceArgs);
    case "prepare_bank_transfer_purchase":
      return prepareBankTransferPurchase(ctx, args as PrepareBankTransferPurchaseArgs);
    case "record_trial_payment_preference":
      return recordTrialPaymentPreference(ctx, args as RecordTrialPaymentPreferenceArgs);
    case "prepare_student_access_activation":
      return prepareStudentAccessActivation(ctx, args as PrepareStudentAccessActivationArgs);
    case "execute_student_access_activation":
      return executeStudentAccessActivation(ctx);
    case "resolve_post_trial_enrollment_method":
      return resolvePostTrialEnrollmentMethod(
        ctx,
        String((args as Record<string, unknown>).payment_method ?? "") as
          "cash" | "bank_transfer" | "app",
      );
    case "escalate_to_human":
      return escalateToHuman(ctx, args as Record<string, unknown>);
    default:
      return { ok: false, error: "tool_not_allowed" };
  }
}
