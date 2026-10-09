import Link from "next/link";
import { readIntelligenceRows, readIntelligenceSessions } from "@/lib/intelligence-query";
import { TrendChart, SortableTable } from "@/components/intelligence/charts";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

type ViewKey = "resumen" | "dinero" | "alumnas" | "conversion" | "clases" | "asistencia";

type Tone = "neutral" | "positive" | "warning" | "danger" | "info";

type StudentRow = {
  id: string;
  full_name: string;
  active: boolean;
  lifecycle_status: string;
  student_type: string | null;
  trial_status: string | null;
  created_at: string;
};

type AcquisitionRow = {
  id: string;
  student_id: string;
  product_template_id: string;
  status: string;
  starts_on: string | null;
  expires_on: string | null;
  created_at: string;
  refunded_at: string | null;
};

type SaleRow = {
  id: string;
  student_id: string;
  folio: string;
  status: string;
  total_minor: number;
  currency: string;
  created_at: string;
};

type PaymentRow = {
  sale_id: string;
  kind: string;
  method: string;
  amount_minor: number;
  created_at: string;
};

type SaleLineRow = {
  sale_id: string;
  product_template_id: string | null;
  product_name: string;
  line_total_minor: number;
  refunded_at: string | null;
  created_at: string;
};

type SessionRow = {
  id: string;
  template_id: string;
  starts_at: string;
  capacity: number;
  status: string;
};

type ReservationRow = {
  id: string;
  session_id: string;
  student_id: string | null;
  status: string;
  booked_at: string;
};

type ClassTemplateRow = {
  id: string;
  name: string;
  color_hex: string | null;
};

type ProductTemplateRow = {
  id: string;
  product_type: string;
  name: string;
};

type OnboardingRow = {
  student_id: string;
  documents_completed_at: string | null;
  profile_completed_at: string | null;
  first_reservation_at: string | null;
  first_attendance_at: string | null;
  app_installed_at: string | null;
  notifications_enabled_at: string | null;
  completed_at: string | null;
};

const views: { key: ViewKey; label: string }[] = [
  { key: "resumen", label: "Resumen" },
  { key: "asistencia", label: "Asistencia" },
  { key: "clases", label: "Clases" },
  { key: "dinero", label: "Pagos" },
  { key: "conversion", label: "Conversión" },
  { key: "alumnas", label: "Retención" },
];

const DAY = 86_400_000;
const userCancellationStatuses = new Set(["cancelled_on_time", "cancelled_late"]);
const occupiedStatuses = new Set(["reserved", "attended", "no_show"]);
const decisionReservationStatuses = new Set([
  "reserved",
  "attended",
  "no_show",
  "cancelled_on_time",
  "cancelled_late",
  "cancelled_by_studio",
]);
const commercialProductTypes = new Set(["package", "membership", "single_class"]);

function clampDays(value: string | undefined) {
  const parsed = Number(value ?? "30");
  if (parsed === 7 || parsed === 30 || parsed === 90) return parsed;
  return 30;
}

function validView(value: string | undefined): ViewKey {
  if (value === "pagos") return "dinero";
  if (value === "retencion") return "alumnas";
  return views.some((item) => item.key === value) ? (value as ViewKey) : "resumen";
}

function money(minor: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

function pct(value: number, locale: string) {
  return (
    new Intl.NumberFormat(locale, {
      maximumFractionDigits: 1,
    }).format(value) + "%"
  );
}

function safeRate(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function deltaText(current: number, previous: number, suffix = "%") {
  if (previous === 0) return current === 0 ? "Sin cambio" : "Nuevo en el periodo";
  const delta = ((current - previous) / Math.abs(previous)) * 100;
  const direction = delta >= 0 ? "↑" : "↓";
  return direction + " " + Math.abs(delta).toFixed(0) + suffix + " vs periodo anterior";
}

function pointsDelta(current: number, previous: number) {
  const delta = current - previous;
  if (Math.abs(delta) < 0.05) return "Sin cambio";
  return (delta >= 0 ? "↑ " : "↓ ") + Math.abs(delta).toFixed(1) + " pp";
}

function isoDateKey(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function daysSince(dateKey: string | null, now: Date) {
  if (!dateKey) return null;
  const value = new Date(dateKey + "T12:00:00Z");
  if (Number.isNaN(value.getTime())) return null;
  return Math.floor((now.getTime() - value.getTime()) / DAY);
}

function isBetween(value: string, start: Date, end: Date) {
  const time = new Date(value).getTime();
  return time >= start.getTime() && time < end.getTime();
}

function MetricCard({
  label,
  value,
  delta,
  href,
  tone = "neutral",
}: {
  label: string;
  value: string;
  delta: string;
  tone?: Tone;
  href?: string;
}) {
  return (
    <article className={"intel-metric is-" + tone}>
      <span>{label}</span>
      <strong>{value}</strong>
      {href ? <Link className="intel-metric-link" href={href} aria-label={"Ver " + label} /> : null}
      <small>{delta}</small>
    </article>
  );
}

function Insight({
  title,
  body,
  tone = "warning",
  href,
}: {
  title: string;
  body: string;
  tone?: Tone;
  href?: string;
}) {
  const content = (
    <>
      <span className="intel-insight-stripe" aria-hidden="true" />
      <span className="intel-insight-copy">
        <strong>{title}</strong>
        <small>{body}</small>
      </span>
      {href ? <span className="intel-chevron">›</span> : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={"intel-insight is-" + tone}>
        {content}
      </Link>
    );
  }

  return <div className={"intel-insight is-" + tone}>{content}</div>;
}

function Section({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={"intel-panel " + className}>
      <div className="intel-panel-heading">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function BarRow({
  label,
  value,
  max,
  display,
  tone = "accent",
}: {
  label: string;
  value: number;
  max: number;
  display: string;
  tone?: "accent" | "success" | "warning" | "danger" | "info";
}) {
  const width = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="intel-bar-row">
      <div className="intel-bar-label">
        <span>{label}</span>
        <strong>{display}</strong>
      </div>
      <div className="intel-bar-track">
        <span className={"intel-bar-fill is-" + tone} style={{ width: width + "%" }} />
      </div>
    </div>
  );
}

function viewHref(view: ViewKey, days: number) {
  return "/admin/inteligencia?view=" + view + "&days=" + days;
}

function periodHref(view: ViewKey, days: number) {
  return "/admin/inteligencia?view=" + view + "&days=" + days;
}

function titleFor(view: ViewKey) {
  const map: Record<ViewKey, [string, string]> = {
    resumen: ["Resumen del estudio", "Lo importante del estudio y lo que necesita tu atención."],
    dinero: ["Pagos", "Cobros, ventas y saldos pendientes del periodo."],
    alumnas: ["Retención", "Actividad, renovación y alumnas que requieren seguimiento."],
    conversion: ["Conversión", "Del primer contacto y la clase de prueba hasta la compra."],
    asistencia: ["Asistencia", "Quién viene, a qué clase y en qué horario."],
    clases: ["Clases", "Ocupación, asistencia, cancelaciones y demanda por horario."],
  };
  return map[view];
}

export default async function IntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; days?: string; discipline?: string }>;
}) {
  const [params, { supabase, studio }] = await Promise.all([
    searchParams,
    getAdminContext(CAPABILITIES.REPORTS_READ),
  ]);
  const view = validView(params.view);
  const days = clampDays(params.days);
  const locale = studio.locale;
  const timeZone = studio.timezone;
  const now = new Date();
  const currentEnd = now;
  const currentStart = new Date(now.getTime() - days * DAY);
  const previousStart = new Date(currentStart.getTime() - days * DAY);
  const rangeStartIso = previousStart.toISOString();
  const currentStartDate = isoDateKey(currentStart, timeZone);
  const previousStartDate = isoDateKey(previousStart, timeZone);
  const todayDate = isoDateKey(now, timeZone);

  const needsStudents = view !== "clases";
  const needsAcquisitions = view === "resumen" || view === "alumnas" || view === "dinero";
  const needsSales = view === "resumen" || view === "dinero";
  const needsPayments = view === "resumen" || view === "dinero";
  const needsSaleLines = view === "resumen" || view === "dinero";
  const needsSessions =
    view === "resumen" || view === "alumnas" || view === "clases" || view === "asistencia";
  const needsTemplates = true;
  const needsProductTemplates = needsAcquisitions;
  const needsOnboarding = view === "alumnas";

  const [
    studentsResult,
    acquisitionsResult,
    salesResult,
    paymentsResult,
    linesResult,
    sessionsResult,
    templatesResult,
    productTemplatesResult,
    onboardingResult,
    conversationsResult,
    methodsResult,
    policyResult,
  ] = await Promise.all([
    needsStudents
      ? readIntelligenceRows(
          supabase
            .from("students")
            .select("id,full_name,active,lifecycle_status,student_type,trial_status,created_at")
            .eq("studio_id", studio.id),
        )
      : Promise.resolve({ data: [] as StudentRow[] }),
    needsAcquisitions
      ? readIntelligenceRows(
          supabase
            .from("product_acquisitions")
            .select(
              "id,student_id,product_template_id,status,starts_on,expires_on,created_at,refunded_at",
            )
            .eq("studio_id", studio.id)
            .is("refunded_at", null)
            .neq("status", "cancelled")
            .order("created_at", { ascending: true }),
        )
      : Promise.resolve({ data: [] as AcquisitionRow[] }),
    needsSales
      ? readIntelligenceRows(
          supabase
            .from("sales")
            .select("id,student_id,folio,status,total_minor,currency,created_at")
            .eq("studio_id", studio.id)
            .order("created_at", { ascending: false }),
        )
      : Promise.resolve({ data: [] as SaleRow[] }),
    needsPayments
      ? readIntelligenceRows(
          supabase
            .from("payments")
            .select("sale_id,kind,method,amount_minor,created_at")
            .eq("studio_id", studio.id),
        )
      : Promise.resolve({ data: [] as PaymentRow[] }),
    needsSaleLines
      ? readIntelligenceRows(
          supabase
            .from("sale_lines")
            .select(
              "sale_id,product_template_id,product_name,line_total_minor,refunded_at,created_at",
            )
            .eq("studio_id", studio.id)
            .is("refunded_at", null),
        )
      : Promise.resolve({ data: [] as SaleLineRow[] }),
    needsSessions
      ? readIntelligenceRows(
          supabase
            .from("class_sessions")
            .select("id,template_id,starts_at,capacity,status")
            .eq("studio_id", studio.id)
            .neq("status", "cancelled")
            .gte("starts_at", rangeStartIso)
            .lt("starts_at", currentEnd.toISOString())
            .order("starts_at"),
        )
      : Promise.resolve({ data: [] as SessionRow[] }),
    needsTemplates
      ? readIntelligenceRows(
          supabase.from("class_templates").select("id,name,color_hex").eq("studio_id", studio.id),
        )
      : Promise.resolve({ data: [] as ClassTemplateRow[] }),
    needsProductTemplates
      ? readIntelligenceRows(
          supabase
            .from("product_templates")
            .select("id,product_type,name")
            .eq("studio_id", studio.id)
            .in("product_type", [...commercialProductTypes]),
        )
      : Promise.resolve({ data: [] as ProductTemplateRow[] }),
    needsOnboarding
      ? readIntelligenceRows(
          supabase
            .from("reward_onboarding")
            .select(
              "student_id,documents_completed_at,profile_completed_at,first_reservation_at,first_attendance_at,app_installed_at,notifications_enabled_at,completed_at",
            )
            .eq("studio_id", studio.id),
        )
      : Promise.resolve({ data: [] as OnboardingRow[] }),
    view === "conversion"
      ? readIntelligenceRows(
          supabase
            .from("crm_conversations")
            .select("id,student_id,provider_contact_id,contact_phone,source,started_at")
            .eq("studio_id", studio.id)
            .gte("started_at", rangeStartIso)
            .lt("started_at", currentEnd.toISOString()),
        )
      : Promise.resolve({ data: [] }),
    needsPayments
      ? readIntelligenceRows(
          supabase.from("studio_payment_methods").select("code,name").eq("studio_id", studio.id),
        )
      : Promise.resolve({ data: [] }),
    readIntelligenceRows(
      supabase
        .from("studio_operating_policies")
        .select("cancellation_cutoff_minutes")
        .eq("studio_id", studio.id),
    ),
  ]);

  const cancellationCutoff = (
    policyResult.data?.[0] as { cancellation_cutoff_minutes: number } | undefined
  )?.cancellation_cutoff_minutes;
  const students = (studentsResult.data ?? []) as StudentRow[];
  const acquisitions = (acquisitionsResult.data ?? []) as AcquisitionRow[];
  const sales = (salesResult.data ?? []) as SaleRow[];
  const payments = (paymentsResult.data ?? []) as PaymentRow[];
  const saleLines = (linesResult.data ?? []) as SaleLineRow[];
  const allSessions = (sessionsResult.data ?? []) as SessionRow[];
  const discipline = ((templatesResult.data ?? []) as ClassTemplateRow[]).some(
    (t) => t.id === params.discipline,
  )
    ? params.discipline!
    : "";
  const sessions = allSessions.filter(
    (item) => view === "alumnas" || !discipline || item.template_id === discipline,
  );
  const templates = (templatesResult.data ?? []) as ClassTemplateRow[];
  const productTemplates = (productTemplatesResult.data ?? []) as ProductTemplateRow[];
  const onboarding = (onboardingResult.data ?? []) as OnboardingRow[];

  const sessionIds = sessions.map((session) => session.id);
  const [reservationsResult, waitlistResult] = await Promise.all([
    sessionIds.length
      ? readIntelligenceSessions(sessionIds, (ids) =>
          supabase
            .from("reservations")
            .select("id,session_id,student_id,status,booked_at")
            .eq("studio_id", studio.id)
            .in("session_id", ids),
        )
      : Promise.resolve({ data: [] as ReservationRow[] }),
    sessionIds.length
      ? readIntelligenceSessions(sessionIds, (ids) =>
          supabase
            .from("class_waitlist_entries")
            .select("id,session_id,status")
            .eq("studio_id", studio.id)
            .in("session_id", ids),
        )
      : Promise.resolve({ data: [] }),
  ]);

  const failedSources = [
    studentsResult,
    acquisitionsResult,
    salesResult,
    paymentsResult,
    linesResult,
    sessionsResult,
    templatesResult,
    productTemplatesResult,
    onboardingResult,
    reservationsResult,
    waitlistResult,
    conversationsResult,
  ].some((result) => "error" in result && result.error);
  if (failedSources)
    return (
      <main className="intel-page">
        <h1>Inteligencia</h1>
        <p role="alert">
          No pudimos consultar todos los datos del estudio. Intenta de nuevo para ver métricas
          completas.
        </p>
        <Link href="/admin/inteligencia">Volver a intentar</Link>
      </main>
    );
  const reservations = (reservationsResult.data ?? []) as ReservationRow[];
  const templateMap = new Map(templates.map((item) => [item.id, item]));
  const productTemplateMap = new Map(productTemplates.map((item) => [item.id, item]));
  const commercialAcquisitions = acquisitions.filter((item) => {
    const productType = productTemplateMap.get(item.product_template_id)?.product_type;
    return Boolean(productType && commercialProductTypes.has(productType));
  });

  const currentStudents = students.filter((item) =>
    isBetween(item.created_at, currentStart, currentEnd),
  );
  const previousStudents = students.filter((item) =>
    isBetween(item.created_at, previousStart, currentStart),
  );

  const currentSales = sales.filter(
    (item) => item.status === "confirmed" && isBetween(item.created_at, currentStart, currentEnd),
  );
  const previousSales = sales.filter(
    (item) =>
      item.status === "confirmed" && isBetween(item.created_at, previousStart, currentStart),
  );

  const currentPayments = payments.filter((item) =>
    isBetween(item.created_at, currentStart, currentEnd),
  );
  const previousPayments = payments.filter((item) =>
    isBetween(item.created_at, previousStart, currentStart),
  );

  function netPayments(rows: PaymentRow[]) {
    return rows.reduce(
      (sum, item) => sum + (item.kind === "refund" ? -item.amount_minor : item.amount_minor),
      0,
    );
  }

  const currentRevenue = netPayments(currentPayments);
  const previousRevenue = netPayments(previousPayments);
  const currentRefunds = currentPayments
    .filter((item) => item.kind === "refund")
    .reduce((sum, item) => sum + item.amount_minor, 0);
  const previousRefunds = previousPayments
    .filter((item) => item.kind === "refund")
    .reduce((sum, item) => sum + item.amount_minor, 0);
  const ticketAverage =
    currentSales.length > 0
      ? currentSales.reduce((sum, item) => sum + item.total_minor, 0) / currentSales.length
      : 0;
  const previousTicketAverage =
    previousSales.length > 0
      ? previousSales.reduce((sum, item) => sum + item.total_minor, 0) / previousSales.length
      : 0;

  const paymentBySale = new Map<string, number>();
  for (const payment of payments) {
    paymentBySale.set(
      payment.sale_id,
      (paymentBySale.get(payment.sale_id) ?? 0) +
        (payment.kind === "refund" ? -payment.amount_minor : payment.amount_minor),
    );
  }

  const collectibleBySale = new Map<string, number>();
  for (const line of saleLines) {
    if (line.refunded_at) continue;
    collectibleBySale.set(
      line.sale_id,
      (collectibleBySale.get(line.sale_id) ?? 0) + line.line_total_minor,
    );
  }

  const pendingSales = sales.filter(
    (sale) => sale.status === "confirmed" && new Date(sale.created_at) < currentEnd,
  );
  const pendingCurrent = pendingSales.reduce((sum, sale) => {
    const collectible = collectibleBySale.get(sale.id) ?? sale.total_minor;
    const paid = paymentBySale.get(sale.id) ?? 0;
    return sum + Math.max(collectible - paid, 0);
  }, 0);

  function activeCommercialStudentCount(atDate: string) {
    const studentIds = new Set<string>();
    for (const item of commercialAcquisitions) {
      if (item.refunded_at || item.status === "cancelled") continue;
      const start = item.starts_on ?? item.created_at.slice(0, 10);
      const end = item.expires_on;
      if (start > atDate || item.created_at.slice(0, 10) > atDate) continue;
      if (end && end < atDate) continue;
      studentIds.add(item.student_id);
    }
    return studentIds.size;
  }

  const activeStudents = activeCommercialStudentCount(todayDate);
  const previousActiveStudents = activeCommercialStudentCount(currentStartDate);

  const acquisitionsByStudent = new Map<string, AcquisitionRow[]>();
  for (const item of commercialAcquisitions) {
    if (item.refunded_at || item.status === "cancelled") continue;
    const list = acquisitionsByStudent.get(item.student_id) ?? [];
    list.push(item);
    acquisitionsByStudent.set(item.student_id, list);
  }

  const latestAcquisitionByStudent = new Map<string, AcquisitionRow>();
  for (const [studentId, list] of acquisitionsByStudent.entries()) {
    const sorted = [...list].sort((a, b) => {
      const aExpiry = a.expires_on ?? "9999-12-31";
      const bExpiry = b.expires_on ?? "9999-12-31";
      if (aExpiry !== bExpiry) return bExpiry.localeCompare(aExpiry);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    if (sorted[0]) latestAcquisitionByStudent.set(studentId, sorted[0]);
  }

  const riskStudents: { id: string; name: string; days: number; state: string }[] = [];
  const inactiveStudents: { id: string; name: string; days: number; state: string }[] = [];
  const abandonedStudents: { id: string; name: string; days: number; state: string }[] = [];

  for (const student of students) {
    const latest = latestAcquisitionByStudent.get(student.id);
    const elapsed = daysSince(latest?.expires_on ?? null, now);
    if (elapsed === null || elapsed < 7) continue;
    if (elapsed >= 30) {
      abandonedStudents.push({
        id: student.id,
        name: student.full_name,
        days: elapsed,
        state: "Abandono",
      });
    } else if (elapsed >= 15) {
      inactiveStudents.push({
        id: student.id,
        name: student.full_name,
        days: elapsed,
        state: "Inactiva",
      });
    } else {
      riskStudents.push({
        id: student.id,
        name: student.full_name,
        days: elapsed,
        state: "En riesgo",
      });
    }
  }

  const currentSessions = sessions.filter((item) =>
    isBetween(item.starts_at, currentStart, currentEnd),
  );
  const previousSessions = sessions.filter((item) =>
    isBetween(item.starts_at, previousStart, currentStart),
  );

  const reservationsBySession = new Map<string, ReservationRow[]>();
  for (const reservation of reservations) {
    const list = reservationsBySession.get(reservation.session_id) ?? [];
    list.push(reservation);
    reservationsBySession.set(reservation.session_id, list);
  }

  function classMetrics(rows: SessionRow[]) {
    let capacity = 0;
    let occupied = 0;
    let attended = 0;
    let noShow = 0;
    let cancelled = 0;
    let onTime = 0;
    let late = 0;
    let reservationEvents = 0;

    for (const session of rows) {
      if (session.status === "cancelled") continue;
      capacity += session.capacity ?? 0;
      const sessionReservations = reservationsBySession.get(session.id) ?? [];
      for (const reservation of sessionReservations) {
        if (!decisionReservationStatuses.has(reservation.status)) continue;
        reservationEvents += 1;
        if (occupiedStatuses.has(reservation.status)) occupied += 1;
        if (reservation.status === "attended") attended += 1;
        if (reservation.status === "no_show") noShow += 1;
        if (userCancellationStatuses.has(reservation.status)) cancelled += 1;
        if (reservation.status === "cancelled_on_time") onTime += 1;
        if (reservation.status === "cancelled_late") late += 1;
      }
    }

    return {
      occupancy: safeRate(attended, capacity),
      attendance: safeRate(attended, attended + noShow + late + (occupied - attended - noShow)),
      cancellation: safeRate(cancelled, reservationEvents),
      noShow: safeRate(noShow, occupied),
      onTime,
      late,
      noShowCount: noShow,
      reservations: reservationEvents,
      cancelled,
      attended,
      occupied,
      capacity,
    };
  }

  const currentClassMetrics = classMetrics(currentSessions);
  const previousClassMetrics = classMetrics(previousSessions);

  const classAggregate = new Map<
    string,
    {
      name: string;
      capacity: number;
      occupied: number;
      attended: number;
      noShow: number;
      late: number;
      cancelled: number;
      total: number;
      color: string;
    }
  >();

  for (const session of currentSessions) {
    if (session.status === "cancelled") continue;
    const template = templateMap.get(session.template_id);
    const key = session.template_id;
    const current = classAggregate.get(key) ?? {
      name: template?.name ?? "Clase",
      capacity: 0,
      occupied: 0,
      attended: 0,
      noShow: 0,
      late: 0,
      cancelled: 0,
      total: 0,
      color: template?.color_hex ?? "#FF0A8A",
    };
    current.capacity += session.capacity ?? 0;
    for (const reservation of reservationsBySession.get(session.id) ?? []) {
      if (!decisionReservationStatuses.has(reservation.status)) continue;
      current.total += 1;
      if (occupiedStatuses.has(reservation.status)) current.occupied += 1;
      if (reservation.status === "attended") current.attended += 1;
      if (reservation.status === "no_show") current.noShow += 1;
      if (reservation.status === "cancelled_late") current.late += 1;
      if (userCancellationStatuses.has(reservation.status)) current.cancelled += 1;
    }
    classAggregate.set(key, current);
  }

  const classRows = [...classAggregate.values()]
    .map((item) => ({
      ...item,
      occupancy: safeRate(item.attended, item.capacity),
      attendance: safeRate(item.attended, item.occupied + item.late),
      cancellation: safeRate(item.cancelled, item.total),
    }))
    .sort((a, b) => b.occupancy - a.occupancy);

  const daypart = { Mañana: [0, 0], Tarde: [0, 0], Noche: [0, 0] } as Record<
    string,
    [number, number]
  >;
  const weekday = new Map<string, [number, number]>();

  for (const session of currentSessions) {
    if (session.status === "cancelled") continue;
    const date = new Date(session.starts_at);
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "2-digit",
        hourCycle: "h23",
      }).format(date),
    );
    const part = hour < 12 ? "Mañana" : hour < 17 ? "Tarde" : "Noche";
    const used = (reservationsBySession.get(session.id) ?? []).filter(
      (item) => item.status === "attended",
    ).length;
    daypart[part][0] += used;
    daypart[part][1] += session.capacity ?? 0;

    const day = new Intl.DateTimeFormat(locale, {
      timeZone,
      weekday: "long",
    }).format(date);
    const current = weekday.get(day) ?? [0, 0];
    current[0] += used;
    current[1] += session.capacity ?? 0;
    weekday.set(day, current);
  }

  const trialCurrent = currentStudents.filter((item) => item.trial_status);
  const trialPrevious = previousStudents.filter((item) => item.trial_status);
  const trialAttended = trialCurrent.filter(
    (item) => item.trial_status === "attended" || item.trial_status === "converted",
  ).length;
  const trialPreviousAttended = trialPrevious.filter(
    (item) => item.trial_status === "attended" || item.trial_status === "converted",
  ).length;
  const trialConverted = trialCurrent.filter((item) => item.trial_status === "converted").length;
  const trialPreviousConverted = trialPrevious.filter(
    (item) => item.trial_status === "converted",
  ).length;
  const trialNoShow = trialCurrent.filter((item) => item.trial_status === "no_show").length;
  const trialConversion = safeRate(trialConverted, trialAttended);
  const previousTrialConversion = safeRate(trialPreviousConverted, trialPreviousAttended);

  const expiredCurrent = commercialAcquisitions.filter(
    (item) =>
      !item.refunded_at &&
      item.status !== "cancelled" &&
      Boolean(
        item.expires_on && item.expires_on >= currentStartDate && item.expires_on < todayDate,
      ),
  );
  const expiredPrevious = commercialAcquisitions.filter(
    (item) =>
      !item.refunded_at &&
      item.status !== "cancelled" &&
      Boolean(
        item.expires_on &&
        item.expires_on >= previousStartDate &&
        item.expires_on < currentStartDate,
      ),
  );

  function renewalStats(expiredRows: AcquisitionRow[], cutoff = currentEnd) {
    const expiryByStudent = new Map<string, AcquisitionRow>();
    for (const row of expiredRows) {
      const previous = expiryByStudent.get(row.student_id);
      if (
        !previous ||
        (row.expires_on ?? "") > (previous.expires_on ?? "") ||
        ((row.expires_on ?? "") === (previous.expires_on ?? "") &&
          new Date(row.created_at).getTime() > new Date(previous.created_at).getTime())
      ) {
        expiryByStudent.set(row.student_id, row);
      }
    }

    let renewed = 0;
    for (const expired of expiryByStudent.values()) {
      const later = (acquisitionsByStudent.get(expired.student_id) ?? []).some((candidate) => {
        if (candidate.id === expired.id) return false;
        if (
          new Date(candidate.created_at).getTime() >= cutoff.getTime() ||
          new Date(candidate.created_at).getTime() <= new Date(expired.created_at).getTime()
        ) {
          return false;
        }
        if (!candidate.expires_on || !expired.expires_on) return false;
        return candidate.expires_on > expired.expires_on;
      });
      if (later) renewed += 1;
    }

    const expired = expiryByStudent.size;
    return {
      expired,
      renewed,
      notRenewed: Math.max(expired - renewed, 0),
      rate: safeRate(renewed, expired),
    };
  }

  const renewal = renewalStats(expiredCurrent);
  const previousRenewal = renewalStats(expiredPrevious, currentStart);
  const weeklyFrequency =
    activeStudents > 0 ? currentClassMetrics.attended / activeStudents / Math.max(days / 7, 1) : 0;

  const currentSaleIds = new Set(currentSales.map((sale) => sale.id));
  const productRevenue = new Map<string, number>();
  for (const line of saleLines) {
    if (
      line.refunded_at ||
      !currentSaleIds.has(line.sale_id) ||
      !isBetween(line.created_at, currentStart, currentEnd)
    )
      continue;
    productRevenue.set(
      line.product_name ?? "Producto",
      (productRevenue.get(line.product_name ?? "Producto") ?? 0) + line.line_total_minor,
    );
  }
  const productRows = [...productRevenue.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);

  const recentSales = currentSales.slice(0, 6);

  const bucketStep = days > 30 ? 7 : 1;
  const periodBuckets = Array.from({ length: Math.ceil(days / bucketStep) }, (_, index) => {
    const start = new Date(currentStart.getTime() + index * bucketStep * DAY);
    const end = new Date(Math.min(currentEnd.getTime(), start.getTime() + bucketStep * DAY));
    const rows = currentPayments.filter((item) => isBetween(item.created_at, start, end));
    const cm = classMetrics(
      currentSessions.filter((item) => isBetween(item.starts_at, start, end)),
    );
    return {
      key: start.toISOString(),
      label: new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short" }).format(
        start,
      ),
      amount: netPayments(rows),
      cm,
      active: activeCommercialStudentCount(isoDateKey(end, timeZone)),
      rows,
    };
  });

  const highestDemand = classRows[0];
  const lowestDemand = [...classRows].sort((a, b) => a.occupancy - b.occupancy)[0];
  const highestCancellation = [...classRows].sort((a, b) => b.cancellation - a.cancellation)[0];

  const onboardingRows = onboarding.filter((row) =>
    students.some((student) => student.id === row.student_id),
  );
  const onboardingSteps = [
    ["Documentos", "documents_completed_at"],
    ["Perfil", "profile_completed_at"],
    ["Primera reserva", "first_reservation_at"],
    ["Primera asistencia", "first_attendance_at"],
    ["PWA instalada", "app_installed_at"],
    ["Push activado", "notifications_enabled_at"],
  ] as const;
  const onboardingComplete = onboardingRows.filter((row) => row.completed_at).length;
  const onboardingPending = onboardingRows
    .filter((row) => !row.completed_at)
    .map((row) => {
      const student = students.find((item) => item.id === row.student_id);
      const completed = onboardingSteps.filter(([, key]) => Boolean(row[key])).length;
      return {
        studentId: row.student_id,
        name: student?.full_name ?? "Alumna",
        completed,
      };
    })
    .sort((a, b) => a.completed - b.completed || a.name.localeCompare(b.name));

  const waitlist = (waitlistResult.data ?? []) as {
    id: string;
    session_id: string;
    status: string;
  }[];
  const currentSessionIds = new Set(currentSessions.map((row) => row.id));
  const waiting = waitlist.filter(
    (row) => currentSessionIds.has(row.session_id) && row.status !== "cancelled",
  );
  const methodNames = new Map(
    ((methodsResult.data ?? []) as { code: string; name: string }[]).map((m) => [m.code, m.name]),
  );
  const methodCodes = [...new Set(currentPayments.map((p) => p.method ?? "unknown"))];
  const methodLabel = (code: string) =>
    methodNames.get(code) ??
    (
      {
        cash: "Efectivo",
        bank_transfer: "Transferencia",
        card: "Tarjeta",
        mercadopago: "Mercado Pago",
        unknown: "Sin método registrado",
      } as Record<string, string>
    )[code] ??
    code;
  const paymentMethods = [...new Set(methodCodes.map(methodLabel))];
  const chartProps = { locale, currency: studio.currency };
  const labels = periodBuckets.map((b) => b.label);
  const topStudents = new Map<string, number>();
  for (const r of reservations)
    if (r.student_id && r.status === "attended" && currentSessionIds.has(r.session_id))
      topStudents.set(r.student_id, (topStudents.get(r.student_id) ?? 0) + 1);
  const studentNames = new Map(students.map((student) => [student.id, student.full_name]));
  const heat = new Map<
    string,
    { day: number; hour: string; attended: number; capacity: number; names: Set<string> }
  >();
  const slots = new Map<string, { label: string; name: string; rows: SessionRow[] }>();
  const weekdayNames = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(2026, 9, 4 + i)),
    ),
  );
  for (const session of currentSessions) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(session.starts_at));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    const hour = get("hour") + ":" + get("minute");
    const key = day + "-" + hour;
    const name = templateMap.get(session.template_id)?.name ?? "Clase";
    const cell = heat.get(key) ?? { day, hour, attended: 0, capacity: 0, names: new Set<string>() };
    cell.capacity += session.capacity ?? 0;
    cell.attended += classMetrics([session]).attended;
    cell.names.add(name);
    heat.set(key, cell);
    const slotKey = key + "-" + session.template_id;
    const slot = slots.get(slotKey) ?? { label: weekdayNames[day] + " " + hour, name, rows: [] };
    slot.rows.push(session);
    slots.set(slotKey, slot);
  }
  const heatHours = [...new Set([...heat.values()].map((cell) => cell.hour))].sort();
  const soonDate = isoDateKey(new Date(now.getTime() + 7 * DAY), timeZone);
  const expiringSoon = commercialAcquisitions.filter(
    (row) =>
      row.status === "active" &&
      row.expires_on &&
      row.expires_on >= todayDate &&
      row.expires_on <= soonDate,
  );
  type Conversation = {
    id: string;
    student_id: string | null;
    provider_contact_id: string | null;
    contact_phone: string | null;
    source: string | null;
    started_at: string;
  };
  const conversations = (conversationsResult.data ?? []) as Conversation[];
  const leadMap = new Map<string, Conversation>();
  for (const row of [...conversations].sort((a, b) => a.started_at.localeCompare(b.started_at))) {
    const key = row.student_id ?? row.provider_contact_id ?? row.contact_phone ?? row.id;
    if (!leadMap.has(key)) leadMap.set(key, row);
  }
  const leads = [...leadMap.values()].filter((row) =>
    isBetween(row.started_at, currentStart, currentEnd),
  );
  const sources = [...new Set(leads.map((row) => row.source ?? "Sin origen registrado"))];
  const convertedLead = (row: Conversation) =>
    Boolean(
      row.student_id &&
      students.some(
        (student) => student.id === row.student_id && student.trial_status === "converted",
      ),
    );
  const firstPackageByStudent = new Map<string, AcquisitionRow>();
  for (const row of commercialAcquisitions) {
    if (
      !["package", "membership"].includes(
        productTemplateMap.get(row.product_template_id)?.product_type ?? "",
      )
    )
      continue;
    const existing = firstPackageByStudent.get(row.student_id);
    if (!existing || row.created_at < existing.created_at)
      firstPackageByStudent.set(row.student_id, row);
  }
  const newPackages = [...firstPackageByStudent.values()].filter((row) =>
    isBetween(row.created_at, currentStart, currentEnd),
  ).length;
  const hrefFor = (target: ViewKey) =>
    viewHref(target, days) + (discipline ? "&discipline=" + encodeURIComponent(discipline) : "");
  const [pageTitle, pageDescription] = titleFor(view);

  return (
    <main className="intel-page">
      <header className="intel-header">
        <div>
          <p className="intel-kicker">INTELIGENCIA</p>
          <h1>{pageTitle}</h1>
          <p>{pageDescription}</p>
        </div>
        <div className="intel-periods" aria-label="Periodo">
          {[7, 30, 90].map((value) => (
            <Link
              key={value}
              href={
                periodHref(view, value) +
                (discipline ? "&discipline=" + encodeURIComponent(discipline) : "")
              }
              aria-current={days === value ? "true" : undefined}
              className={days === value ? "is-active" : undefined}
            >
              {value} días
            </Link>
          ))}
        </div>
      </header>

      <nav className="intel-tabs" aria-label="Secciones de inteligencia">
        {views.map((item) => (
          <Link
            key={item.key}
            href={
              viewHref(item.key, days) +
              (discipline ? "&discipline=" + encodeURIComponent(discipline) : "")
            }
            aria-current={view === item.key ? "page" : undefined}
            className={view === item.key ? "is-active" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <form className="intel-filters" action="/admin/inteligencia">
        <input type="hidden" name="view" value={view} />
        <input type="hidden" name="days" value={days} />
        <label htmlFor="intel-discipline">Disciplina</label>
        <select id="intel-discipline" name="discipline" defaultValue={discipline}>
          <option value="">Todas</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button type="submit" className="intel-toggle">
          Aplicar
        </button>
        <span>
          {new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short" }).format(
            currentStart,
          )}{" "}
          –{" "}
          {new Intl.DateTimeFormat(locale, {
            timeZone,
            day: "numeric",
            month: "short",
            year: "numeric",
          }).format(currentEnd)}
        </span>
      </form>
      {view === "dinero" || view === "alumnas" || view === "conversion" ? (
        <p className="intel-source-note">
          El filtro de disciplina se aplica a asistencia y clases. Los pagos, la retención y la
          conversión muestran el total del estudio.
        </p>
      ) : null}

      {view === "resumen" ? (
        <>
          <section className="intel-kpi-grid">
            <MetricCard
              label="Ingresos cobrados"
              href={hrefFor("dinero")}
              value={money(currentRevenue, studio.currency, locale)}
              delta={deltaText(currentRevenue, previousRevenue)}
              tone={currentRevenue >= previousRevenue ? "positive" : "danger"}
            />
            <MetricCard
              label="Alumnas activas"
              href={hrefFor("alumnas")}
              value={String(activeStudents)}
              delta={deltaText(activeStudents, previousActiveStudents)}
              tone="positive"
            />
            <MetricCard
              label="Conversión de prueba"
              href={hrefFor("conversion")}
              value={pct(trialConversion, locale)}
              delta={pointsDelta(trialConversion, previousTrialConversion)}
              tone={trialConversion >= previousTrialConversion ? "positive" : "warning"}
            />
            <MetricCard
              label="Ocupación"
              href={hrefFor("asistencia")}
              value={pct(currentClassMetrics.occupancy, locale)}
              delta={pointsDelta(currentClassMetrics.occupancy, previousClassMetrics.occupancy)}
              tone={currentClassMetrics.occupancy >= 70 ? "positive" : "warning"}
            />
            <MetricCard
              label="Asistencia"
              value={pct(currentClassMetrics.attendance, locale)}
              delta={pointsDelta(currentClassMetrics.attendance, previousClassMetrics.attendance)}
              href={hrefFor("asistencia")}
              tone="positive"
            />
            <MetricCard
              label="Clases reservadas"
              value={String(currentClassMetrics.reservations)}
              delta={deltaText(currentClassMetrics.reservations, previousClassMetrics.reservations)}
              href={hrefFor("clases")}
            />
            <MetricCard
              label="Cancelaciones"
              value={pct(currentClassMetrics.cancellation, locale)}
              delta={pointsDelta(
                currentClassMetrics.cancellation,
                previousClassMetrics.cancellation,
              )}
              href={hrefFor("clases")}
              tone="warning"
            />
            <MetricCard
              label="No show"
              value={pct(currentClassMetrics.noShow, locale)}
              delta={pointsDelta(currentClassMetrics.noShow, previousClassMetrics.noShow)}
              href={hrefFor("asistencia")}
              tone="danger"
            />
          </section>

          <div className="intel-two-column">
            <div className="intel-stack">
              <Section
                title="Requiere atención"
                description="Sólo aparecen señales que justifican una acción concreta."
              >
                <div className="intel-insight-list">
                  {riskStudents.length ? (
                    <Insight
                      tone="danger"
                      title={"🚨 " + riskStudents.length + " alumnas en riesgo"}
                      body="Su paquete venció hace 7–14 días y todavía no registran una nueva compra."
                      href="/admin/alumnas"
                    />
                  ) : (
                    <Insight
                      tone="positive"
                      title="✓ Sin alumnas en riesgo inmediato"
                      body="No hay paquetes vencidos dentro de la ventana de 7–14 días."
                    />
                  )}
                  {highestCancellation && highestCancellation.cancellation >= 15 ? (
                    <Insight
                      tone="warning"
                      title={"⚠️ " + highestCancellation.name}
                      body={
                        "Es la clase con mayor cancelación del periodo: " +
                        pct(highestCancellation.cancellation, locale) +
                        "."
                      }
                      href={hrefFor("clases")}
                    />
                  ) : null}
                  {lowestDemand && lowestDemand.occupancy < 60 ? (
                    <Insight
                      tone="warning"
                      title={lowestDemand.name + " tiene lugares disponibles"}
                      body={
                        "Ocupación del periodo: " +
                        pct(lowestDemand.occupancy, locale) +
                        ". Revisa horarios y promoción."
                      }
                      href={hrefFor("clases")}
                    />
                  ) : null}
                  {currentClassMetrics.noShow > 10 ? (
                    <Insight
                      tone="danger"
                      title="Revisar inasistencias"
                      body={
                        pct(currentClassMetrics.noShow, locale) +
                        " de no show. Revisa el seguimiento y los recordatorios configurados."
                      }
                      href={hrefFor("asistencia")}
                    />
                  ) : null}
                  {waiting.length ? (
                    <Insight
                      tone="info"
                      title={waiting.length + " solicitudes de lista de espera"}
                      body="Hay demanda adicional para las clases del periodo. Revisa la capacidad por horario."
                      href={hrefFor("clases")}
                    />
                  ) : null}
                  {pendingCurrent > 0 ? (
                    <Insight
                      tone="warning"
                      title="💳 Cobranza pendiente"
                      body={
                        money(pendingCurrent, studio.currency, locale) +
                        " continúan sin cobrar en ventas confirmadas."
                      }
                      href={hrefFor("dinero")}
                    />
                  ) : null}
                </div>
              </Section>

              <Section
                title="Movimiento de ingresos"
                description="Cobros menos reembolsos registrados en el periodo."
              >
                <TrendChart
                  title="Ingresos del periodo"
                  labels={periodBuckets.map((b) => b.label)}
                  series={[
                    {
                      name: "Cobros netos",
                      values: periodBuckets.map((b) => b.amount),
                      tone: "accent",
                    },
                  ]}
                  locale={locale}
                  currency={studio.currency}
                  format="money"
                />
              </Section>
            </div>

            <div className="intel-stack">
              <Section
                title="Conversión de prueba"
                description="El sistema actual empieza a medir desde la clase de prueba registrada."
              >
                <div className="intel-bars">
                  <BarRow
                    label="Pruebas registradas"
                    value={trialCurrent.length}
                    max={Math.max(trialCurrent.length, 1)}
                    display={String(trialCurrent.length)}
                    tone="info"
                  />
                  <BarRow
                    label="Asistieron"
                    value={trialAttended}
                    max={Math.max(trialCurrent.length, 1)}
                    display={String(trialAttended)}
                    tone="info"
                  />
                  <BarRow
                    label="Se convirtieron"
                    value={trialConverted}
                    max={Math.max(trialCurrent.length, 1)}
                    display={String(trialConverted)}
                    tone="success"
                  />
                </div>
                <div className="intel-source-note">
                  La vista Conversión incluye conversaciones registradas y su origen cuando existe
                  un vínculo verificable.
                </div>
              </Section>

              <Section title="Clases" description="Señales rápidas de capacidad.">
                <div className="intel-compact-table">
                  <div className="intel-table-head">
                    <span>Clase</span>
                    <span>Ocup.</span>
                  </div>
                  {classRows.slice(0, 4).map((row) => (
                    <div className="intel-table-row" key={row.name}>
                      <span>{row.name}</span>
                      <strong>{pct(row.occupancy, locale)}</strong>
                    </div>
                  ))}
                </div>
              </Section>
            </div>
          </div>
        </>
      ) : null}

      {view === "dinero" ? (
        <>
          <section className="intel-kpi-grid">
            <MetricCard
              label="Ingresos cobrados"
              value={money(currentRevenue, studio.currency, locale)}
              delta={deltaText(currentRevenue, previousRevenue)}
              tone={currentRevenue >= previousRevenue ? "positive" : "danger"}
            />
            <MetricCard
              label="Pendiente de cobro"
              value={money(pendingCurrent, studio.currency, locale)}
              delta={pendingCurrent > 0 ? "Requiere seguimiento" : "Sin pendientes"}
              tone={pendingCurrent > 0 ? "warning" : "positive"}
            />
            <MetricCard
              label="Ticket promedio"
              value={money(ticketAverage, studio.currency, locale)}
              delta={deltaText(ticketAverage, previousTicketAverage)}
              tone="neutral"
            />
            <MetricCard
              label="Reembolsos"
              value={money(currentRefunds, studio.currency, locale)}
              delta={deltaText(currentRefunds, previousRefunds)}
              tone={currentRefunds > previousRefunds ? "danger" : "neutral"}
            />
            <MetricCard
              label="Pagos recibidos"
              value={String(currentPayments.filter((p) => p.kind !== "refund").length)}
              delta={deltaText(
                currentPayments.filter((p) => p.kind !== "refund").length,
                previousPayments.filter((p) => p.kind !== "refund").length,
              )}
            />
            <MetricCard
              label="Primer paquete"
              value={String(newPackages)}
              delta="Alumnas con su primer paquete o membresía en el periodo"
            />
          </section>

          <TrendChart
            title="Ingresos por método de pago"
            labels={labels}
            series={paymentMethods.map((label, i) => ({
              name: label,
              values: periodBuckets.map((b) =>
                netPayments(b.rows.filter((p) => methodLabel(p.method ?? "unknown") === label)),
              ),
              tone: (["info", "success", "warning", "accent"] as const)[i % 4],
            }))}
            format="money"
            {...chartProps}
          />
          <Section title="Cómo pagan">
            <div className="intel-bars">
              {paymentMethods.map((label) => {
                const amount = netPayments(
                  currentPayments.filter((p) => methodLabel(p.method ?? "unknown") === label),
                );
                return (
                  <BarRow
                    key={label}
                    label={label}
                    value={Math.max(amount, 0)}
                    max={Math.max(currentRevenue, 0)}
                    display={money(amount, studio.currency, locale)}
                    tone="info"
                  />
                );
              })}
            </div>
          </Section>
          <Section
            title="Pagos pendientes"
            description="Saldos abiertos de todas las ventas confirmadas, incluidos los anteriores al periodo."
          >
            <div className="intel-data-table">
              {pendingSales.map((sale) => {
                const balance = Math.max(
                  (collectibleBySale.get(sale.id) ?? sale.total_minor) -
                    (paymentBySale.get(sale.id) ?? 0),
                  0,
                );
                return balance > 0 ? (
                  <Link
                    key={sale.id}
                    href={"/admin/ventas/" + sale.id}
                    className="intel-data-row intel-sales-grid"
                  >
                    <span>{sale.folio}</span>
                    <span>{studentNames.get(sale.student_id) ?? "Alumna"}</span>
                    <strong>{money(balance, sale.currency, locale)}</strong>
                  </Link>
                ) : null;
              })}
            </div>
            {pendingCurrent === 0 ? <p className="intel-empty">No hay pagos pendientes.</p> : null}
          </Section>
          <div className="intel-two-column">
            <div className="intel-stack">
              <Section title="Ingresos cobrados" description="Cobros netos por día.">
                <TrendChart
                  title="Ingresos del periodo"
                  labels={periodBuckets.map((b) => b.label)}
                  series={[
                    {
                      name: "Cobros netos",
                      values: periodBuckets.map((b) => b.amount),
                      tone: "accent",
                    },
                  ]}
                  locale={locale}
                  currency={studio.currency}
                  format="money"
                />
              </Section>

              <Section title="Ventas recientes">
                <div className="intel-data-table">
                  <div className="intel-data-head intel-sales-grid">
                    <span>Folio</span>
                    <span>Alumna</span>
                    <span>Total</span>
                  </div>
                  {recentSales.map((sale) => {
                    const student = students.find((item) => item.id === sale.student_id);
                    return (
                      <Link
                        href={"/admin/ventas/" + sale.id}
                        className="intel-data-row intel-sales-grid"
                        key={sale.id}
                      >
                        <span>{sale.folio}</span>
                        <span>{student?.full_name ?? "Alumna"}</span>
                        <strong>{money(sale.total_minor, sale.currency, locale)}</strong>
                      </Link>
                    );
                  })}
                </div>
              </Section>
            </div>

            <div className="intel-stack">
              <Section title="Por producto">
                <div className="intel-bars">
                  {productRows.length ? (
                    productRows.map((item) => (
                      <BarRow
                        key={item.name}
                        label={item.name}
                        value={item.amount}
                        max={productRows[0]?.amount ?? 1}
                        display={money(item.amount, studio.currency, locale)}
                        tone="success"
                      />
                    ))
                  ) : (
                    <p className="intel-empty">No hubo líneas de venta en el periodo.</p>
                  )}
                </div>
              </Section>

              <Section title="Cobranza">
                <div className="intel-insight-list">
                  <Insight
                    tone={pendingCurrent > 0 ? "warning" : "positive"}
                    title={
                      pendingCurrent > 0
                        ? "⚠️ Hay saldo pendiente"
                        : "✓ Ventas confirmadas sin saldo pendiente"
                    }
                    body={
                      pendingCurrent > 0
                        ? money(pendingCurrent, studio.currency, locale) +
                          " no han sido cobrados todavía."
                        : "No detectamos saldo abierto en ventas confirmadas."
                    }
                    href="/admin/ventas"
                  />
                  <Insight
                    tone={currentRefunds > 0 ? "danger" : "info"}
                    title="↩ Reembolsos"
                    body={
                      money(currentRefunds, studio.currency, locale) + " registrados en el periodo."
                    }
                    href="/admin/ventas"
                  />
                </div>
              </Section>
            </div>
          </div>
        </>
      ) : null}

      {view === "alumnas" ? (
        <>
          <section className="intel-kpi-grid">
            <MetricCard
              label="Activas"
              value={String(activeStudents)}
              delta={deltaText(activeStudents, previousActiveStudents)}
              tone="positive"
            />
            <MetricCard
              label="Nuevas"
              value={String(currentStudents.length)}
              delta={deltaText(currentStudents.length, previousStudents.length)}
              tone="info"
            />
            <MetricCard
              label="En riesgo"
              value={String(riskStudents.length)}
              delta="7–14 días desde vencimiento"
              tone={riskStudents.length ? "warning" : "positive"}
            />
            <MetricCard
              label="Abandono"
              value={String(abandonedStudents.length)}
              delta="30+ días desde vencimiento"
              tone={abandonedStudents.length ? "danger" : "neutral"}
            />
          </section>

          <section className="intel-kpi-grid">
            <MetricCard
              label="Renovación"
              value={pct(renewal.rate, locale)}
              delta={pointsDelta(renewal.rate, previousRenewal.rate)}
              tone="positive"
            />
            <MetricCard
              label="Alumnas con vencimiento"
              value={String(renewal.expired)}
              delta={deltaText(renewal.expired, previousRenewal.expired)}
            />
            <MetricCard
              label="No renovaron"
              value={String(renewal.notRenewed)}
              delta={deltaText(renewal.notRenewed, previousRenewal.notRenewed)}
              tone="warning"
            />
          </section>
          <TrendChart
            title="Alumnas con producto vigente"
            labels={labels}
            series={[
              { name: "Activas", values: periodBuckets.map((b) => b.active), tone: "success" },
            ]}
            {...chartProps}
          />
          <Section title="Vencen en los próximos 7 días">
            {expiringSoon.length ? (
              <div className="intel-risk-list">
                {expiringSoon.map((row) => (
                  <Link
                    key={row.id}
                    href={"/admin/alumnas/" + row.student_id}
                    className="intel-risk-row"
                  >
                    <span>
                      {studentNames.get(row.student_id) ?? "Alumna"}
                      <small>
                        {productTemplateMap.get(row.product_template_id)?.name ?? "Producto"}
                      </small>
                    </span>
                    <b>{row.expires_on}</b>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="intel-empty">No hay productos por vencer esta semana.</p>
            )}
          </Section>
          <Section title="Antigüedad de alumnas activas">
            <div className="intel-bars">
              {[
                ["0 a 3 meses", 0, 90],
                ["3 a 6 meses", 90, 180],
                ["6 a 12 meses", 180, 365],
                ["Más de 1 año", 365, Infinity],
              ].map(([label, min, max]) => {
                const count = students.filter((student) => {
                  const age = (now.getTime() - new Date(student.created_at).getTime()) / DAY;
                  return (
                    age >= Number(min) &&
                    age < Number(max) &&
                    commercialAcquisitions.some(
                      (row) =>
                        row.student_id === student.id &&
                        (row.starts_on ?? row.created_at.slice(0, 10)) <= todayDate &&
                        (!row.expires_on || row.expires_on >= todayDate),
                    )
                  );
                }).length;
                return (
                  <BarRow
                    key={String(label)}
                    label={String(label)}
                    value={count}
                    max={activeStudents}
                    display={String(count)}
                    tone="success"
                  />
                );
              })}
            </div>
          </Section>
          <p className="intel-source-note">
            Renovación = alumnas con otro producto comercial posterior que extiende su vigencia /
            alumnas con producto vencido. Cada alumna cuenta una vez; se excluyen productos
            cancelados y reembolsados.
          </p>
          <div className="intel-two-column">
            <div className="intel-stack">
              <Section title="Estado de alumnas">
                <div className="intel-bars">
                  <BarRow
                    label="Activas"
                    value={activeStudents}
                    max={Math.max(students.length, 1)}
                    display={String(activeStudents)}
                    tone="success"
                  />
                  <BarRow
                    label="En riesgo"
                    value={riskStudents.length}
                    max={Math.max(students.length, 1)}
                    display={String(riskStudents.length)}
                    tone="warning"
                  />
                  <BarRow
                    label="Inactivas"
                    value={inactiveStudents.length}
                    max={Math.max(students.length, 1)}
                    display={String(inactiveStudents.length)}
                    tone="info"
                  />
                  <BarRow
                    label="Abandono"
                    value={abandonedStudents.length}
                    max={Math.max(students.length, 1)}
                    display={String(abandonedStudents.length)}
                    tone="danger"
                  />
                </div>
              </Section>

              <Section
                title="Activación del portal"
                description="Progreso real de los pasos necesarios para completar la activación."
              >
                <div className="intel-bars">
                  {onboardingSteps.map(([label, key]) => {
                    const completed = onboardingRows.filter((row) => Boolean(row[key])).length;
                    return (
                      <BarRow
                        key={key}
                        label={label}
                        value={completed}
                        max={Math.max(onboardingRows.length, 1)}
                        display={completed + "/" + onboardingRows.length}
                        tone={
                          completed === onboardingRows.length && onboardingRows.length > 0
                            ? "success"
                            : "info"
                        }
                      />
                    );
                  })}
                  <BarRow
                    label="Onboarding completo"
                    value={onboardingComplete}
                    max={Math.max(onboardingRows.length, 1)}
                    display={onboardingComplete + "/" + onboardingRows.length}
                    tone="success"
                  />
                </div>
              </Section>

              <Section
                title="Frecuencia semanal"
                description="Asistencias promedio por alumna activa durante el periodo."
              >
                <div className="intel-frequency-value">
                  <strong>{weeklyFrequency.toFixed(1)}</strong>
                  <span>clases / semana</span>
                </div>
              </Section>
            </div>

            <div className="intel-stack">
              <Section
                title="Requieren seguimiento"
                description="Tocar una alumna abre directamente su perfil."
              >
                <div className="intel-risk-list">
                  {[...riskStudents, ...inactiveStudents, ...abandonedStudents]
                    .sort((a, b) => b.days - a.days)
                    .slice(0, 8)
                    .map((item) => (
                      <Link
                        href={"/admin/alumnas/" + item.id}
                        key={item.id}
                        className="intel-risk-row"
                      >
                        <span>
                          <strong>{item.name}</strong>
                          <small>{item.days} días desde vencimiento</small>
                        </span>
                        <b>{item.state}</b>
                      </Link>
                    ))}
                  {!riskStudents.length && !inactiveStudents.length && !abandonedStudents.length ? (
                    <p className="intel-empty">
                      No hay alumnas dentro de estas ventanas de riesgo.
                    </p>
                  ) : null}
                </div>
              </Section>

              <Section
                title="Onboarding pendiente"
                description="Ordenado por quienes tienen menos pasos completados."
              >
                <div className="intel-risk-list">
                  {onboardingPending.slice(0, 8).map((item) => (
                    <Link
                      href={"/admin/alumnas/" + item.studentId}
                      key={item.studentId}
                      className="intel-risk-row"
                    >
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.completed}/6 pasos completados</small>
                      </span>
                      <b>Pendiente</b>
                    </Link>
                  ))}
                  {!onboardingPending.length ? (
                    <p className="intel-empty">No hay onboarding pendiente.</p>
                  ) : null}
                </div>
              </Section>
            </div>
          </div>
        </>
      ) : null}

      {view === "conversion" ? (
        <>
          <section className="intel-kpi-grid">
            <MetricCard
              label="Pruebas registradas"
              value={String(trialCurrent.length)}
              delta={deltaText(trialCurrent.length, trialPrevious.length)}
              tone="info"
            />
            <MetricCard
              label="Asistieron"
              value={String(trialAttended)}
              delta={deltaText(trialAttended, trialPreviousAttended)}
              tone="positive"
            />
            <MetricCard
              label="Se convirtieron"
              value={String(trialConverted)}
              delta={deltaText(trialConverted, trialPreviousConverted)}
              tone="positive"
            />
            <MetricCard
              label="Conversión"
              value={pct(trialConversion, locale)}
              delta={pointsDelta(trialConversion, previousTrialConversion)}
              tone={trialConversion >= previousTrialConversion ? "positive" : "warning"}
            />
          </section>

          <TrendChart
            title="Contactos y compras atribuidas"
            labels={labels}
            series={[
              {
                name: "Contactos",
                values: periodBuckets.map((_, i) => {
                  const start = new Date(currentStart.getTime() + i * bucketStep * DAY);
                  const end = new Date(
                    Math.min(currentEnd.getTime(), start.getTime() + bucketStep * DAY),
                  );
                  return leads.filter((row) => isBetween(row.started_at, start, end)).length;
                }),
                tone: "info",
              },
              {
                name: "Compraron",
                values: periodBuckets.map((_, i) => {
                  const start = new Date(currentStart.getTime() + i * bucketStep * DAY);
                  const end = new Date(
                    Math.min(currentEnd.getTime(), start.getTime() + bucketStep * DAY),
                  );
                  return leads.filter(
                    (row) => isBetween(row.started_at, start, end) && convertedLead(row),
                  ).length;
                }),
                tone: "accent",
              },
            ]}
            {...chartProps}
          />
          <p className="intel-source-note">
            Las compras atribuidas pertenecen a la cohorte de contactos del periodo; no representan
            la fecha de cobro.
          </p>
          <MetricCard
            label="No show en prueba"
            value={pct(
              safeRate(
                trialNoShow,
                trialCurrent.filter((s) =>
                  ["attended", "converted", "no_show", "pending"].includes(s.trial_status ?? ""),
                ).length,
              ),
              locale,
            )}
            delta="Pruebas con no show / pruebas no canceladas"
            tone="danger"
          />
          <div className="intel-two-column">
            <div className="intel-stack">
              <Section
                title="🎯 Embudo medible hoy"
                description="La cohorte se toma por la fecha en que se creó la clase de prueba."
              >
                <div className="intel-bars">
                  <BarRow
                    label="Pruebas registradas"
                    value={trialCurrent.length}
                    max={Math.max(trialCurrent.length, 1)}
                    display={String(trialCurrent.length)}
                    tone="info"
                  />
                  <BarRow
                    label="Asistieron"
                    value={trialAttended}
                    max={Math.max(trialCurrent.length, 1)}
                    display={String(trialAttended)}
                    tone="accent"
                  />
                  <BarRow
                    label="Se convirtieron"
                    value={trialConverted}
                    max={Math.max(trialCurrent.length, 1)}
                    display={String(trialConverted)}
                    tone="success"
                  />
                </div>
              </Section>

              <Section
                title="Prospectos y origen"
                description="Contactos únicos en conversaciones registradas, agrupados por su primer contacto dentro del rango consultado."
              >
                {leads.length ? (
                  <>
                    <MetricCard
                      label="Prospectos registrados"
                      value={String(leads.length)}
                      delta="Una persona cuenta una vez"
                    />
                    <MetricCard
                      label="Contacto → paquete"
                      value={pct(
                        safeRate(leads.filter(convertedLead).length, leads.length),
                        locale,
                      )}
                      delta="Conversaciones vinculadas a alumnas convertidas"
                    />
                    <SortableTable
                      locale={locale}
                      initialSort={{ column: 3, direction: -1 }}
                      title="Conversión por origen"
                      columns={["Origen", "Contactos", "Compraron", "Conversión %"]}
                      rows={sources.map((source) => {
                        const rows = leads.filter(
                          (row) => (row.source ?? "Sin origen registrado") === source,
                        );
                        const buyers = rows.filter(convertedLead).length;
                        return [source, rows.length, buyers, safeRate(buyers, rows.length)];
                      })}
                    />
                  </>
                ) : (
                  <p className="intel-empty">
                    No hay conversaciones registradas en el periodo. El embudo de pruebas sigue
                    disponible.
                  </p>
                )}
                <p className="intel-source-note">
                  Las conversaciones sin vínculo a una alumna no se atribuyen a compras. La
                  calificación y el escalamiento a una persona no cuentan todavía con un evento
                  medible.
                </p>
              </Section>
            </div>

            <div className="intel-stack">
              <Section title="🧩 Fugas de la prueba">
                <div className="intel-insight-list">
                  <Insight
                    tone="warning"
                    title="⚠️ No show"
                    body={
                      trialNoShow + " clases de prueba terminaron en no show durante el periodo."
                    }
                  />
                  <Insight
                    tone="danger"
                    title="🚨 Asistieron y no compraron"
                    body={
                      Math.max(trialAttended - trialConverted, 0) +
                      " personas asistieron pero todavía no aparecen como convertidas."
                    }
                  />
                </div>
              </Section>
            </div>
          </div>
        </>
      ) : null}

      {view === "asistencia" ? (
        <>
          <section className="intel-kpi-grid">
            <MetricCard
              label="Asistencia"
              value={pct(currentClassMetrics.attendance, locale)}
              delta={pointsDelta(currentClassMetrics.attendance, previousClassMetrics.attendance)}
              tone="positive"
            />
            <MetricCard
              label="Visitas al estudio"
              value={String(currentClassMetrics.attended)}
              delta={deltaText(currentClassMetrics.attended, previousClassMetrics.attended)}
            />
            <MetricCard
              label="No show"
              value={pct(currentClassMetrics.noShow, locale)}
              delta={pointsDelta(currentClassMetrics.noShow, previousClassMetrics.noShow)}
              tone="danger"
            />
            <MetricCard
              label="Promedio por clase"
              value={new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
                currentClassMetrics.attended / (currentSessions.length || 1),
              )}
              delta="Asistencias entre clases del periodo"
            />
          </section>
          <TrendChart
            title="Asistencia y no show"
            labels={labels}
            series={[
              {
                name: "Asistencia",
                values: periodBuckets.map((b) => b.cm.attendance),
                tone: "success",
              },
              { name: "No show", values: periodBuckets.map((b) => b.cm.noShow), tone: "danger" },
            ]}
            format="percent"
            {...chartProps}
          />
          <div className="intel-two-column">
            <Section
              title="Ocupación por día y hora"
              description="Asistencias entre lugares disponibles. Toca una celda para ver la disciplina."
            >
              {heatHours.length ? (
                <div className="intel-table-scroll">
                  <table className="intel-table intel-heat">
                    <thead>
                      <tr>
                        <th>Día</th>
                        {heatHours.map((hour) => (
                          <th key={hour}>{hour}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                        <tr key={day}>
                          <th scope="row">{weekdayNames[day]}</th>
                          {heatHours.map((hour) => {
                            const cell = heat.get(day + "-" + hour);
                            const rate = cell ? safeRate(cell.attended, cell.capacity) : 0;
                            return (
                              <td key={hour}>
                                {cell ? (
                                  <details
                                    className={
                                      rate >= 75 ? "is-high" : rate < 40 ? "is-low" : "is-medium"
                                    }
                                  >
                                    <summary>{pct(rate, locale)}</summary>
                                    <span>
                                      {[...cell.names].join(", ")} · {cell.attended}/{cell.capacity}{" "}
                                      lugares
                                    </span>
                                  </details>
                                ) : (
                                  "—"
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="intel-empty">Sin clases en el periodo.</p>
              )}
            </Section>
            <Section title="Asistencia por disciplina">
              <div className="intel-bars">
                {classRows.map((row) => (
                  <BarRow
                    key={row.name}
                    label={row.name}
                    value={row.attendance}
                    max={100}
                    display={pct(row.attendance, locale)}
                    tone="success"
                  />
                ))}
              </div>
            </Section>
          </div>
          <SortableTable
            locale={locale}
            initialSort={{ column: 1, direction: -1 }}
            title="Alumnas más constantes"
            columns={["Alumna", "Clases tomadas"]}
            rows={[...topStudents].map(([id, count]) => [studentNames.get(id) ?? "Alumna", count])}
          />
          <p className="intel-source-note">
            Asistencia = asistió / reservas no canceladas a tiempo. Ocupación = asistió / capacidad.
            No show = no asistió / reservas sin cancelación. Se usan los estados registrados por el
            estudio.
          </p>
        </>
      ) : null}
      {view === "clases" ? (
        <>
          <section className="intel-kpi-grid">
            <MetricCard
              label="Ocupación"
              value={pct(currentClassMetrics.occupancy, locale)}
              delta={pointsDelta(currentClassMetrics.occupancy, previousClassMetrics.occupancy)}
              tone={currentClassMetrics.occupancy >= 70 ? "positive" : "warning"}
            />
            <MetricCard
              label="Asistencias"
              value={String(currentClassMetrics.attended)}
              delta={deltaText(currentClassMetrics.attended, previousClassMetrics.attended)}
              tone="neutral"
            />
            <MetricCard
              label="Cancelaciones"
              value={pct(currentClassMetrics.cancellation, locale)}
              delta={pointsDelta(
                currentClassMetrics.cancellation,
                previousClassMetrics.cancellation,
              )}
              tone={currentClassMetrics.cancellation > 15 ? "danger" : "warning"}
            />
            <MetricCard
              label="No show"
              value={pct(currentClassMetrics.noShow, locale)}
              delta={pointsDelta(currentClassMetrics.noShow, previousClassMetrics.noShow)}
              tone={currentClassMetrics.noShow > 10 ? "danger" : "neutral"}
            />
          </section>

          <section className="intel-kpi-grid">
            <MetricCard
              label="Clases impartidas"
              value={String(currentSessions.length)}
              delta={deltaText(currentSessions.length, previousSessions.length)}
            />
            <MetricCard
              label="Reservas"
              value={String(currentClassMetrics.reservations)}
              delta={deltaText(currentClassMetrics.reservations, previousClassMetrics.reservations)}
            />
            <MetricCard
              label="Canceladas a tiempo"
              value={String(currentClassMetrics.onTime)}
              delta={deltaText(currentClassMetrics.onTime, previousClassMetrics.onTime)}
              tone="info"
            />
            <MetricCard
              label="Canceladas tarde"
              value={String(currentClassMetrics.late)}
              delta={deltaText(currentClassMetrics.late, previousClassMetrics.late)}
              tone="danger"
            />
            <MetricCard
              label="Lista de espera"
              value={String(waiting.length)}
              delta="Solicitudes no canceladas para clases del periodo"
            />
          </section>
          <TrendChart
            title="¿Qué pasó con cada reserva?"
            labels={labels}
            stacked
            series={[
              { name: "Asistió", values: periodBuckets.map((b) => b.cm.attended), tone: "success" },
              {
                name: "No show",
                values: periodBuckets.map((b) => b.cm.noShowCount),
                tone: "danger",
              },
              {
                name: "Canceló a tiempo",
                values: periodBuckets.map((b) => b.cm.onTime),
                tone: "info",
              },
              {
                name: "Canceló tarde",
                values: periodBuckets.map((b) => b.cm.late),
                tone: "warning",
              },
              {
                name: "Sin resultado",
                values: periodBuckets.map((b) => b.cm.occupied - b.cm.attended - b.cm.noShowCount),
                tone: "accent",
              },
              {
                name: "Canceló el estudio",
                values: periodBuckets.map(
                  (b) => b.cm.reservations - b.cm.occupied - b.cm.onTime - b.cm.late,
                ),
                tone: "info",
              },
            ]}
            {...chartProps}
          />
          <SortableTable
            locale={locale}
            initialSort={{ column: 2, direction: -1 }}
            title="Rendimiento por horario"
            columns={[
              "Horario",
              "Disciplina",
              "Ocupación %",
              "Cancelación %",
              "Espera / clase",
              "Estado",
            ]}
            rows={[...slots.values()].map((slot) => {
              const cm = classMetrics(slot.rows);
              const ids = new Set(slot.rows.map((row) => row.id));
              return [
                slot.label,
                slot.name,
                cm.occupancy,
                cm.cancellation,
                waiting.filter((row) => ids.has(row.session_id)).length / slot.rows.length,
                cm.occupancy >= 75 ? "Alta" : cm.occupancy < 55 ? "Baja" : "Estable",
              ];
            })}
          />
          <p className="intel-source-note">
            Cancelar tarde:{" "}
            {cancellationCutoff == null
              ? "según la política de reservas del estudio"
              : "menos de " +
                new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
                  cancellationCutoff / 60,
                ) +
                " horas de anticipación"}
            . Ocupación = asistencias / lugares disponibles.
          </p>
          <div className="intel-two-column">
            <div className="intel-stack">
              <Section
                title="🪑 Rendimiento por clase"
                description="Demanda, asistencia real y pérdida de capacidad."
              >
                <div className="intel-data-table">
                  <div className="intel-data-head intel-class-grid">
                    <span>Clase</span>
                    <span>Ocup.</span>
                    <span>Asist.</span>
                    <span>Canc.</span>
                  </div>
                  {classRows.map((row) => (
                    <div className="intel-data-row intel-class-grid" key={row.name}>
                      <span>{row.name}</span>
                      <strong>{pct(row.occupancy, locale)}</strong>
                      <span>{pct(row.attendance, locale)}</span>
                      <span>{pct(row.cancellation, locale)}</span>
                    </div>
                  ))}
                </div>
              </Section>

              <Section title="Demanda por horario">
                <div className="intel-bars">
                  {Object.entries(daypart).map(([label, values]) => {
                    const rate = safeRate(values[0], values[1]);
                    return (
                      <BarRow
                        key={label}
                        label={label}
                        value={rate}
                        max={100}
                        display={pct(rate, locale)}
                        tone={rate >= 75 ? "success" : rate < 45 ? "warning" : "info"}
                      />
                    );
                  })}
                </div>
              </Section>

              <Section title="Demanda por día">
                <div className="intel-bars">
                  {[...weekday.entries()].map(([label, values]) => {
                    const rate = safeRate(values[0], values[1]);
                    return (
                      <BarRow
                        key={label}
                        label={label}
                        value={rate}
                        max={100}
                        display={pct(rate, locale)}
                      />
                    );
                  })}
                </div>
              </Section>
            </div>

            <div className="intel-stack">
              <Section title="Señales para decidir">
                <div className="intel-insight-list">
                  {highestDemand ? (
                    <Insight
                      tone="positive"
                      title="🔥 Mayor demanda"
                      body={
                        highestDemand.name +
                        " está en " +
                        pct(highestDemand.occupancy, locale) +
                        " de ocupación."
                      }
                    />
                  ) : null}
                  {lowestDemand ? (
                    <Insight
                      tone={lowestDemand.occupancy < 40 ? "danger" : "info"}
                      title="❄️ Menor demanda"
                      body={
                        lowestDemand.name +
                        " está en " +
                        pct(lowestDemand.occupancy, locale) +
                        " de ocupación."
                      }
                    />
                  ) : null}
                  {highestCancellation ? (
                    <Insight
                      tone={highestCancellation.cancellation >= 15 ? "warning" : "info"}
                      title="⚠️ Mayor cancelación"
                      body={
                        highestCancellation.name +
                        " concentra " +
                        pct(highestCancellation.cancellation, locale) +
                        " de cancelaciones."
                      }
                    />
                  ) : null}
                </div>
              </Section>

              <Section title="Qué revisar">
                <div className="intel-rule-list">
                  <div>
                    <span>&lt;40% por 4+ semanas</span>
                    <strong>Mover o promover</strong>
                  </div>
                  <div>
                    <span>&gt;15% cancelación</span>
                    <strong>Revisar horario</strong>
                  </div>
                  <div>
                    <span>&gt;90% ocupación</span>
                    <strong>Agregar capacidad</strong>
                  </div>
                </div>
              </Section>
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}
