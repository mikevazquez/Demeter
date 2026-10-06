import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommercialOptionsArgs, SearchClassAvailabilityArgs } from "./tool-contracts";

export type AssistantStudioContext = {
  id: string;
  name: string;
  timezone: string;
  currency: string;
};

export type AssistantToolContext = {
  supabase: SupabaseClient;
  studio: AssistantStudioContext;
  studentId?: string | null;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX")
    .trim();
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validTime(value: string | null) {
  return value == null || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function addUtcDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

function sessionRef(id: string) {
  return `session:${id}`;
}

function reservationRef(id: string) {
  return `reservation:${id}`;
}

function sessionIdFromRef(value: string | null) {
  if (!value) return null;
  const match =
    /^session:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(
      value.trim(),
    );
  return match?.[1] ?? null;
}

export async function searchClassAvailability(
  ctx: AssistantToolContext,
  rawArgs: SearchClassAvailabilityArgs,
) {
  if (!validDate(rawArgs.date_from) || !validDate(rawArgs.date_to)) {
    return { ok: false, error: "invalid_date" };
  }
  if (!validTime(rawArgs.after_time) || !validTime(rawArgs.before_time)) {
    return { ok: false, error: "invalid_time" };
  }
  if (rawArgs.date_to < rawArgs.date_from) {
    return { ok: false, error: "invalid_date_range" };
  }

  const requestedDays =
    Math.round(
      (Date.parse(`${rawArgs.date_to}T12:00:00Z`) - Date.parse(`${rawArgs.date_from}T12:00:00Z`)) /
        86_400_000,
    ) + 1;
  if (requestedDays > 14) {
    return { ok: false, error: "date_range_too_large", max_days: 14 };
  }

  const limit = Math.max(1, Math.min(Number(rawArgs.limit) || 10, 20));
  const coarseStart = `${addUtcDays(rawArgs.date_from, -1)}T00:00:00.000Z`;
  const coarseEnd = `${addUtcDays(rawArgs.date_to, 2)}T00:00:00.000Z`;

  const { data: sessions, error: sessionsError } = await ctx.supabase
    .from("class_sessions")
    .select("id,template_id,starts_at,ends_at,capacity,status,location_id,space_id")
    .eq("studio_id", ctx.studio.id)
    .eq("status", "scheduled")
    .eq("assistant_visible", true)
    .gte("starts_at", coarseStart)
    .lt("starts_at", coarseEnd)
    .order("starts_at", { ascending: true })
    .limit(250);

  if (sessionsError) return { ok: false, error: "schedule_unavailable" };

  const templateIds = [...new Set((sessions ?? []).map((item) => item.template_id))];
  const locationIds = [
    ...new Set((sessions ?? []).map((item) => item.location_id).filter(Boolean)),
  ] as string[];
  const spaceIds = [
    ...new Set((sessions ?? []).map((item) => item.space_id).filter(Boolean)),
  ] as string[];
  const sessionIds = (sessions ?? []).map((item) => item.id);

  const [templatesResult, locationsResult, spacesResult, reservationsResult] = await Promise.all([
    templateIds.length
      ? ctx.supabase
          .from("class_templates")
          .select("id,name,discipline_id,description,active,credit_cost")
          .eq("studio_id", ctx.studio.id)
          .in("id", templateIds)
      : Promise.resolve({ data: [], error: null }),
    locationIds.length
      ? ctx.supabase
          .from("studio_locations")
          .select("id,name,address")
          .eq("studio_id", ctx.studio.id)
          .in("id", locationIds)
      : Promise.resolve({ data: [], error: null }),
    spaceIds.length
      ? ctx.supabase
          .from("spaces")
          .select("id,name")
          .eq("studio_id", ctx.studio.id)
          .in("id", spaceIds)
      : Promise.resolve({ data: [], error: null }),
    sessionIds.length
      ? ctx.supabase
          .from("reservations")
          .select("session_id,status")
          .eq("studio_id", ctx.studio.id)
          .in("session_id", sessionIds)
          .eq("status", "reserved")
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (
    templatesResult.error ||
    locationsResult.error ||
    spacesResult.error ||
    reservationsResult.error
  ) {
    return { ok: false, error: "schedule_details_unavailable" };
  }

  const templates = templatesResult.data ?? [];
  const disciplineIds = [
    ...new Set(templates.map((item) => item.discipline_id).filter(Boolean)),
  ] as string[];
  const { data: disciplines, error: disciplinesError } = disciplineIds.length
    ? await ctx.supabase
        .from("disciplines")
        .select("id,name")
        .eq("studio_id", ctx.studio.id)
        .in("id", disciplineIds)
    : { data: [], error: null };

  if (disciplinesError) return { ok: false, error: "schedule_details_unavailable" };

  const templateMap = new Map(templates.map((item) => [item.id, item]));
  const disciplineMap = new Map((disciplines ?? []).map((item) => [item.id, item.name]));
  const locationMap = new Map((locationsResult.data ?? []).map((item) => [item.id, item]));
  const spaceMap = new Map((spacesResult.data ?? []).map((item) => [item.id, item.name]));
  const reservationCount = new Map<string, number>();
  for (const item of reservationsResult.data ?? []) {
    reservationCount.set(item.session_id, (reservationCount.get(item.session_id) ?? 0) + 1);
  }

  const activityNeedle = rawArgs.activity_query ? normalize(rawArgs.activity_query) : null;
  const exactTemplateMatchExists = activityNeedle
    ? templates.some((item) => normalize(item.name) === activityNeedle)
    : false;
  const matches = [];

  for (const session of sessions ?? []) {
    const template = templateMap.get(session.template_id);
    if (!template?.active) continue;
    const discipline = template.discipline_id
      ? (disciplineMap.get(template.discipline_id) ?? null)
      : null;
    if (activityNeedle) {
      const templateName = normalize(template.name);
      const disciplineName = normalize(discipline ?? "");
      const matchesActivity = exactTemplateMatchExists
        ? templateName === activityNeedle
        : templateName.includes(activityNeedle) ||
          disciplineName === activityNeedle ||
          disciplineName.includes(activityNeedle);
      if (!matchesActivity) continue;
    }

    const localStart = localParts(session.starts_at, ctx.studio.timezone);
    const localEnd = localParts(session.ends_at, ctx.studio.timezone);
    if (localStart.date < rawArgs.date_from || localStart.date > rawArgs.date_to) continue;
    if (rawArgs.after_time && localStart.time < rawArgs.after_time) continue;
    if (rawArgs.before_time && localStart.time > rawArgs.before_time) continue;

    const reserved = reservationCount.get(session.id) ?? 0;
    const available = Math.max(session.capacity - reserved, 0);
    const location = session.location_id ? locationMap.get(session.location_id) : null;

    matches.push({
      session_ref: sessionRef(session.id),
      activity: template.name,
      discipline,
      date: localStart.date,
      starts_at_local: localStart.time,
      ends_at_local: localEnd.time,
      is_full: available <= 0,
      location: location?.name ?? null,
      address: location?.address ?? null,
      space: session.space_id ? (spaceMap.get(session.space_id) ?? null) : null,
      currency: ctx.studio.currency,
      credit_cost: template.credit_cost,
    });

    if (matches.length >= limit) break;
  }

  return {
    ok: true,
    timezone: ctx.studio.timezone,
    matches,
    has_more: matches.length >= limit,
  };
}

export async function getActivityCatalog(ctx: AssistantToolContext) {
  const { data: templates, error } = await ctx.supabase
    .from("class_templates")
    .select("id,name,discipline_id,description,credit_cost")
    .eq("studio_id", ctx.studio.id)
    .eq("active", true)
    .order("name")
    .limit(50);

  if (error) return { ok: false, error: "activities_unavailable" };

  const disciplineIds = [
    ...new Set((templates ?? []).map((item) => item.discipline_id).filter(Boolean)),
  ] as string[];
  const { data: disciplines } = disciplineIds.length
    ? await ctx.supabase
        .from("disciplines")
        .select("id,name")
        .eq("studio_id", ctx.studio.id)
        .in("id", disciplineIds)
    : { data: [] };

  const disciplineMap = new Map((disciplines ?? []).map((item) => [item.id, item.name]));

  return {
    ok: true,
    activities: (templates ?? []).map((item) => ({
      activity: item.name,
      discipline: item.discipline_id ? (disciplineMap.get(item.discipline_id) ?? null) : null,
      description: item.description,
      currency: ctx.studio.currency,
      credit_cost: item.credit_cost,
    })),
  };
}

export async function getCommercialOptions(
  ctx: AssistantToolContext,
  rawArgs: CommercialOptionsArgs,
) {
  const requestedSessionRef = rawArgs.session_ref?.trim() || null;
  let sessionScope: {
    session_ref: string;
    template_id: string;
    discipline_id: string;
    recurring_schedule_id: string | null;
    activity: string;
  } | null = null;

  if (requestedSessionRef) {
    const sessionId = sessionIdFromRef(requestedSessionRef);
    if (!sessionId) return { ok: false, error: "invalid_session_ref" };

    const { data: session, error: sessionError } = await ctx.supabase
      .from("class_sessions")
      .select("id,template_id,recurring_schedule_id")
      .eq("studio_id", ctx.studio.id)
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionError) return { ok: false, error: "commercial_options_unavailable" };
    if (!session) return { ok: false, error: "session_not_found" };

    const { data: template, error: templateError } = await ctx.supabase
      .from("class_templates")
      .select("id,name,discipline_id")
      .eq("studio_id", ctx.studio.id)
      .eq("id", session.template_id)
      .maybeSingle();

    if (templateError) return { ok: false, error: "commercial_options_unavailable" };
    if (!template?.discipline_id) {
      return { ok: false, error: "session_commercial_scope_unavailable" };
    }

    sessionScope = {
      session_ref: requestedSessionRef,
      template_id: template.id,
      discipline_id: template.discipline_id,
      recurring_schedule_id: session.recurring_schedule_id,
      activity: template.name,
    };
  }

  const { data, error } = await ctx.supabase
    .from("product_templates")
    .select(
      "id,name,description,product_type,price_minor,currency,credit_limit,validity_days,unlimited,package_term,online_purchasable,reward_credit_wallet,assistant_visible",
    )
    .eq("studio_id", ctx.studio.id)
    .eq("active", true)
    .order("price_minor", { ascending: true })
    .limit(50);

  if (error) return { ok: false, error: "commercial_options_unavailable" };

  let products = (data ?? []).filter(
    (item) => !item.reward_credit_wallet && item.assistant_visible !== false,
  );

  if (sessionScope && products.length) {
    const productIds = products.map((item) => item.id);
    const [activitiesResult, disciplinesResult, schedulesResult] = await Promise.all([
      ctx.supabase
        .from("product_template_activities")
        .select("product_template_id,class_template_id")
        .eq("studio_id", ctx.studio.id)
        .in("product_template_id", productIds),
      ctx.supabase
        .from("product_template_disciplines")
        .select("product_template_id,discipline_id")
        .eq("studio_id", ctx.studio.id)
        .in("product_template_id", productIds),
      ctx.supabase
        .from("product_template_schedules")
        .select("product_template_id,recurring_schedule_id")
        .eq("studio_id", ctx.studio.id)
        .in("product_template_id", productIds),
    ]);

    if (activitiesResult.error || disciplinesResult.error || schedulesResult.error) {
      return { ok: false, error: "commercial_compatibility_unavailable" };
    }

    const activityScopedProducts = new Set(
      (activitiesResult.data ?? []).map((item) => item.product_template_id),
    );
    const activityMatches = new Set(
      (activitiesResult.data ?? [])
        .filter((item) => item.class_template_id === sessionScope!.template_id)
        .map((item) => item.product_template_id),
    );
    const disciplineMatches = new Set(
      (disciplinesResult.data ?? [])
        .filter((item) => item.discipline_id === sessionScope!.discipline_id)
        .map((item) => item.product_template_id),
    );
    const scheduleScopedProducts = new Set(
      (schedulesResult.data ?? []).map((item) => item.product_template_id),
    );
    const scheduleMatches = new Set(
      (schedulesResult.data ?? [])
        .filter(
          (item) =>
            sessionScope!.recurring_schedule_id != null &&
            item.recurring_schedule_id === sessionScope!.recurring_schedule_id,
        )
        .map((item) => item.product_template_id),
    );

    products = products.filter((item) => {
      const scopeMatch =
        activityMatches.has(item.id) ||
        (!activityScopedProducts.has(item.id) && disciplineMatches.has(item.id));
      const scheduleMatch = !scheduleScopedProducts.has(item.id) || scheduleMatches.has(item.id);
      return scopeMatch && scheduleMatch;
    });
  }

  const { data: paymentMethods, error: paymentMethodsError } = await ctx.supabase
    .from("studio_payment_methods")
    .select("code,name,category,active,sort_order")
    .eq("studio_id", ctx.studio.id)
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (paymentMethodsError) {
    return { ok: false, error: "commercial_payment_methods_unavailable" };
  }

  const onlineCheckoutAvailable = products.some((item) => item.online_purchasable === true);
  const bankTransfer = (paymentMethods ?? []).find(
    (item) => item.code === "bank_transfer" || item.category === "transfer",
  );

  return {
    ok: true,
    ...(sessionScope
      ? {
          session_ref: sessionScope.session_ref,
          activity: sessionScope.activity,
          compatibility_filtered: true,
        }
      : { compatibility_filtered: false }),
    payment_options: [
      ...(onlineCheckoutAvailable
        ? [
            {
              code: "app_mercado_pago",
              label: "App / Mercado Pago",
              channel: "app",
              provider: "mercado_pago",
            },
          ]
        : []),
      ...(bankTransfer
        ? [
            {
              code: "bank_transfer",
              label: bankTransfer.name || "Transferencia",
              channel: "transfer",
              provider: null,
            },
          ]
        : []),
    ],
    options: products.map((item) => ({
      product_ref: `product:${item.id}`,
      name: item.name,
      description: item.description,
      product_type: item.product_type,
      price_minor: item.price_minor,
      currency: item.currency,
      credit_limit: item.credit_limit,
      validity_days: item.validity_days,
      unlimited: item.unlimited,
      package_term: item.package_term,
      online_purchasable: item.online_purchasable,
    })),
  };
}

export async function getStudioInformation(ctx: AssistantToolContext) {
  const { data: locations, error: locationError } = await ctx.supabase
    .from("studio_locations")
    .select("name,address")
    .eq("studio_id", ctx.studio.id)
    .eq("active", true)
    .order("created_at")
    .limit(10);

  if (locationError) {
    return { ok: false, error: "studio_information_unavailable" };
  }

  return {
    ok: true,
    name: ctx.studio.name,
    timezone: ctx.studio.timezone,
    currency: ctx.studio.currency,
    locations: (locations ?? []).map((location) => ({
      name: location.name,
      address: location.address,
      address_configured: Boolean(location.address?.trim()),
    })),
  };
}

export async function getPolicyInformation(ctx: AssistantToolContext) {
  const { data, error } = await ctx.supabase
    .from("studio_operating_policies")
    .select(
      "cancellation_cutoff_minutes,late_cancellation_consumes_credit,no_show_consumes_credit,unlimited_late_cancellation_penalty_minor,unlimited_no_show_penalty_minor",
    )
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();

  if (error) return { ok: false, error: "policies_unavailable" };
  if (!data) return { ok: true, configured: false };

  return {
    ok: true,
    configured: true,
    cancellation_cutoff_minutes: data.cancellation_cutoff_minutes,
    late_cancellation_consumes_credit: data.late_cancellation_consumes_credit,
    no_show_consumes_credit: data.no_show_consumes_credit,
    unlimited_late_cancellation_penalty_minor: data.unlimited_late_cancellation_penalty_minor,
    unlimited_no_show_penalty_minor: data.unlimited_no_show_penalty_minor,
    currency: ctx.studio.currency,
  };
}

export async function getStudentPackageStatus(ctx: AssistantToolContext) {
  if (!ctx.studentId) {
    return { ok: false, error: "identity_required" };
  }

  const today = localParts(new Date().toISOString(), ctx.studio.timezone).date;
  const [{ data: student, error: studentError }, { data: acquisitions, error: acquisitionsError }] =
    await Promise.all([
      ctx.supabase
        .from("students")
        .select("lifecycle_status,student_type,trial_status")
        .eq("studio_id", ctx.studio.id)
        .eq("id", ctx.studentId)
        .maybeSingle(),
      ctx.supabase
        .from("product_acquisitions")
        .select(
          "id,product_template_id,status,starts_on,expires_on,credit_limit,unlimited,access_blocked,created_at",
        )
        .eq("studio_id", ctx.studio.id)
        .eq("student_id", ctx.studentId)
        .is("refunded_at", null)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  if (studentError || acquisitionsError || !student) {
    return { ok: false, error: "package_status_unavailable" };
  }

  const current = (acquisitions ?? []).filter((item) => {
    if (item.status !== "active" || item.access_blocked) return false;
    if (item.starts_on && item.starts_on > today) return false;
    if (item.expires_on && item.expires_on < today) return false;
    return true;
  });
  const hasExpiredPackage = (acquisitions ?? []).some(
    (item) => Boolean(item.expires_on && item.expires_on < today),
  );
  const studentCategory =
    student.student_type === "trial"
      ? student.trial_status === "no_show"
        ? "trial_no_show"
        : student.trial_status === "attended"
          ? "trial_attended"
          : student.trial_status === "cancelled"
            ? "trial_cancelled"
            : "trial_pending"
      : student.lifecycle_status === "inactive" || (!current.length && hasExpiredPackage)
        ? "former_student"
        : "student";
  const studentState = {
    category: studentCategory,
    lifecycle_status: student.lifecycle_status,
    student_type: student.student_type,
    trial_status: student.trial_status,
    has_current_package: current.length > 0,
    has_expired_package: hasExpiredPackage,
  };

  if (!current.length) {
    return {
      ok: true,
      student_state: studentState,
      current_package: null,
      packages: [],
    };
  }

  const acquisitionIds = current.map((item) => item.id);
  const productIds = [
    ...new Set(current.map((item) => item.product_template_id).filter(Boolean)),
  ] as string[];

  const [productsResult, ledgerResult] = await Promise.all([
    productIds.length
      ? ctx.supabase
          .from("product_templates")
          .select("id,name")
          .eq("studio_id", ctx.studio.id)
          .in("id", productIds)
      : Promise.resolve({ data: [], error: null }),
    ctx.supabase
      .from("credit_ledger")
      .select("acquisition_id,quantity")
      .eq("studio_id", ctx.studio.id)
      .in("acquisition_id", acquisitionIds),
  ]);

  if (productsResult.error || ledgerResult.error) {
    return { ok: false, error: "package_status_unavailable" };
  }

  const productMap = new Map((productsResult.data ?? []).map((item) => [item.id, item.name]));
  const balanceMap = new Map<string, number>();
  for (const movement of ledgerResult.data ?? []) {
    balanceMap.set(
      movement.acquisition_id,
      (balanceMap.get(movement.acquisition_id) ?? 0) + Number(movement.quantity ?? 0),
    );
  }

  const packages = current.map((item) => {
    const availableCredits = item.unlimited ? null : Math.max(balanceMap.get(item.id) ?? 0, 0);

    return {
      name: productMap.get(item.product_template_id) ?? "Paquete",
      unlimited: item.unlimited,
      available_credits: availableCredits,
      credit_limit: item.credit_limit,
      starts_on: item.starts_on,
      expires_on: item.expires_on,
      depleted: !item.unlimited && (availableCredits ?? 0) <= 0,
    };
  });

  const currentPackage =
    packages.find((item) => item.unlimited || (item.available_credits ?? 0) > 0) ??
    packages[0] ??
    null;

  return {
    ok: true,
    student_state: studentState,
    current_package: currentPackage,
    packages,
  };
}

export async function getStudentReservations(ctx: AssistantToolContext) {
  if (!ctx.studentId) {
    return { ok: false, error: "identity_required" };
  }

  const { data: reservations, error: reservationError } = await ctx.supabase
    .from("reservations")
    .select("id,session_id,status,credits_held,acquisition_id,booked_at")
    .eq("studio_id", ctx.studio.id)
    .eq("student_id", ctx.studentId)
    .eq("status", "reserved")
    .order("booked_at", { ascending: false })
    .limit(50);

  if (reservationError) {
    return { ok: false, error: "reservations_unavailable" };
  }

  const sessionIds = [
    ...new Set((reservations ?? []).map((item) => item.session_id).filter(Boolean)),
  ] as string[];

  if (!sessionIds.length) {
    return { ok: true, reservations: [] };
  }

  const { data: sessions, error: sessionError } = await ctx.supabase
    .from("class_sessions")
    .select("id,template_id,starts_at,ends_at,status,location_id,space_id")
    .eq("studio_id", ctx.studio.id)
    .in("id", sessionIds)
    .gt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true });

  if (sessionError) {
    return { ok: false, error: "reservations_unavailable" };
  }

  const activeSessionIds = new Set((sessions ?? []).map((item) => item.id));
  const filteredReservations = (reservations ?? []).filter((item) =>
    activeSessionIds.has(item.session_id),
  );

  if (!filteredReservations.length) {
    return { ok: true, reservations: [] };
  }

  const templateIds = [
    ...new Set((sessions ?? []).map((item) => item.template_id).filter(Boolean)),
  ] as string[];
  const spaceIds = [
    ...new Set((sessions ?? []).map((item) => item.space_id).filter(Boolean)),
  ] as string[];
  const locationIds = [
    ...new Set((sessions ?? []).map((item) => item.location_id).filter(Boolean)),
  ] as string[];

  const [templatesResult, spacesResult, locationsResult] = await Promise.all([
    templateIds.length
      ? ctx.supabase
          .from("class_templates")
          .select("id,name")
          .eq("studio_id", ctx.studio.id)
          .in("id", templateIds)
      : Promise.resolve({ data: [], error: null }),
    spaceIds.length
      ? ctx.supabase
          .from("spaces")
          .select("id,name")
          .eq("studio_id", ctx.studio.id)
          .in("id", spaceIds)
      : Promise.resolve({ data: [], error: null }),
    locationIds.length
      ? ctx.supabase
          .from("studio_locations")
          .select("id,name")
          .eq("studio_id", ctx.studio.id)
          .in("id", locationIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (templatesResult.error || spacesResult.error || locationsResult.error) {
    return { ok: false, error: "reservation_details_unavailable" };
  }

  const sessionMap = new Map((sessions ?? []).map((item) => [item.id, item]));
  const templateMap = new Map((templatesResult.data ?? []).map((item) => [item.id, item.name]));
  const spaceMap = new Map((spacesResult.data ?? []).map((item) => [item.id, item.name]));
  const locationMap = new Map((locationsResult.data ?? []).map((item) => [item.id, item.name]));

  return {
    ok: true,
    reservations: filteredReservations
      .slice(0, 20)
      .map((reservation) => {
        const session = sessionMap.get(reservation.session_id);
        if (!session) return null;
        const start = localParts(session.starts_at, ctx.studio.timezone);
        const end = localParts(session.ends_at, ctx.studio.timezone);

        return {
          reservation_ref: reservationRef(reservation.id),
          activity: templateMap.get(session.template_id) ?? "Clase",
          date: start.date,
          starts_at_local: start.time,
          ends_at_local: end.time,
          location: session.location_id ? (locationMap.get(session.location_id) ?? null) : null,
          space: session.space_id ? (spaceMap.get(session.space_id) ?? null) : null,
          credit_cost: Math.max(Number(reservation.credits_held ?? 1), 1),
          status: reservation.status,
        };
      })
      .filter(Boolean),
  };
}

export async function executeAssistantReadTool(
  ctx: AssistantToolContext,
  toolName: string,
  args: Record<string, unknown>,
) {
  switch (toolName) {
    case "search_class_availability":
      return searchClassAvailability(ctx, args as SearchClassAvailabilityArgs);
    case "get_activity_catalog":
      return getActivityCatalog(ctx);
    case "get_commercial_options":
      return getCommercialOptions(ctx, args as CommercialOptionsArgs);
    case "get_studio_information":
      return getStudioInformation(ctx);
    case "get_policy_information":
      return getPolicyInformation(ctx);
    case "get_student_package_status":
      return getStudentPackageStatus(ctx);
    case "get_student_reservations":
      return getStudentReservations(ctx);
    default:
      return { ok: false, error: "tool_not_allowed" };
  }
}
