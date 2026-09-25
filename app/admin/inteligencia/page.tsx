import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

type ViewKey =
  | "resumen"
  | "dinero"
  | "alumnas"
  | "conversion"
  | "clases"
  | "retencion"
  | "finanzas";

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

type TemplateRow = {
  id: string;
  name: string;
  color_hex: string | null;
};

const views: { key: ViewKey; label: string }[] = [
  { key: "resumen", label: "Resumen" },
  { key: "dinero", label: "Dinero" },
  { key: "alumnas", label: "Alumnas" },
  { key: "conversion", label: "Conversión" },
  { key: "clases", label: "Clases" },
  { key: "retencion", label: "Retención" },
  { key: "finanzas", label: "Finanzas" },
];

const DAY = 86_400_000;
const userCancellationStatuses = new Set(["cancelled_on_time", "cancelled_late"]);
const occupiedStatuses = new Set(["reserved", "attended", "no_show"]);

function clampDays(value: string | undefined) {
  const parsed = Number(value ?? "30");
  if (parsed === 7 || parsed === 30 || parsed === 90) return parsed;
  return 30;
}

function validView(value: string | undefined): ViewKey {
  return views.some((item) => item.key === value) ? (value as ViewKey) : "resumen";
}

function money(minor: number, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

function pct(value: number) {
  return new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 1,
  }).format(value) + "%";
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

function isoDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
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
  tone = "neutral",
}: {
  label: string;
  value: string;
  delta: string;
  tone?: Tone;
}) {
  return (
    <article className={"intel-metric is-" + tone}>
      <span>{label}</span>
      <strong>{value}</strong>
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
  const width = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0;
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

function EmptyMetric({ label }: { label: string }) {
  return (
    <MetricCard
      label={label}
      value="—"
      delta="Fuente pendiente"
      tone="warning"
    />
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
    resumen: ["Resumen", "Qué está pasando en el negocio y qué necesita tu atención."],
    dinero: ["Dinero", "Ingresos cobrados, ventas, productos y cobranza del periodo."],
    alumnas: ["Alumnas", "Crecimiento, actividad y señales tempranas de abandono."],
    conversion: ["Conversión", "Qué ocurre con las clases de prueba hasta convertirse en alumnas."],
    clases: ["Clases", "Qué disciplinas y horarios están usando bien —o mal— la capacidad."],
    retencion: ["Retención", "Quién renueva, quién se está alejando y cuándo debemos intervenir."],
    finanzas: [
      "Finanzas",
      "Ingresos y rentabilidad. La utilidad sólo existe cuando también registramos gastos.",
    ],
  };
  return map[view];
}

export default async function IntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; days?: string }>;
}) {
  const params = await searchParams;
  const view = validView(params.view);
  const days = clampDays(params.days);
  const { supabase, studio } = await getAdminContext(CAPABILITIES.REPORTS_READ);
  const now = new Date();
  const currentEnd = now;
  const currentStart = new Date(now.getTime() - days * DAY);
  const previousStart = new Date(currentStart.getTime() - days * DAY);
  const rangeStartIso = previousStart.toISOString();
  const currentStartIso = currentStart.toISOString();
  const currentStartDate = isoDateKey(currentStart);
  const previousStartDate = isoDateKey(previousStart);
  const todayDate = isoDateKey(now);

  const [
    studentsResult,
    acquisitionsResult,
    salesResult,
    paymentsResult,
    linesResult,
    sessionsResult,
    templatesResult,
  ] = await Promise.all([
    supabase
      .from("students")
      .select("id,full_name,active,lifecycle_status,student_type,trial_status,created_at")
      .eq("studio_id", studio.id),
    supabase
      .from("product_acquisitions")
      .select(
        "id,student_id,product_template_id,status,starts_on,expires_on,created_at,refunded_at",
      )
      .eq("studio_id", studio.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("sales")
      .select("id,student_id,folio,status,total_minor,currency,created_at")
      .eq("studio_id", studio.id)
      .gte("created_at", rangeStartIso)
      .order("created_at", { ascending: false }),
    supabase
      .from("payments")
      .select("sale_id,kind,amount_minor,created_at")
      .eq("studio_id", studio.id)
      .gte("created_at", rangeStartIso),
    supabase
      .from("sale_lines")
      .select("sale_id,product_template_id,product_name,line_total_minor,refunded_at,created_at")
      .eq("studio_id", studio.id)
      .gte("created_at", rangeStartIso),
    supabase
      .from("class_sessions")
      .select("id,template_id,starts_at,capacity,status")
      .eq("studio_id", studio.id)
      .gte("starts_at", rangeStartIso)
      .lt("starts_at", currentEnd.toISOString())
      .order("starts_at"),
    supabase
      .from("class_templates")
      .select("id,name,color_hex")
      .eq("studio_id", studio.id),
  ]);

  const students = (studentsResult.data ?? []) as StudentRow[];
  const acquisitions = (acquisitionsResult.data ?? []) as AcquisitionRow[];
  const sales = (salesResult.data ?? []) as SaleRow[];
  const payments = (paymentsResult.data ?? []) as PaymentRow[];
  const saleLines = (linesResult.data ?? []) as SaleLineRow[];
  const sessions = (sessionsResult.data ?? []) as SessionRow[];
  const templates = (templatesResult.data ?? []) as TemplateRow[];

  const sessionIds = sessions.map((session) => session.id);
  const reservationsResult = sessionIds.length
    ? await supabase
        .from("reservations")
        .select("id,session_id,student_id,status,booked_at")
        .in("session_id", sessionIds)
    : { data: [] as ReservationRow[] };

  const reservations = (reservationsResult.data ?? []) as ReservationRow[];
  const templateMap = new Map(templates.map((item) => [item.id, item]));

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
    (item) => item.status === "confirmed" && isBetween(item.created_at, previousStart, currentStart),
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

  const pendingCurrent = currentSales.reduce((sum, sale) => {
    const collectible = collectibleBySale.get(sale.id) ?? sale.total_minor;
    const paid = paymentBySale.get(sale.id) ?? 0;
    return sum + Math.max(collectible - paid, 0);
  }, 0);

  const activeStudents = students.filter(
    (item) => item.active && item.lifecycle_status === "active",
  ).length;
  const previousActiveProxy = Math.max(activeStudents - currentStudents.length + previousStudents.length, 0);

  const acquisitionsByStudent = new Map<string, AcquisitionRow[]>();
  for (const item of acquisitions) {
    if (item.refunded_at || item.status === "cancelled") continue;
    const list = acquisitionsByStudent.get(item.student_id) ?? [];
    list.push(item);
    acquisitionsByStudent.set(item.student_id, list);
  }

  const latestAcquisitionByStudent = new Map<string, AcquisitionRow>();
  for (const [studentId, list] of acquisitionsByStudent.entries()) {
    const sorted = [...list].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
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
      abandonedStudents.push({ id: student.id, name: student.full_name, days: elapsed, state: "Abandono" });
    } else if (elapsed >= 15) {
      inactiveStudents.push({ id: student.id, name: student.full_name, days: elapsed, state: "Inactiva" });
    } else {
      riskStudents.push({ id: student.id, name: student.full_name, days: elapsed, state: "En riesgo" });
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
    let reservationEvents = 0;

    for (const session of rows) {
      if (session.status === "cancelled") continue;
      capacity += session.capacity ?? 0;
      const sessionReservations = reservationsBySession.get(session.id) ?? [];
      for (const reservation of sessionReservations) {
        reservationEvents += 1;
        if (occupiedStatuses.has(reservation.status)) occupied += 1;
        if (reservation.status === "attended") attended += 1;
        if (reservation.status === "no_show") noShow += 1;
        if (userCancellationStatuses.has(reservation.status)) cancelled += 1;
      }
    }

    return {
      occupancy: safeRate(occupied, capacity),
      attendance: safeRate(attended, attended + noShow),
      cancellation: safeRate(cancelled, reservationEvents),
      noShow: safeRate(noShow, attended + noShow),
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
      cancelled: number;
      total: number;
      color: string;
    }
  >();

  for (const session of currentSessions) {
    if (session.status === "cancelled") continue;
    const template = templateMap.get(session.template_id);
    const key = session.template_id;
    const current =
      classAggregate.get(key) ?? {
        name: template?.name ?? "Clase",
        capacity: 0,
        occupied: 0,
        attended: 0,
        noShow: 0,
        cancelled: 0,
        total: 0,
        color: template?.color_hex ?? "#FF0A8A",
      };
    current.capacity += session.capacity ?? 0;
    for (const reservation of reservationsBySession.get(session.id) ?? []) {
      current.total += 1;
      if (occupiedStatuses.has(reservation.status)) current.occupied += 1;
      if (reservation.status === "attended") current.attended += 1;
      if (reservation.status === "no_show") current.noShow += 1;
      if (userCancellationStatuses.has(reservation.status)) current.cancelled += 1;
    }
    classAggregate.set(key, current);
  }

  const classRows = [...classAggregate.values()]
    .map((item) => ({
      ...item,
      occupancy: safeRate(item.occupied, item.capacity),
      attendance: safeRate(item.attended, item.attended + item.noShow),
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
        timeZone: studio.timezone ?? "America/Mexico_City",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(date),
    );
    const part = hour < 12 ? "Mañana" : hour < 17 ? "Tarde" : "Noche";
    const used = (reservationsBySession.get(session.id) ?? []).filter((item) =>
      occupiedStatuses.has(item.status),
    ).length;
    daypart[part][0] += used;
    daypart[part][1] += session.capacity ?? 0;

    const day = new Intl.DateTimeFormat("es-MX", {
      timeZone: studio.timezone ?? "America/Mexico_City",
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

  const expiredCurrent = acquisitions.filter(
    (item) =>
      !item.refunded_at &&
      item.status !== "cancelled" &&
      Boolean(item.expires_on && item.expires_on >= currentStartDate && item.expires_on <= todayDate),
  );
  const expiredPrevious = acquisitions.filter(
    (item) =>
      !item.refunded_at &&
      item.status !== "cancelled" &&
      Boolean(
        item.expires_on &&
          item.expires_on >= previousStartDate &&
          item.expires_on < currentStartDate,
      ),
  );

  function renewalStats(expiredRows: AcquisitionRow[]) {
    let renewed = 0;
    for (const expired of expiredRows) {
      const expiryTime = expired.expires_on
        ? new Date(expired.expires_on + "T23:59:59Z").getTime()
        : 0;
      const later = (acquisitionsByStudent.get(expired.student_id) ?? []).some(
        (candidate) =>
          candidate.id !== expired.id && new Date(candidate.created_at).getTime() > expiryTime,
      );
      if (later) renewed += 1;
    }
    return {
      expired: expiredRows.length,
      renewed,
      notRenewed: Math.max(expiredRows.length - renewed, 0),
      rate: safeRate(renewed, expiredRows.length),
    };
  }

  const renewal = renewalStats(expiredCurrent);
  const previousRenewal = renewalStats(expiredPrevious);
  const churn = renewal.expired > 0 ? 100 - renewal.rate : 0;
  const previousChurn = previousRenewal.expired > 0 ? 100 - previousRenewal.rate : 0;
  const weeklyFrequency =
    activeStudents > 0 ? currentClassMetrics.attended / activeStudents / Math.max(days / 7, 1) : 0;

  const productRevenue = new Map<string, number>();
  for (const line of saleLines) {
    if (line.refunded_at || !isBetween(line.created_at, currentStart, currentEnd)) continue;
    productRevenue.set(
      line.product_name,
      (productRevenue.get(line.product_name) ?? 0) + line.line_total_minor,
    );
  }
  const productRows = [...productRevenue.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);

  const recentSales = currentSales.slice(0, 6);

  const periodBuckets = Array.from({ length: Math.min(days, 30) }, (_, index) => {
    const bucketDate = new Date(currentStart.getTime() + index * DAY);
    const key = isoDateKey(bucketDate);
    const amount = currentPayments
      .filter((item) => item.created_at.slice(0, 10) === key)
      .reduce(
        (sum, item) => sum + (item.kind === "refund" ? -item.amount_minor : item.amount_minor),
        0,
      );
    return {
      key,
      label: new Intl.DateTimeFormat("es-MX", {
        day: "numeric",
        month: "short",
      }).format(bucketDate),
      amount,
    };
  });
  const maxDailyRevenue = Math.max(...periodBuckets.map((item) => item.amount), 1);

  const highestDemand = classRows[0];
  const lowestDemand = [...classRows].sort((a, b) => a.occupancy - b.occupancy)[0];
  const highestCancellation = [...classRows].sort(
    (a, b) => b.cancellation - a.cancellation,
  )[0];

  const [pageTitle, pageDescription] = titleFor(view);

  return (
    <main className="intel-page">
      <header className="intel-header">
        <div>
          <p className="intel-kicker">📊 INTELIGENCIA</p>
          <h1>{pageTitle}</h1>
          <p>{pageDescription}</p>
        </div>
        <div className="intel-periods" aria-label="Periodo">
          {[7, 30, 90].map((value) => (
            <Link
              key={value}
              href={periodHref(view, value)}
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
            href={viewHref(item.key, days)}
            className={view === item.key ? "is-active" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {view === "resumen" ? (
        <>
          <section className="intel-kpi-grid">
            <MetricCard
              label="Ingresos cobrados"
              value={money(currentRevenue, studio.currency)}
              delta={deltaText(currentRevenue, previousRevenue)}
              tone={currentRevenue >= previousRevenue ? "positive" : "danger"}
            />
            <MetricCard
              label="Alumnas activas"
              value={String(activeStudents)}
              delta={deltaText(activeStudents, previousActiveProxy)}
              tone="positive"
            />
            <MetricCard
              label="Conversión de prueba"
              value={pct(trialConversion)}
              delta={pointsDelta(trialConversion, previousTrialConversion)}
              tone={trialConversion >= previousTrialConversion ? "positive" : "warning"}
            />
            <MetricCard
              label="Ocupación"
              value={pct(currentClassMetrics.occupancy)}
              delta={pointsDelta(currentClassMetrics.occupancy, previousClassMetrics.occupancy)}
              tone={currentClassMetrics.occupancy >= 70 ? "positive" : "warning"}
            />
          </section>

          <div className="intel-two-column">
            <div className="intel-stack">
              <Section
                title="🚨 Requiere atención"
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
                        pct(highestCancellation.cancellation) +
                        "."
                      }
                      href={viewHref("clases", days)}
                    />
                  ) : null}
                  {pendingCurrent > 0 ? (
                    <Insight
                      tone="warning"
                      title="💳 Cobranza pendiente"
                      body={money(pendingCurrent, studio.currency) + " continúan sin cobrar en ventas del periodo."}
                      href={viewHref("dinero", days)}
                    />
                  ) : null}
                </div>
              </Section>

              <Section
                title="Ingresos cobrados por día"
                description="Cobros menos reembolsos registrados en el periodo."
              >
                <div className="intel-bars">
                  {periodBuckets.slice(-14).map((item) => (
                    <BarRow
                      key={item.key}
                      label={item.label}
                      value={Math.max(item.amount, 0)}
                      max={maxDailyRevenue}
                      display={money(item.amount, studio.currency)}
                    />
                  ))}
                </div>
              </Section>
            </div>

            <div className="intel-stack">
              <Section
                title="🎯 Conversión de prueba"
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
                  Registro → reserva todavía no tiene una fuente de leads previa a la clase de prueba.
                </div>
              </Section>

              <Section title="🪑 Clases" description="Señales rápidas de capacidad.">
                <div className="intel-compact-table">
                  <div className="intel-table-head">
                    <span>Clase</span>
                    <span>Ocup.</span>
                  </div>
                  {classRows.slice(0, 4).map((row) => (
                    <div className="intel-table-row" key={row.name}>
                      <span>{row.name}</span>
                      <strong>{pct(row.occupancy)}</strong>
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
              value={money(currentRevenue, studio.currency)}
              delta={deltaText(currentRevenue, previousRevenue)}
              tone={currentRevenue >= previousRevenue ? "positive" : "danger"}
            />
            <MetricCard
              label="Pendiente de cobro"
              value={money(pendingCurrent, studio.currency)}
              delta={pendingCurrent > 0 ? "Requiere seguimiento" : "Sin pendientes"}
              tone={pendingCurrent > 0 ? "warning" : "positive"}
            />
            <MetricCard
              label="Ticket promedio"
              value={money(ticketAverage, studio.currency)}
              delta={deltaText(ticketAverage, previousTicketAverage)}
              tone="neutral"
            />
            <MetricCard
              label="Reembolsos"
              value={money(currentRefunds, studio.currency)}
              delta={deltaText(currentRefunds, previousRefunds)}
              tone={currentRefunds > previousRefunds ? "danger" : "neutral"}
            />
          </section>

          <div className="intel-two-column">
            <div className="intel-stack">
              <Section title="💰 Ingresos cobrados" description="Cobros netos por día.">
                <div className="intel-bars">
                  {periodBuckets.slice(-14).map((item) => (
                    <BarRow
                      key={item.key}
                      label={item.label}
                      value={Math.max(item.amount, 0)}
                      max={maxDailyRevenue}
                      display={money(item.amount, studio.currency)}
                    />
                  ))}
                </div>
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
                        <strong>{money(sale.total_minor, sale.currency)}</strong>
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
                        display={money(item.amount, studio.currency)}
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
                        : "✓ Ventas del periodo sin saldo pendiente"
                    }
                    body={
                      pendingCurrent > 0
                        ? money(pendingCurrent, studio.currency) +
                          " no han sido cobrados todavía."
                        : "No detectamos saldo abierto en las ventas del periodo."
                    }
                    href="/admin/ventas"
                  />
                  <Insight
                    tone={currentRefunds > 0 ? "danger" : "info"}
                    title="↩ Reembolsos"
                    body={money(currentRefunds, studio.currency) + " registrados en el periodo."}
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
              delta={deltaText(activeStudents, previousActiveProxy)}
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

          <div className="intel-two-column">
            <div className="intel-stack">
              <Section title="👥 Estado de la base">
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
                title="🚨 Requieren seguimiento"
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
                  {!riskStudents.length &&
                  !inactiveStudents.length &&
                  !abandonedStudents.length ? (
                    <p className="intel-empty">No hay alumnas dentro de estas ventanas de riesgo.</p>
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
              value={pct(trialConversion)}
              delta={pointsDelta(trialConversion, previousTrialConversion)}
              tone={trialConversion >= previousTrialConversion ? "positive" : "warning"}
            />
          </section>

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

              <Section title="Fuente pendiente: leads">
                <div className="intel-source-note is-large">
                  Para medir <strong>registro → reserva</strong> necesitamos persistir el lead antes de
                  que exista una clase de prueba. Hoy Studio Flow comienza a tener trazabilidad cuando
                  la prueba ya fue creada.
                </div>
              </Section>
            </div>

            <div className="intel-stack">
              <Section title="🧩 Fugas de la prueba">
                <div className="intel-insight-list">
                  <Insight
                    tone="warning"
                    title="⚠️ No show"
                    body={trialNoShow + " clases de prueba terminaron en no show durante el periodo."}
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

      {view === "clases" ? (
        <>
          <section className="intel-kpi-grid">
            <MetricCard
              label="Ocupación"
              value={pct(currentClassMetrics.occupancy)}
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
              value={pct(currentClassMetrics.cancellation)}
              delta={pointsDelta(currentClassMetrics.cancellation, previousClassMetrics.cancellation)}
              tone={currentClassMetrics.cancellation > 15 ? "danger" : "warning"}
            />
            <MetricCard
              label="No show"
              value={pct(currentClassMetrics.noShow)}
              delta={pointsDelta(currentClassMetrics.noShow, previousClassMetrics.noShow)}
              tone={currentClassMetrics.noShow > 10 ? "danger" : "neutral"}
            />
          </section>

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
                      <strong>{pct(row.occupancy)}</strong>
                      <span>{pct(row.attendance)}</span>
                      <span>{pct(row.cancellation)}</span>
                    </div>
                  ))}
                </div>
              </Section>

              <Section title="🕒 Demanda por franja">
                <div className="intel-bars">
                  {Object.entries(daypart).map(([label, values]) => {
                    const rate = safeRate(values[0], values[1]);
                    return (
                      <BarRow
                        key={label}
                        label={label}
                        value={rate}
                        max={100}
                        display={pct(rate)}
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
                        display={pct(rate)}
                      />
                    );
                  })}
                </div>
              </Section>
            </div>

            <div className="intel-stack">
              <Section title="🚨 Decisiones sugeridas">
                <div className="intel-insight-list">
                  {highestDemand ? (
                    <Insight
                      tone="positive"
                      title="🔥 Mayor demanda"
                      body={
                        highestDemand.name +
                        " está en " +
                        pct(highestDemand.occupancy) +
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
                        pct(lowestDemand.occupancy) +
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
                        pct(highestCancellation.cancellation) +
                        " de cancelaciones."
                      }
                    />
                  ) : null}
                </div>
              </Section>

              <Section title="Qué revisar">
                <div className="intel-rule-list">
                  <div><span>&lt;40% por 4+ semanas</span><strong>Mover o promover</strong></div>
                  <div><span>&gt;15% cancelación</span><strong>Revisar horario</strong></div>
                  <div><span>&gt;90% ocupación</span><strong>Agregar capacidad</strong></div>
                </div>
              </Section>
            </div>
          </div>
        </>
      ) : null}

      {view === "retencion" ? (
        <>
          <section className="intel-kpi-grid">
            <MetricCard
              label="Renovación"
              value={pct(renewal.rate)}
              delta={pointsDelta(renewal.rate, previousRenewal.rate)}
              tone={renewal.rate >= previousRenewal.rate ? "positive" : "warning"}
            />
            <MetricCard
              label="Churn"
              value={pct(churn)}
              delta={pointsDelta(churn, previousChurn)}
              tone={churn > previousChurn ? "danger" : "positive"}
            />
            <MetricCard
              label="En riesgo"
              value={String(riskStudents.length)}
              delta="7–14 días desde vencimiento"
              tone={riskStudents.length ? "warning" : "positive"}
            />
            <MetricCard
              label="Frecuencia"
              value={weeklyFrequency.toFixed(1) + "/sem"}
              delta="Promedio por alumna activa"
              tone="neutral"
            />
          </section>

          <div className="intel-two-column">
            <div className="intel-stack">
              <Section
                title="📈 Renovación del periodo"
                description="Paquetes que vencieron dentro del periodo y registraron una compra posterior."
              >
                <div className="intel-bars">
                  <BarRow
                    label="Vencieron"
                    value={renewal.expired}
                    max={Math.max(renewal.expired, 1)}
                    display={String(renewal.expired)}
                    tone="info"
                  />
                  <BarRow
                    label="Renovaron"
                    value={renewal.renewed}
                    max={Math.max(renewal.expired, 1)}
                    display={String(renewal.renewed)}
                    tone="success"
                  />
                  <BarRow
                    label="No renovaron"
                    value={renewal.notRenewed}
                    max={Math.max(renewal.expired, 1)}
                    display={String(renewal.notRenewed)}
                    tone="danger"
                  />
                </div>
              </Section>

              <Section
                title="Frecuencia"
                description="Una frecuencia baja puede ser una señal previa a la no renovación."
              >
                <div className="intel-frequency-value">
                  <strong>{weeklyFrequency.toFixed(1)}</strong>
                  <span>asistencias por semana / alumna activa</span>
                </div>
              </Section>
            </div>

            <div className="intel-stack">
              <Section
                title="🧭 Definición de abandono"
                description="Primera versión con umbrales fijos; después podrán ser configurables por estudio."
              >
                <div className="intel-insight-list">
                  <Insight
                    tone="warning"
                    title="🟡 En riesgo"
                    body="7 días desde vencimiento sin una nueva compra."
                  />
                  <Insight
                    tone="info"
                    title="🟠 Inactiva"
                    body="15 días desde vencimiento sin renovación."
                  />
                  <Insight
                    tone="danger"
                    title="🔴 Abandono"
                    body="30 días desde vencimiento sin una nueva compra."
                  />
                </div>
              </Section>
            </div>
          </div>
        </>
      ) : null}

      {view === "finanzas" ? (
        <>
          <section className="intel-kpi-grid">
            <MetricCard
              label="Ingresos"
              value={money(currentRevenue, studio.currency)}
              delta="Dato disponible"
              tone="positive"
            />
            <EmptyMetric label="Gastos" />
            <EmptyMetric label="Utilidad" />
            <EmptyMetric label="Margen" />
          </section>

          <div className="intel-two-column">
            <div className="intel-stack">
              <Section title="💰 Ingresos" description="Cobros netos de reembolsos.">
                <div className="intel-bars">
                  {periodBuckets.slice(-14).map((item) => (
                    <BarRow
                      key={item.key}
                      label={item.label}
                      value={Math.max(item.amount, 0)}
                      max={maxDailyRevenue}
                      display={money(item.amount, studio.currency)}
                    />
                  ))}
                </div>
              </Section>

              <Section title="Fuente de ingresos">
                <div className="intel-bars">
                  {productRows.map((item) => (
                    <BarRow
                      key={item.name}
                      label={item.name}
                      value={item.amount}
                      max={productRows[0]?.amount ?? 1}
                      display={money(item.amount, studio.currency)}
                    />
                  ))}
                </div>
              </Section>
            </div>

            <div className="intel-stack">
              <Section
                title="⚙️ Fuente pendiente: gastos"
                description="No mostramos rentabilidad falsa con información incompleta."
              >
                <Insight
                  tone="warning"
                  title="⚠️ Gastos no instrumentados"
                  body="Studio Flow registra ventas y pagos, pero todavía no una fuente estructurada de gastos."
                />
              </Section>

              <Section title="Gastos a incorporar">
                <div className="intel-rule-list">
                  {[
                    "Renta",
                    "Profesores / nómina",
                    "Servicios",
                    "Publicidad",
                    "Mantenimiento",
                    "Software",
                    "Insumos",
                    "Otros",
                  ].map((item) => (
                    <div key={item}>
                      <span>{item}</span>
                      <strong>—</strong>
                    </div>
                  ))}
                </div>
              </Section>

              <Section title="Al registrar gastos podremos calcular">
                <ul className="intel-unlock-list">
                  <li>Utilidad neta</li>
                  <li>Margen de utilidad</li>
                  <li>Costo por clase</li>
                  <li>Rentabilidad por disciplina</li>
                  <li>Ingreso neto por hora de agenda</li>
                </ul>
              </Section>
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}
