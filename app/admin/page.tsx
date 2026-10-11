import Link from "next/link";
import { redirect } from "next/navigation";
import { loadDemiCashDebts } from "@/lib/assistant/cash-debts";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import {
  countBookedReservations,
  countSeatOccupyingReservations,
} from "@/lib/reservations/capacity";
import { TodayClasses, type TodayClassItem } from "./hoy/TodayClasses";
import GlobalSearch from "./hoy/GlobalSearch";
import StudioClock from "./hoy/StudioClock";
import QuickActions from "./hoy/QuickActions";

function formatExpiry(value: string | null, locale: string) {
  if (!value) return "Sin vencimiento";
  return `Vence ${new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`))}`;
}

function formatTime(value: string, timeZone: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function localDateKey(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function parseDateKey(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function utcDateKey(value: Date) {
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function shiftUtcDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function weekStartMonday(value: Date) {
  const weekday = value.getUTCDay();
  return shiftUtcDays(value, weekday === 0 ? -6 : 1 - weekday);
}

function shortWeekday(value: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "short",
  })
    .format(value)
    .replace(".", "")
    .slice(0, 3);
}

function shortMonth(value: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    month: "short",
  })
    .format(value)
    .replace(".", "");
}

function selectedDayLabel(value: Date, isToday: boolean, locale: string) {
  if (isToday) return "Clases de hoy";
  return `Clases del ${new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(value)}`;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string; date?: string }>;
}) {
  const { supabase, studio, can } = await getAdminContext();
  if (!can(CAPABILITIES.ADMIN_PORTAL)) redirect("/admin/mis-clases");
  const params = await searchParams;
  const timeZone = studio.timezone;
  const locale = studio.locale;
  const now = new Date();
  const todayKey = localDateKey(now, timeZone);
  const selectedDate = parseDateKey(params.date) ?? parseDateKey(todayKey)!;
  const selectedKey = utcDateKey(selectedDate);
  const weekStart = weekStartMonday(selectedDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => shiftUtcDays(weekStart, index));
  const previousWeekKey = utcDateKey(shiftUtcDays(selectedDate, -7));
  const nextWeekKey = utcDateKey(shiftUtcDays(selectedDate, 7));
  const weekEnd = shiftUtcDays(weekStart, 6);

  const offsetName =
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
      hour: "2-digit",
    })
      .formatToParts(now)
      .find((item) => item.type === "timeZoneName")?.value ?? "GMT-06:00";
  const offset = offsetName.replace("GMT", "") || "+00:00";

  const todayStart = new Date(`${todayKey}T00:00:00${offset}`);
  const selectedStart = new Date(`${selectedKey}T00:00:00${offset}`);
  const selectedEnd = new Date(selectedStart.getTime() + 86400000);

  const canWriteSchedule =
    can(CAPABILITIES.SCHEDULE_WRITE) || can(CAPABILITIES.RESERVATIONS_MANAGE);
  const canWriteStudents = can(CAPABILITIES.STUDENTS_WRITE);
  const canReadSales = can(CAPABILITIES.SALES_READ) || can(CAPABILITIES.SALES_WRITE);
  const canWriteSales = can(CAPABILITIES.SALES_WRITE);
  const canWriteAttendance = can(CAPABILITIES.ATTENDANCE_WRITE);
  let cashDebts: Awaited<ReturnType<typeof loadDemiCashDebts>> = [];
  let cashDebtsUnavailable = false;
  if (canReadSales) {
    try {
      cashDebts = await loadDemiCashDebts(supabase, studio.id);
    } catch {
      cashDebtsUnavailable = true;
    }
  }
  const cashDebtByAcquisition = new Map(cashDebts.map((debt) => [debt.acquisitionId, debt]));
  const [
    { data: serverNow },
    { data: selectedSessions },
    { data: calendarData },
    { data: selectedPayments },
    { data: pendingTransferIntents },
    { data: expiringCount },
    { data: nearbyHolidays },
    { data: holidayOverrides },
    { data: operatingPolicy },
  ] = await Promise.all([
    supabase.rpc("current_server_time"),
    supabase
      .from("class_sessions")
      .select(
        "id,starts_at,ends_at,capacity,status,template_id,instructor_id,space_id,requires_resource,minimum_reservations_enabled,minimum_reservations,minimum_review_status,cancellation_reason,cancelled_at,cancelled_by,cancelled_by_label,cancellation_source",
      )
      .eq("studio_id", studio.id)
      .gte("starts_at", selectedStart.toISOString())
      .lt("starts_at", selectedEnd.toISOString())
      .order("starts_at", { ascending: true }),
    supabase.rpc("admin_today_calendar", { target_studio_id: studio.id, target_date: selectedKey }),
    supabase
      .from("payments")
      .select("amount_minor,kind")
      .eq("studio_id", studio.id)
      .eq("effective_on", selectedKey),
    canReadSales
      ? supabase
          .from("assistant_transfer_purchase_intents")
          .select(
            "id,student_id,product_template_id,amount_minor,currency,receipt_stored_at,updated_at",
          )
          .eq("studio_id", studio.id)
          .eq("status", "provisional_active")
          .order("receipt_stored_at", { ascending: true, nullsFirst: false })
      : Promise.resolve({
          data: [] as {
            id: string;
            student_id: string;
            product_template_id: string;
            amount_minor: number;
            currency: string;
            receipt_stored_at: string | null;
            updated_at: string;
          }[],
        }),
    supabase.rpc("admin_expiring_packages", { target_studio_id: studio.id, target_date: todayKey }),
    supabase
      .from("official_holidays")
      .select("id,name,holiday_date")
      .eq("country_code", "MX")
      .or(
        `holiday_date.eq.${selectedKey},and(holiday_date.gte.${todayKey},holiday_date.lte.${utcDateKey(shiftUtcDays(parseDateKey(todayKey)!, 21))})`,
      )
      .order("holiday_date"),
    supabase
      .from("studio_holiday_overrides")
      .select("holiday_date,operation_mode")
      .eq("studio_id", studio.id)
      .gte("holiday_date", selectedKey < todayKey ? selectedKey : todayKey)
      .lte(
        "holiday_date",
        selectedKey > utcDateKey(shiftUtcDays(parseDateKey(todayKey)!, 21))
          ? selectedKey
          : utcDateKey(shiftUtcDays(parseDateKey(todayKey)!, 21)),
      ),
    supabase
      .from("studio_operating_policies")
      .select(
        "no_show_consumes_credit,cancellation_cutoff_minutes,late_cancellation_consumes_credit",
      )
      .eq("studio_id", studio.id)
      .maybeSingle(),
  ]);

  const calendar = (calendarData ?? {}) as {
    min_date?: string;
    max_date?: string;
    week?: { date: string; id: string; busy: boolean }[];
  };
  const weekOffset = Math.round(
    (weekStart.getTime() - weekStartMonday(parseDateKey(todayKey)!).getTime()) / 604800000,
  );
  const weekLabel =
    weekOffset === 0
      ? "Semana actual"
      : weekOffset === -1
        ? "Semana pasada"
        : weekOffset === 1
          ? "Próxima semana"
          : weekOffset > 0
            ? `En ${weekOffset} semanas`
            : `Hace ${Math.abs(weekOffset)} semanas`;
  const canPreviousWeek = Boolean(calendar.min_date && previousWeekKey >= calendar.min_date);
  const canNextWeek = Boolean(calendar.max_date && nextWeekKey <= calendar.max_date);
  const pendingTransferStudentIds = [
    ...new Set((pendingTransferIntents ?? []).map((item) => item.student_id).filter(Boolean)),
  ] as string[];
  const pendingTransferProductIds = [
    ...new Set(
      (pendingTransferIntents ?? []).map((item) => item.product_template_id).filter(Boolean),
    ),
  ] as string[];

  const [{ data: pendingTransferStudents }, { data: pendingTransferProducts }] =
    pendingTransferStudentIds.length || pendingTransferProductIds.length
      ? await Promise.all([
          pendingTransferStudentIds.length
            ? supabase
                .from("students")
                .select("id,full_name")
                .eq("studio_id", studio.id)
                .in("id", pendingTransferStudentIds)
            : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
          pendingTransferProductIds.length
            ? supabase
                .from("product_templates")
                .select("id,name")
                .eq("studio_id", studio.id)
                .in("id", pendingTransferProductIds)
            : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        ])
      : [
          { data: [] as { id: string; full_name: string }[] },
          { data: [] as { id: string; name: string }[] },
        ];

  const pendingTransferStudentMap = new Map(
    (pendingTransferStudents ?? []).map((student) => [student.id, student.full_name]),
  );
  const pendingTransferProductMap = new Map(
    (pendingTransferProducts ?? []).map((product) => [product.id, product.name]),
  );
  const pendingTransferReviews = (pendingTransferIntents ?? []).map((intent) => ({
    id: intent.id,
    studentId: intent.student_id,
    studentName: pendingTransferStudentMap.get(intent.student_id) ?? "Alumna",
    packageName: pendingTransferProductMap.get(intent.product_template_id) ?? "Paquete",
    amount: new Intl.NumberFormat(locale, {
      style: "currency",
      currency: intent.currency || studio.currency,
      maximumFractionDigits: 0,
    }).format(Number(intent.amount_minor ?? 0) / 100),
    receivedAt: intent.receipt_stored_at ?? intent.updated_at,
  }));

  const sessionIds = (selectedSessions ?? []).map((session) => session.id);
  const templateIds = [...new Set((selectedSessions ?? []).map((session) => session.template_id))];
  const instructorIds = [
    ...new Set((selectedSessions ?? []).map((session) => session.instructor_id).filter(Boolean)),
  ] as string[];
  const spaceIds = [
    ...new Set((selectedSessions ?? []).map((session) => session.space_id).filter(Boolean)),
  ] as string[];

  const [{ data: reservations }, { data: templates }, { data: instructors }, { data: spaces }] =
    await Promise.all([
      sessionIds.length
        ? supabase
            .from("reservations")
            .select(
              "id,session_id,student_id,guest_person_id,status,acquisition_id,booked_at,commercial_status,class_kind,class_amount_minor",
            )
            .in("session_id", sessionIds)
            .in("status", ["reserved", "attended", "no_show"])
            .order("booked_at")
        : Promise.resolve({
            data: [] as {
              id: string;
              session_id: string;
              student_id: string | null;
              guest_person_id: string | null;
              status: string;
              acquisition_id: string | null;
              booked_at: string;
              commercial_status: string | null;
              class_kind: string | null;
              class_amount_minor: number | null;
            }[],
          }),
      templateIds.length
        ? supabase
            .from("class_templates")
            .select("id,name,color_hex,drop_in_price_minor")
            .in("id", templateIds)
        : Promise.resolve({
            data: [] as {
              id: string;
              name: string;
              color_hex: string | null;
              drop_in_price_minor: number | null;
            }[],
          }),
      instructorIds.length
        ? supabase.from("instructors").select("id,person_id").in("id", instructorIds)
        : Promise.resolve({ data: [] as { id: string; person_id: string }[] }),
      spaceIds.length
        ? supabase.from("spaces").select("id,name").in("id", spaceIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);

  const guestPersonIds = [
    ...new Set(
      (reservations ?? []).map((reservation) => reservation.guest_person_id).filter(Boolean),
    ),
  ] as string[];
  const personIds = [
    ...new Set([
      ...(instructors ?? []).map((instructor) => instructor.person_id),
      ...guestPersonIds,
    ]),
  ];

  const reservationStudentIds = [
    ...new Set((reservations ?? []).map((reservation) => reservation.student_id).filter(Boolean)),
  ] as string[];
  const reservationIds = (reservations ?? []).map((reservation) => reservation.id);
  const acquisitionIds = [
    ...new Set(
      (reservations ?? []).map((reservation) => reservation.acquisition_id).filter(Boolean),
    ),
  ] as string[];

  const [
    { data: persons },
    { data: reservationStudents },
    { data: attendanceCheckins },
    { data: evaluationInvitations },
    { data: resourceAssignments },
    { data: acquisitions },
  ] = await Promise.all([
    personIds.length
      ? supabase
          .from("persons")
          .select("id,first_name,last_name")
          .eq("studio_id", studio.id)
          .in("id", personIds)
      : Promise.resolve({
          data: [] as { id: string; first_name: string | null; last_name: string | null }[],
        }),
    reservationStudentIds.length
      ? supabase
          .from("students")
          .select("id,full_name")
          .eq("studio_id", studio.id)
          .in("id", reservationStudentIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    reservationIds.length
      ? supabase
          .from("attendance_checkins")
          .select("reservation_id,source,checked_in_at")
          .in("reservation_id", reservationIds)
      : Promise.resolve({
          data: [] as {
            reservation_id: string;
            source: string;
            checked_in_at: string;
          }[],
        }),
    reservationIds.length
      ? supabase
          .from("evaluation_invitations")
          .select("id,reservation_id,status")
          .in("reservation_id", reservationIds)
          .in("status", ["scheduled", "in_progress"])
      : Promise.resolve({
          data: [] as { id: string; reservation_id: string | null; status: string }[],
        }),
    reservationIds.length
      ? supabase
          .from("reservation_resource_assignments")
          .select("reservation_id,resource_id")
          .in("reservation_id", reservationIds)
          .is("released_at", null)
      : Promise.resolve({
          data: [] as { reservation_id: string; resource_id: string }[],
        }),
    acquisitionIds.length
      ? supabase
          .from("product_acquisitions")
          .select("id,product_template_id,expires_on,unlimited")
          .in("id", acquisitionIds)
      : Promise.resolve({
          data: [] as {
            id: string;
            product_template_id: string;
            expires_on: string | null;
            unlimited: boolean;
          }[],
        }),
  ]);

  const checkinByReservation = new Map(
    (attendanceCheckins ?? []).map((item) => [item.reservation_id, item]),
  );
  const evaluationByReservation = new Map(
    (evaluationInvitations ?? [])
      .filter((item) => item.reservation_id)
      .map((item) => [item.reservation_id!, item]),
  );

  const assignedResourceIds = [
    ...new Set((resourceAssignments ?? []).map((item) => item.resource_id).filter(Boolean)),
  ] as string[];
  const { data: assignedResources } = assignedResourceIds.length
    ? await supabase.from("resources").select("id,name,short_label").in("id", assignedResourceIds)
    : {
        data: [] as { id: string; name: string; short_label: string | null }[],
      };
  const resourceNameById = new Map(
    (assignedResources ?? []).map((resource) => [
      resource.id,
      resource.short_label?.trim() || resource.name,
    ]),
  );
  const resourceNameByReservation = new Map(
    (resourceAssignments ?? []).map((assignment) => [
      assignment.reservation_id,
      resourceNameById.get(assignment.resource_id) ?? null,
    ]),
  );

  const productIds = [...new Set((acquisitions ?? []).map((item) => item.product_template_id))];
  const meteredAcquisitionIds = (acquisitions ?? [])
    .filter((item) => !item.unlimited)
    .map((item) => item.id);
  const [{ data: products }, { data: balanceRows }] = await Promise.all([
    productIds.length
      ? supabase.from("product_templates").select("id,name").in("id", productIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    meteredAcquisitionIds.length
      ? supabase.rpc("acquisition_credit_balances", {
          target_acquisition_ids: meteredAcquisitionIds,
        })
      : Promise.resolve({
          data: [] as { acquisition_id: string; balance: number }[],
        }),
  ]);

  const balances = [
    ...(acquisitions ?? [])
      .filter((item) => item.unlimited)
      .map((item) => [item.id, null] as const),
    ...((balanceRows ?? []) as { acquisition_id: string; balance: number }[]).map(
      (item) => [item.acquisition_id, item.balance] as const,
    ),
  ];

  const templateMap = new Map((templates ?? []).map((item) => [item.id, item]));
  const personMap = new Map(
    (persons ?? []).map((person) => [
      person.id,
      [person.first_name, person.last_name].filter(Boolean).join(" ") || "Persona",
    ]),
  );
  const instructorMap = new Map(
    (instructors ?? []).map((instructor) => [
      instructor.id,
      personMap.get(instructor.person_id) ?? "Instructor",
    ]),
  );
  const spaceMap = new Map((spaces ?? []).map((space) => [space.id, space.name]));
  const studentMap = new Map(
    (reservationStudents ?? []).map((student) => [student.id, student.full_name] as const),
  );
  const acquisitionMap = new Map((acquisitions ?? []).map((item) => [item.id, item]));
  const productMap = new Map((products ?? []).map((item) => [item.id, item.name]));
  const balanceMap = new Map(balances);

  const reservationsBySession = new Map<string, typeof reservations>();
  for (const reservation of reservations ?? []) {
    const list = reservationsBySession.get(reservation.session_id) ?? [];
    list.push(reservation);
    reservationsBySession.set(reservation.session_id, list);
  }

  const classes: TodayClassItem[] = [];

  for (const session of selectedSessions ?? []) {
    const sessionReservations = reservationsBySession.get(session.id) ?? [];
    const template = templateMap.get(session.template_id);
    const reservationStatuses = sessionReservations.map((reservation) => reservation.status);
    const occupied = countSeatOccupyingReservations(reservationStatuses);
    const bookedReservations = countBookedReservations(reservationStatuses);

    classes.push({
      id: session.id,
      time: formatTime(session.starts_at, timeZone, locale),
      startsAt: session.starts_at,
      endsAt: session.ends_at,
      name: template?.name ?? "Clase",
      instructor: session.instructor_id
        ? (instructorMap.get(session.instructor_id) ?? "Instructor")
        : "Sin instructor",
      space: session.space_id ? (spaceMap.get(session.space_id) ?? "Espacio") : "Sin espacio",
      occupied,
      bookedReservations,
      capacity: session.capacity,
      color: template?.color_hex ?? "#0B7A55",
      sessionStatus: session.status,
      cancellationReason: session.cancellation_reason,
      cancelledAt: session.cancelled_at,
      cancellationSource: session.cancellation_source,
      cancelledByLabel:
        session.cancelled_by_label ?? (session.cancelled_by ? "Equipo del estudio" : "Automático"),
      available: Math.max(session.capacity - occupied, 0),
      evaluationCount: sessionReservations.filter((reservation) =>
        evaluationByReservation.has(reservation.id),
      ).length,
      returnTo: `/admin?date=${selectedKey}#session-${session.id}`,
      minimumReservationsEnabled: session.minimum_reservations_enabled ?? false,
      minimumReservations: session.minimum_reservations ?? 2,
      minimumReviewStatus: session.minimum_review_status ?? "not_required",
      roster: sessionReservations.map((reservation) => {
        const isGuest = Boolean(reservation.guest_person_id);
        const acquisition = reservation.acquisition_id
          ? acquisitionMap.get(reservation.acquisition_id)
          : null;
        const balance = reservation.acquisition_id
          ? balanceMap.get(reservation.acquisition_id)
          : null;

        const evaluationInvitation = evaluationByReservation.get(reservation.id);
        const attendanceCheckin = checkinByReservation.get(reservation.id);

        return {
          id: reservation.id,
          studentName: isGuest
            ? (personMap.get(reservation.guest_person_id!) ?? "Invitado")
            : reservation.student_id
              ? (studentMap.get(reservation.student_id) ?? "Alumna")
              : "Alumna",
          status: reservation.status,
          packageLabel:
            reservation.class_kind === "trial"
              ? "Clase de prueba"
              : reservation.class_kind === "drop_in"
                ? "Clase suelta"
                : isGuest
                  ? "Invitación"
                  : acquisition
                    ? (productMap.get(acquisition.product_template_id) ?? "Producto activo")
                    : "Sin producto vinculado",
          creditsLabel: isGuest
            ? "Beneficio por nivel"
            : acquisition?.unlimited
              ? "Ilimitado"
              : acquisition
                ? `${balance ?? 0} créditos`
                : "—",
          expiresLabel: isGuest
            ? "Misma clase"
            : formatExpiry(acquisition?.expires_on ?? null, locale),
          studentId: reservation.student_id,
          evaluationInvitationId: evaluationInvitation?.id ?? null,
          evaluationStatus: evaluationInvitation?.status ?? null,
          attendanceSource: attendanceCheckin?.source ?? null,
          checkedInAt: attendanceCheckin?.checked_in_at ?? null,
          attendanceProvenance:
            session.status === "completed" &&
            new Date(reservation.booked_at).getTime() >= new Date(session.ends_at).getTime()
              ? "Agregada manualmente después del cierre"
              : null,
          paymentDueOnAttendance: reservation.commercial_status === "payment_pending",
          pendingPackageSaleId: acquisition
            ? cashDebtByAcquisition.get(acquisition.id)?.saleId
            : undefined,
          pendingPackageAmountMinor: acquisition
            ? cashDebtByAcquisition.get(acquisition.id)?.amountMinor
            : undefined,
          individualPriceMinor:
            reservation.class_amount_minor ?? template?.drop_in_price_minor ?? null,
          currency: studio.currency ?? "MXN",
          resourceRequired: session.requires_resource,
          resourceName: session.requires_resource
            ? (resourceNameByReservation.get(reservation.id) ?? null)
            : null,
        };
      }),
    });
  }

  const activeClasses = classes.filter((item) => item.sessionStatus !== "cancelled");
  const totalAttended = activeClasses.reduce(
    (sum, item) => sum + item.roster.filter((person) => person.status === "attended").length,
    0,
  );
  const totalDailyCapacity = activeClasses.reduce((sum, item) => sum + item.capacity, 0);
  const totalDailyReservations = activeClasses.reduce(
    (sum, item) => sum + item.bookedReservations,
    0,
  );
  const dailyReservationPercentage =
    totalDailyCapacity > 0 ? Math.round((totalDailyReservations / totalDailyCapacity) * 100) : 0;

  const salesTotalMinor = (selectedPayments ?? []).reduce(
    (sum, payment) =>
      sum +
      (payment.kind === "refund" ? -(payment.amount_minor ?? 0) : (payment.amount_minor ?? 0)),
    0,
  );
  const salesTotal = new Intl.NumberFormat(studio.locale, {
    style: "currency",
    currency: studio.currency,
    maximumFractionDigits: 0,
  }).format(salesTotalMinor / 100);

  const effectiveNow = new Date(String(serverNow ?? now.toISOString())).getTime();
  const nextClass =
    selectedKey === todayKey
      ? activeClasses.find(
          (item) =>
            item.sessionStatus === "scheduled" && new Date(item.endsAt).getTime() > effectiveNow,
        )
      : null;
  const pendingAttendance = activeClasses.filter(
    (item) =>
      item.sessionStatus === "scheduled" &&
      new Date(item.endsAt).getTime() <= effectiveNow &&
      item.roster.some((person) => person.status === "reserved"),
  );
  const pendingPayments = activeClasses.filter((item) =>
    item.roster.some((person) => person.paymentDueOnAttendance),
  );
  const noShows = activeClasses.filter((item) =>
    item.roster.some((person) => person.status === "no_show"),
  );
  const nextMinutes = nextClass
    ? Math.max(0, Math.ceil((new Date(nextClass.startsAt).getTime() - effectiveNow) / 60000))
    : 0;
  const nextRelative =
    nextMinutes < 60
      ? `en ${nextMinutes} min`
      : `en ${Math.floor(nextMinutes / 60)} h${nextMinutes % 60 ? ` ${nextMinutes % 60} min` : ""}`;

  return (
    <main className="dashboard-shell hoy-dashboard hoy-approved hoy-v2">
      <header className="hoy-product-header">
        <div className="hoy-product-wordmark" aria-label="Studio Flow">
          <span>
            STUDIO <b>FLOW</b>
          </span>
          <small>{studio.name}</small>
        </div>
        <div className="flex items-center gap-2">
          {canWriteAttendance ? (
            <Link href="/admin/kiosco" className="hoy-header-action">
              Check-in
            </Link>
          ) : null}
          {canWriteStudents || canWriteSales ? (
            <QuickActions canStudents={canWriteStudents} canSales={canWriteSales} locale={locale} />
          ) : null}
        </div>
      </header>

      <header className="hoy-title-block">
        <div>
          <h1>{selectedDayLabel(selectedDate, selectedKey === todayKey, locale)}</h1>
          {selectedKey === todayKey ? (
            <p>
              {new Intl.DateTimeFormat(locale, {
                timeZone: "UTC",
                weekday: "long",
                day: "numeric",
                month: "long",
              }).format(selectedDate)}
            </p>
          ) : null}
        </div>
        <div className="hoy-title-tools">
          <StudioClock
            serverNow={String(serverNow ?? now.toISOString())}
            timeZone={timeZone}
            locale={locale}
          />
          <GlobalSearch />
        </div>
      </header>

      {params.error ? (
        <div className="notice error">
          No se pudo completar la operación: {decodeURIComponent(params.error)}
        </div>
      ) : null}

      <section className="hoy-week-card" aria-label="Calendario semanal">
        <div className="hoy-week-heading">
          {canPreviousWeek ? (
            <Link href={`/admin?date=${previousWeekKey}`} aria-label="Semana anterior">
              ‹
            </Link>
          ) : (
            <button disabled aria-label="Semana anterior">
              ‹
            </button>
          )}
          <strong>
            {weekStart.getUTCDate()} {shortMonth(weekStart, locale)} — {weekEnd.getUTCDate()}{" "}
            {shortMonth(weekEnd, locale)}
            <small>{weekLabel}</small>
          </strong>
          {canNextWeek ? (
            <Link href={`/admin?date=${nextWeekKey}`} aria-label="Semana siguiente">
              ›
            </Link>
          ) : (
            <button disabled aria-label="Semana siguiente">
              ›
            </button>
          )}
        </div>

        <div className="flow-date-tools">
          {selectedKey !== todayKey ? <Link href="/admin">Volver a hoy</Link> : null}
          <form action="/admin" method="get">
            <label htmlFor="today-date">Ir a fecha</label>
            <input
              id="today-date"
              name="date"
              type="date"
              defaultValue={selectedKey}
              min={calendar.min_date}
              max={calendar.max_date}
            />
            <button>Ir</button>
          </form>
        </div>
        <nav className="mock-week-calendar">
          {weekDays.map((day) => {
            const key = utcDateKey(day);
            const isSelected = key === selectedKey;
            const isToday = key === todayKey;
            const daySessions = (calendar.week ?? []).filter((item) => item.date === key);
            return (
              <Link
                key={key}
                href={`/admin?date=${key}`}
                className={`mock-week-day${isSelected ? " is-selected" : ""}${isToday ? " is-today" : ""}`}
                aria-current={isSelected ? "date" : undefined}
                aria-label={`${new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(day)}, ${daySessions.length} clases`}
              >
                <span>{shortWeekday(day, locale)}</span>
                <strong>{day.getUTCDate()}</strong>
                <span className="flow-day-dots" aria-hidden="true">
                  {daySessions.slice(0, 5).map((item) => (
                    <i key={item.id} className={item.busy ? "is-full" : undefined} />
                  ))}
                </span>
              </Link>
            );
          })}
        </nav>
      </section>

      {nextClass ? (
        <section className="flow-next">
          <small>{nextMinutes === 0 ? "En curso" : `Próxima clase · ${nextRelative}`}</small>
          <h2>
            {nextClass.time} · {nextClass.name}
          </h2>
          <p>
            {nextClass.bookedReservations} de {nextClass.capacity} reservadas ·{" "}
            {nextClass.instructor}
            {nextClass.roster.filter((person) => person.paymentDueOnAttendance).length
              ? ` · ${nextClass.roster.filter((person) => person.paymentDueOnAttendance).length} con pago pendiente`
              : ""}
          </p>
          <a href={`#session-${nextClass.id}`}>Ver lista</a>
          {canWriteSchedule && nextClass.available > 0 ? (
            <Link href={`/admin?date=${selectedKey}&add=${nextClass.id}#session-${nextClass.id}`}>
              Agregar alumna
            </Link>
          ) : null}
        </section>
      ) : null}
      {selectedKey === todayKey &&
      (pendingAttendance.length ||
        pendingPayments.length ||
        pendingTransferReviews.length ||
        noShows.length ||
        Number(expiringCount) > 0) ? (
        <section className="flow-todo" aria-label="Para hoy">
          <h2>Para hoy</h2>
          {pendingAttendance.length ? (
            <a href={`#session-${pendingAttendance[0].id}`}>
              {pendingAttendance.reduce(
                (sum, item) =>
                  sum + item.roster.filter((person) => person.status === "reserved").length,
                0,
              )}{" "}
              Sin pasar lista
            </a>
          ) : null}
          {pendingPayments.length ? (
            <a className="is-red" href={`#session-${pendingPayments[0].id}`}>
              {pendingPayments.reduce(
                (sum, item) =>
                  sum + item.roster.filter((person) => person.paymentDueOnAttendance).length,
                0,
              )}{" "}
              Cobros pendientes
            </a>
          ) : null}
          {pendingTransferReviews.length ? (
            <Link
              className="is-blue"
              href={`/admin/alumnas/${pendingTransferReviews[0].studentId}?view=packages#transferencias`}
            >
              {pendingTransferReviews.length} Transferencia por validar
            </Link>
          ) : null}
          {noShows.length ? (
            <a className="is-violet" href={`#session-${noShows[0].id}`}>
              {noShows.reduce(
                (sum, item) =>
                  sum + item.roster.filter((person) => person.status === "no_show").length,
                0,
              )}{" "}
              No show por contactar
            </a>
          ) : null}
          {Number(expiringCount) > 0 ? (
            <Link href="/admin/alumnas?status=expiring">{Number(expiringCount)} Por vencer</Link>
          ) : null}
        </section>
      ) : null}
      {cashDebtsUnavailable ? (
        <p role="alert">
          No se pudieron consultar los pagos en efectivo pendientes. Revisa el perfil de la alumna
          antes de cobrar.
        </p>
      ) : null}
      {cashDebts.length > 0 ? (
        <section className="hoy-priority" aria-label="Efectivo pendiente de cobro">
          <div className="hoy-priority-heading">
            <div>
              <span>Pendiente de cobro</span>
              <strong>Efectivo por cobrar</strong>
            </div>
            <span className="hoy-priority-count">{cashDebts.length}</span>
          </div>
          <div className="hoy-priority-list">
            {cashDebts.map((debt) => (
              <Link
                key={debt.saleId}
                href={`/admin/ventas/${debt.saleId}`}
                className="hoy-priority-item"
              >
                <span className="hoy-priority-icon" aria-hidden="true">
                  $
                </span>
                <span className="hoy-priority-copy">
                  <strong>{debt.studentName}</strong>
                  <small>
                    {new Intl.NumberFormat(locale, {
                      style: "currency",
                      currency: debt.currency,
                    }).format(debt.amountMinor / 100)}{" "}
                    pendientes
                  </small>
                  <em>{debt.dueOn ? `Fecha de pago: ${debt.dueOn}` : "Sin fecha de pago"}</em>
                </span>
                <b aria-hidden="true">›</b>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {(nearbyHolidays ?? [])
        .filter((holiday) => holiday.holiday_date === selectedKey)
        .map((holiday) => {
          const override = (holidayOverrides ?? []).find(
            (item) => item.holiday_date === holiday.holiday_date,
          );
          return (
            <section key={holiday.id} className="flow-card flow-holiday">
              <h2>{holiday.name}</h2>
              <p>
                {override?.operation_mode === "closed"
                  ? "Estudio cerrado"
                  : override?.operation_mode === "special"
                    ? "Horario especial"
                    : override
                      ? "El estudio abre"
                      : "Por decidir"}
              </p>
              {can(CAPABILITIES.SETTINGS_WRITE) ? (
                <Link
                  className="flow-back"
                  href={`/admin/configuracion/festivos?year=${holiday.holiday_date.slice(0, 4)}`}
                >
                  {override ? "Cambiar" : "Decidir"}
                </Link>
              ) : null}
            </section>
          );
        })}
      {selectedKey === todayKey &&
      (nearbyHolidays ?? []).some((holiday) => holiday.holiday_date > todayKey) ? (
        <section className="flow-card flow-holiday">
          <h2>Próximas fechas especiales</h2>
          {(nearbyHolidays ?? [])
            .filter((holiday) => holiday.holiday_date > todayKey)
            .slice(0, 3)
            .map((holiday) => (
              <Link key={holiday.id} href={`/admin?date=${holiday.holiday_date}`}>
                {holiday.name} ·{" "}
                {new Intl.DateTimeFormat(locale, {
                  timeZone: "UTC",
                  day: "numeric",
                  month: "long",
                }).format(new Date(`${holiday.holiday_date}T12:00Z`))}
              </Link>
            ))}
        </section>
      ) : null}
      {calendar.max_date &&
      (selectedKey > calendar.max_date ||
        (calendar.min_date && selectedKey < calendar.min_date)) ? (
        <p className="flow-operation-note" role="status">
          Solo hay clases generadas hasta el{" "}
          {new Intl.DateTimeFormat(locale, {
            timeZone: "UTC",
            day: "numeric",
            month: "long",
          }).format(new Date(`${calendar.max_date}T12:00Z`))}
        </p>
      ) : null}
      <section className="hoy-glance" aria-label="Resumen rápido">
        <div>
          <strong>{totalAttended}</strong>
          <span>Asistieron</span>
        </div>
        <div>
          <strong>{activeClasses.length}</strong>
          <span>
            Clases
            {classes.length > activeClasses.length
              ? ` · ${classes.length - activeClasses.length} cancelada(s)`
              : ""}
          </span>
        </div>
        <div>
          <strong>{canReadSales ? salesTotal : "—"}</strong>
          <span>Ventas{selectedKey === todayKey ? " hoy" : ""}</span>
        </div>
        <div>
          <strong>{dailyReservationPercentage}%</strong>
          <span>
            Ocupación · {totalDailyReservations}/{totalDailyCapacity}
          </span>
        </div>
      </section>

      <TodayClasses
        classes={classes}
        returnDate={selectedKey}
        serverNow={String(serverNow ?? now.toISOString())}
        canAttendance={canWriteAttendance}
        operatingPolicy={{
          noShowConsumesCredit: operatingPolicy?.no_show_consumes_credit ?? true,
          cancellationCutoffMinutes: operatingPolicy?.cancellation_cutoff_minutes ?? 300,
          lateCancellationConsumesCredit:
            operatingPolicy?.late_cancellation_consumes_credit ?? true,
        }}
        canCollectPayment={canWriteSales}
        canBook={canWriteSchedule}
        canCreateStudent={canWriteStudents}
        locale={locale}
        timeZone={timeZone}
        canCorrectCompleted
      />
    </main>
  );
}
