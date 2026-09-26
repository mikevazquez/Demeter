import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import { createStudioExpense, deleteStudioExpense } from "./actions";

type ViewKey =
  | "resumen"
  | "dinero"
  | "alumnas"
  | "conversion"
  | "marketing"
  | "clases"
  | "retencion"
  | "finanzas";

type Tone = "neutral" | "positive" | "warning" | "danger" | "info";

type DecisionPriority = 1 | 2 | 3;

type IntelligenceDecision = {
  key: string;
  priority: DecisionPriority;
  tone: Tone;
  title: string;
  evidence: string;
  action: string;
  href: string;
};

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

type CollectionSaleRow = SaleRow & {
  payment_due_on: string | null;
};

type PaymentRow = {
  sale_id: string;
  kind: string;
  amount_minor: number;
  effective_on: string | null;
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

type DomainEventRow = {
  event_id: string;
  event_type: string;
  occurred_at: string;
  source_entity_id: string | null;
  payload: Record<string, unknown> | null;
};

type ConversationRow = {
  id: string;
  provider: string;
  provider_contact_id: string | null;
  contact_phone: string | null;
  student_id: string | null;
  channel: string;
  source: string | null;
  campaign: string | null;
  started_at: string;
  last_activity_at: string;
  activity_count: number;
};

type ExpenseRow = {
  id: string;
  category: string;
  description: string;
  vendor: string | null;
  amount_minor: number;
  currency: string;
  effective_on: string;
  notes: string | null;
  marketing_source: string | null;
  marketing_campaign: string | null;
  created_at: string;
};

const expenseCategoryLabels: Record<string, string> = {
  rent: "Renta",
  payroll: "Profesores / nómina",
  utilities: "Servicios",
  advertising: "Publicidad",
  maintenance: "Mantenimiento",
  software: "Software",
  supplies: "Insumos",
  fees: "Comisiones",
  taxes: "Impuestos",
  other: "Otros",
};

const cancellationReasonLabels: Record<string, string> = {
  schedule_conflict: "Horario / cambio de planes",
  health: "Salud",
  work_school: "Trabajo / escuela",
  transport: "Transporte / distancia",
  price: "Precio",
  lost_interest: "Ya no le interesa",
  booking_error: "Error de reserva",
  other: "Otro",
  prefer_not_say: "Prefiere no decir",
};

function eventPayloadText(event: DomainEventRow, key: string) {
  const value = event.payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function eventStudentId(event: DomainEventRow) {
  return eventPayloadText(event, "student_id");
}

function uniqueEventStudents(rows: DomainEventRow[]) {
  return new Set(rows.map(eventStudentId).filter((value): value is string => Boolean(value)));
}

const views: { key: ViewKey; label: string }[] = [
  { key: "resumen", label: "Resumen" },
  { key: "dinero", label: "Dinero" },
  { key: "alumnas", label: "Alumnas" },
  { key: "conversion", label: "Conversión" },
  { key: "marketing", label: "Marketing" },
  { key: "clases", label: "Clases" },
  { key: "retencion", label: "Retención" },
  { key: "finanzas", label: "Finanzas" },
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
]);
const commercialProductTypes = new Set(["package", "membership", "single_class"]);
const conversionProductTypes = new Set(["package", "membership"]);

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

function daysUntil(dateKey: string | null, now: Date) {
  if (!dateKey) return null;
  const value = new Date(dateKey + "T12:00:00Z");
  if (Number.isNaN(value.getTime())) return null;
  return Math.ceil((value.getTime() - now.getTime()) / DAY);
}

function isBetween(value: string, start: Date, end: Date) {
  const time = new Date(value).getTime();
  return time >= start.getTime() && time < end.getTime();
}

function paymentEffectiveDateTime(payment: PaymentRow) {
  return payment.effective_on ? payment.effective_on + "T12:00:00Z" : payment.created_at;
}

function paymentDateKey(payment: PaymentRow) {
  return payment.effective_on ?? payment.created_at.slice(0, 10);
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

function DecisionCard({ decision }: { decision: IntelligenceDecision }) {
  const priorityLabel =
    decision.priority === 1 ? "Ahora" : decision.priority === 2 ? "Esta semana" : "Optimizar";

  return (
    <Link
      href={decision.href}
      className={"intel-decision is-" + decision.tone}
    >
      <div className="intel-decision-topline">
        <span className="intel-decision-priority">{priorityLabel}</span>
        <span className="intel-chevron" aria-hidden="true">›</span>
      </div>
      <strong>{decision.title}</strong>
      <p>{decision.evidence}</p>
      <small>
        <b>Acción:</b> {decision.action}
      </small>
    </Link>
  );
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
    conversion: ["Conversión", "Dónde se rompe el embudo, qué se recupera y qué información falta capturar."],
    marketing: ["Marketing", "Qué origen y campaña generan contactos de calidad, alumnas e ingresos atribuibles."],
    clases: ["Clases", "Qué disciplinas y horarios están usando bien —o mal— la capacidad."],
    retencion: ["Retención", "Detectar señales antes del abandono y priorizar a quién intervenir."],
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
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.REPORTS_READ);
  const canWriteFinance = can(CAPABILITIES.SALES_WRITE);
  const now = new Date();
  const currentEnd = now;
  const currentStart = new Date(now.getTime() - days * DAY);
  const previousStart = new Date(currentStart.getTime() - days * DAY);
  const rangeStartIso = previousStart.toISOString();
  const behaviorStart = new Date(now.getTime() - 42 * DAY);
  const eventStart = new Date(
    Math.min(previousStart.getTime(), behaviorStart.getTime()),
  );
  const eventStartIso = eventStart.toISOString();
  const currentStartIso = currentStart.toISOString();
  const currentStartDate = isoDateKey(currentStart);
  const previousStartDate = isoDateKey(previousStart);
  const todayDate = isoDateKey(now);
  const upcomingEnd = new Date(now.getTime() + 14 * DAY);

  const [
    studentsResult,
    acquisitionsResult,
    salesResult,
    paymentsResult,
    linesResult,
    sessionsResult,
    upcomingSessionsResult,
    templatesResult,
    productTemplatesResult,
    onboardingResult,
    domainEventsResult,
    collectionSalesResult,
    conversationsResult,
    expensesResult,
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
      .select("sale_id,kind,amount_minor,effective_on,created_at")
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
      .from("class_sessions")
      .select("id,template_id,starts_at,capacity,status")
      .eq("studio_id", studio.id)
      .gte("starts_at", currentEnd.toISOString())
      .lt("starts_at", upcomingEnd.toISOString())
      .neq("status", "cancelled")
      .order("starts_at"),
    supabase
      .from("class_templates")
      .select("id,name,color_hex")
      .eq("studio_id", studio.id),
    supabase
      .from("product_templates")
      .select("id,product_type,name")
      .eq("studio_id", studio.id),
    supabase
      .from("reward_onboarding")
      .select(
        "student_id,documents_completed_at,profile_completed_at,first_reservation_at,first_attendance_at,app_installed_at,notifications_enabled_at,completed_at",
      )
      .eq("studio_id", studio.id),
    supabase
      .from("domain_events")
      .select("event_id,event_type,occurred_at,source_entity_id,payload")
      .eq("studio_id", studio.id)
      .in("event_type", [
        "booking.created",
        "booking.cancelled",
        "attendance.finalized",
      ])
      .gte("occurred_at", eventStartIso)
      .lt("occurred_at", currentEnd.toISOString())
      .order("occurred_at", { ascending: true }),
    supabase
      .from("sales")
      .select("id,student_id,folio,status,total_minor,currency,created_at,payment_due_on")
      .eq("studio_id", studio.id)
      .eq("status", "confirmed")
      .order("payment_due_on", { ascending: true, nullsFirst: false }),
    supabase
      .from("crm_conversations")
      .select(
        "id,provider,provider_contact_id,contact_phone,student_id,channel,source,campaign,started_at,last_activity_at,activity_count",
      )
      .eq("studio_id", studio.id)
      .gte("started_at", rangeStartIso)
      .lt("started_at", currentEnd.toISOString())
      .order("started_at", { ascending: true }),
    supabase
      .from("studio_expenses")
      .select("id,category,description,vendor,amount_minor,currency,effective_on,notes,marketing_source,marketing_campaign,created_at")
      .eq("studio_id", studio.id)
      .gte("effective_on", previousStartDate)
      .lte("effective_on", todayDate)
      .order("effective_on", { ascending: false }),
  ]);

  const students = (studentsResult.data ?? []) as StudentRow[];
  const acquisitions = (acquisitionsResult.data ?? []) as AcquisitionRow[];
  const sales = (salesResult.data ?? []) as SaleRow[];
  const payments = (paymentsResult.data ?? []) as PaymentRow[];
  const saleLines = (linesResult.data ?? []) as SaleLineRow[];
  const sessions = (sessionsResult.data ?? []) as SessionRow[];
  const upcomingSessions = (upcomingSessionsResult.data ?? []) as SessionRow[];
  const templates = (templatesResult.data ?? []) as ClassTemplateRow[];
  const productTemplates = (productTemplatesResult.data ?? []) as ProductTemplateRow[];
  const onboarding = (onboardingResult.data ?? []) as OnboardingRow[];
  const domainEvents = (domainEventsResult.data ?? []) as DomainEventRow[];
  const collectionSales = (collectionSalesResult.data ?? []) as CollectionSaleRow[];
  const conversations = (conversationsResult.data ?? []) as ConversationRow[];
  const expenses = (expensesResult.data ?? []) as ExpenseRow[];

  const collectionSaleIds = collectionSales.map((sale) => sale.id);
  const [collectionPaymentsResult, collectionLinesResult] = collectionSaleIds.length
    ? await Promise.all([
        supabase
          .from("payments")
          .select("sale_id,kind,amount_minor,effective_on,created_at")
          .eq("studio_id", studio.id)
          .in("sale_id", collectionSaleIds),
        supabase
          .from("sale_lines")
          .select("sale_id,product_template_id,product_name,line_total_minor,refunded_at,created_at")
          .eq("studio_id", studio.id)
          .in("sale_id", collectionSaleIds),
      ])
    : [
        { data: [] as PaymentRow[] },
        { data: [] as SaleLineRow[] },
      ];
  const collectionPayments = (collectionPaymentsResult.data ?? []) as PaymentRow[];
  const collectionLines = (collectionLinesResult.data ?? []) as SaleLineRow[];

  const sessionIds = sessions.map((session) => session.id);
  const reservationsResult = sessionIds.length
    ? await supabase
        .from("reservations")
        .select("id,session_id,student_id,status,booked_at")
        .in("session_id", sessionIds)
    : { data: [] as ReservationRow[] };

  const reservations = (reservationsResult.data ?? []) as ReservationRow[];
  const upcomingSessionIds = upcomingSessions.map((session) => session.id);
  const upcomingReservationsResult = upcomingSessionIds.length
    ? await supabase
        .from("reservations")
        .select("id,session_id,student_id,status,booked_at")
        .in("session_id", upcomingSessionIds)
        .eq("status", "reserved")
    : { data: [] as ReservationRow[] };
  const upcomingReservations = (upcomingReservationsResult.data ?? []) as ReservationRow[];
  const templateMap = new Map(templates.map((item) => [item.id, item]));
  const productTemplateMap = new Map(productTemplates.map((item) => [item.id, item]));
  const commercialAcquisitions = acquisitions.filter((item) => {
    const productType = productTemplateMap.get(item.product_template_id)?.product_type;
    return Boolean(productType && commercialProductTypes.has(productType));
  });

  const conversionAcquisitions = commercialAcquisitions.filter((item) => {
    const productType = productTemplateMap.get(item.product_template_id)?.product_type;
    return Boolean(productType && conversionProductTypes.has(productType));
  });

  const firstConversionAcquisitionByStudent = new Map<string, AcquisitionRow>();
  for (const acquisition of conversionAcquisitions) {
    if (acquisition.refunded_at || acquisition.status === "cancelled") continue;
    const previous = firstConversionAcquisitionByStudent.get(acquisition.student_id);
    if (
      !previous ||
      new Date(acquisition.created_at).getTime() < new Date(previous.created_at).getTime()
    ) {
      firstConversionAcquisitionByStudent.set(acquisition.student_id, acquisition);
    }
  }
  const newCommercialStudentsCurrent = [...firstConversionAcquisitionByStudent.values()].filter(
    (item) => isBetween(item.created_at, currentStart, currentEnd),
  );
  const newCommercialStudentsPrevious = [...firstConversionAcquisitionByStudent.values()].filter(
    (item) => isBetween(item.created_at, previousStart, currentStart),
  );

  const currentSales = sales.filter(
    (item) => item.status === "confirmed" && isBetween(item.created_at, currentStart, currentEnd),
  );
  const previousSales = sales.filter(
    (item) => item.status === "confirmed" && isBetween(item.created_at, previousStart, currentStart),
  );

  const currentPayments = payments.filter((item) =>
    isBetween(paymentEffectiveDateTime(item), currentStart, currentEnd),
  );
  const previousPayments = payments.filter((item) =>
    isBetween(paymentEffectiveDateTime(item), previousStart, currentStart),
  );

  function netPayments(rows: PaymentRow[]) {
    return rows.reduce(
      (sum, item) => sum + (item.kind === "refund" ? -item.amount_minor : item.amount_minor),
      0,
    );
  }

  const currentRevenue = netPayments(currentPayments);
  const previousRevenue = netPayments(previousPayments);

  const currentExpenses = expenses.filter(
    (item) => item.effective_on >= currentStartDate && item.effective_on <= todayDate,
  );
  const previousExpenses = expenses.filter(
    (item) => item.effective_on >= previousStartDate && item.effective_on < currentStartDate,
  );
  const currentExpenseTotal = currentExpenses.reduce(
    (sum, item) => sum + item.amount_minor,
    0,
  );
  const previousExpenseTotal = previousExpenses.reduce(
    (sum, item) => sum + item.amount_minor,
    0,
  );
  const currentOperatingResult = currentRevenue - currentExpenseTotal;
  const previousOperatingResult = previousRevenue - previousExpenseTotal;
  const currentOperatingMargin = safeRate(currentOperatingResult, currentRevenue);
  const previousOperatingMargin = safeRate(previousOperatingResult, previousRevenue);
  const expenseCategoryTotals = new Map<string, number>();
  for (const expense of currentExpenses) {
    expenseCategoryTotals.set(
      expense.category,
      (expenseCategoryTotals.get(expense.category) ?? 0) + expense.amount_minor,
    );
  }
  const expenseCategoryRows = [...expenseCategoryTotals.entries()]
    .map(([category, amount]) => ({
      category,
      label: expenseCategoryLabels[category] ?? category,
      amount,
    }))
    .sort((a, b) => b.amount - a.amount);
  const recentExpenses = currentExpenses.slice(0, 8);
  const currentRefunds = currentPayments
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

  const collectionPaymentBySale = new Map<string, number>();
  for (const payment of collectionPayments) {
    collectionPaymentBySale.set(
      payment.sale_id,
      (collectionPaymentBySale.get(payment.sale_id) ?? 0) +
        (payment.kind === "refund" ? -payment.amount_minor : payment.amount_minor),
    );
  }

  const collectionCollectibleBySale = new Map<string, number>();
  for (const line of collectionLines) {
    if (line.refunded_at) continue;
    collectionCollectibleBySale.set(
      line.sale_id,
      (collectionCollectibleBySale.get(line.sale_id) ?? 0) + line.line_total_minor,
    );
  }

  const collectionOpenRows = collectionSales
    .map((sale) => {
      const collectible = collectionCollectibleBySale.get(sale.id) ?? sale.total_minor;
      const paid = collectionPaymentBySale.get(sale.id) ?? 0;
      return {
        ...sale,
        balance: Math.max(collectible - paid, 0),
      };
    })
    .filter((sale) => sale.balance > 0);

  const collectionPending = collectionOpenRows.reduce((sum, sale) => sum + sale.balance, 0);
  const collectionOverdueRows = collectionOpenRows.filter(
    (sale) => Boolean(sale.payment_due_on && sale.payment_due_on < todayDate),
  );
  const collectionDueTodayRows = collectionOpenRows.filter(
    (sale) => sale.payment_due_on === todayDate,
  );
  const collectionOverdueAmount = collectionOverdueRows.reduce(
    (sum, sale) => sum + sale.balance,
    0,
  );
  const collectionDueTodayAmount = collectionDueTodayRows.reduce(
    (sum, sale) => sum + sale.balance,
    0,
  );

  function activeCommercialStudentCount(atDate: string) {
    const studentIds = new Set<string>();
    for (const item of commercialAcquisitions) {
      if (item.refunded_at || item.status === "cancelled") continue;
      const start = item.starts_on ?? item.created_at.slice(0, 10);
      const end = item.expires_on;
      if (start > atDate) continue;
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

  const upcomingReservedStudentIds = new Set(
    upcomingReservations
      .map((reservation) => reservation.student_id)
      .filter((value): value is string => Boolean(value)),
  );

  const activeAcquisitionByStudent = new Map<string, AcquisitionRow>();
  for (const [studentId, list] of acquisitionsByStudent.entries()) {
    const active = list
      .filter((item) => {
        const start = item.starts_on ?? item.created_at.slice(0, 10);
        if (start > todayDate) return false;
        return !item.expires_on || item.expires_on >= todayDate;
      })
      .sort((a, b) => {
        const aExpiry = a.expires_on ?? "9999-12-31";
        const bExpiry = b.expires_on ?? "9999-12-31";
        return aExpiry.localeCompare(bExpiry);
      });
    if (active[0]) activeAcquisitionByStudent.set(studentId, active[0]);
  }

  const retentionRecentStart = now.getTime() - 14 * DAY;
  const retentionBaselineStart = now.getTime() - 42 * DAY;
  const retentionBaselineEnd = retentionRecentStart;

  const retentionAttendedEvents = domainEvents.filter(
    (event) =>
      event.event_type === "attendance.finalized" &&
      eventPayloadText(event, "attendance_status") === "attended",
  );
  const retentionNoShowEvents = domainEvents.filter(
    (event) =>
      event.event_type === "attendance.finalized" &&
      eventPayloadText(event, "attendance_status") === "no_show",
  );
  const retentionCancellationEvents = domainEvents.filter(
    (event) =>
      event.event_type === "booking.cancelled" &&
      eventPayloadText(event, "to_status") !== "cancelled_by_studio",
  );

  function studentEventCount(
    rows: DomainEventRow[],
    studentId: string,
    startTime: number,
    endTime: number,
  ) {
    return rows.filter((event) => {
      if (eventStudentId(event) !== studentId) return false;
      const eventTime = new Date(event.occurred_at).getTime();
      return eventTime >= startTime && eventTime < endTime;
    }).length;
  }

  type RetentionRiskRow = {
    id: string;
    name: string;
    days: number;
    score: number;
    state: string;
    detail: string;
    recentWeekly: number;
    baselineWeekly: number;
  };

  const preventiveRiskStudents: RetentionRiskRow[] = [];
  const riskStudents: RetentionRiskRow[] = [];
  const inactiveStudents: RetentionRiskRow[] = [];
  const abandonedStudents: RetentionRiskRow[] = [];

  for (const student of students) {
    const activeAcquisition = activeAcquisitionByStudent.get(student.id);
    const untilExpiry = daysUntil(activeAcquisition?.expires_on ?? null, now);

    if (activeAcquisition) {
      const recentAttendance = studentEventCount(
        retentionAttendedEvents,
        student.id,
        retentionRecentStart,
        now.getTime(),
      );
      const baselineAttendance = studentEventCount(
        retentionAttendedEvents,
        student.id,
        retentionBaselineStart,
        retentionBaselineEnd,
      );
      const recentWeekly = recentAttendance / 2;
      const baselineWeekly = baselineAttendance / 4;
      const frequencyDrop =
        baselineAttendance >= 4 &&
        baselineWeekly > 0 &&
        recentWeekly <= baselineWeekly * 0.5;
      const recentFriction =
        studentEventCount(
          retentionNoShowEvents,
          student.id,
          retentionRecentStart,
          now.getTime(),
        ) +
        studentEventCount(
          retentionCancellationEvents,
          student.id,
          retentionRecentStart,
          now.getTime(),
        );
      const acquisitionAgeDays = Math.floor(
        (now.getTime() - new Date(activeAcquisition.created_at).getTime()) / DAY,
      );
      const isNewAcquisition = acquisitionAgeDays < 7;
      const signals: string[] = [];
      let score = 0;

      if (untilExpiry !== null && untilExpiry >= 0 && untilExpiry <= 7) {
        score += 2;
        signals.push(
          untilExpiry === 0
            ? "vence hoy"
            : "vence en " + untilExpiry + (untilExpiry === 1 ? " día" : " días"),
        );
      }

      if (!upcomingReservedStudentIds.has(student.id)) {
        score += 1;
        signals.push("sin próxima reserva");
      }

      if (!isNewAcquisition && recentAttendance === 0) {
        score += 2;
        signals.push("14 días sin asistir");
      } else if (frequencyDrop) {
        const drop = Math.max(
          0,
          Math.round((1 - recentWeekly / Math.max(baselineWeekly, 0.01)) * 100),
        );
        score += 2;
        signals.push("frecuencia cayó " + drop + "%");
      }

      if (recentFriction >= 2) {
        score += 1;
        signals.push(recentFriction + " cancelaciones/no show recientes");
      }

      const meaningfulBehaviorSignal =
        recentAttendance === 0 || frequencyDrop || recentFriction >= 2;
      const shouldFlag =
        score >= 3 &&
        (meaningfulBehaviorSignal ||
          (untilExpiry !== null && untilExpiry >= 0 && untilExpiry <= 7));

      if (shouldFlag) {
        preventiveRiskStudents.push({
          id: student.id,
          name: student.full_name,
          days: untilExpiry ?? 999,
          score,
          state: score >= 5 ? "Alta prioridad" : "Vigilar",
          detail: signals.join(" · "),
          recentWeekly,
          baselineWeekly,
        });
      }
    }

    const latest = latestAcquisitionByStudent.get(student.id);
    const elapsed = daysSince(latest?.expires_on ?? null, now);
    if (elapsed === null || elapsed < 7) continue;
    const recoveryRow = {
      id: student.id,
      name: student.full_name,
      days: elapsed,
      score: elapsed >= 30 ? 5 : elapsed >= 15 ? 4 : 3,
      recentWeekly: 0,
      baselineWeekly: 0,
    };
    if (elapsed >= 30) {
      abandonedStudents.push({
        ...recoveryRow,
        state: "Abandono",
        detail: elapsed + " días desde vencimiento",
      });
    } else if (elapsed >= 15) {
      inactiveStudents.push({
        ...recoveryRow,
        state: "Inactiva",
        detail: elapsed + " días desde vencimiento",
      });
    } else {
      riskStudents.push({
        ...recoveryRow,
        state: "Vencida reciente",
        detail: elapsed + " días desde vencimiento",
      });
    }
  }

  preventiveRiskStudents.sort(
    (a, b) => b.score - a.score || a.days - b.days || a.name.localeCompare(b.name),
  );

  const urgentRetentionStudents = preventiveRiskStudents.filter(
    (item) => item.score >= 5 || item.days <= 2,
  );
  const watchRetentionStudents = preventiveRiskStudents.filter(
    (item) => !urgentRetentionStudents.some((urgent) => urgent.id === item.id),
  );

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
        if (!decisionReservationStatuses.has(reservation.status)) continue;
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
      sessionCount: number;
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
        sessionCount: 0,
        color: template?.color_hex ?? "#FF0A8A",
      };
    current.capacity += session.capacity ?? 0;
    current.sessionCount += 1;
    for (const reservation of reservationsBySession.get(session.id) ?? []) {
      if (!decisionReservationStatuses.has(reservation.status)) continue;
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
      noShowRate: safeRate(item.noShow, item.attended + item.noShow),
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

  const currentConversations = conversations.filter((conversation) =>
    isBetween(conversation.started_at, currentStart, currentEnd),
  );
  const previousConversations = conversations.filter((conversation) =>
    isBetween(conversation.started_at, previousStart, currentStart),
  );

  function conversationIdentity(row: ConversationRow) {
    if (row.provider_contact_id) return row.provider + ":contact:" + row.provider_contact_id;
    if (row.contact_phone) return row.provider + ":phone:" + row.contact_phone;
    return row.provider + ":conversation:" + row.id;
  }

  function conversationCohortStats(rows: ConversationRow[]) {
    const contacts = new Map<
      string,
      {
        startedAt: string;
        studentId: string | null;
        conversations: number;
      }
    >();

    for (const row of rows) {
      const key = conversationIdentity(row);
      const current = contacts.get(key);
      if (!current) {
        contacts.set(key, {
          startedAt: row.started_at,
          studentId: row.student_id,
          conversations: 1,
        });
        continue;
      }

      current.conversations += 1;
      if (new Date(row.started_at).getTime() < new Date(current.startedAt).getTime()) {
        current.startedAt = row.started_at;
      }
      current.studentId = current.studentId ?? row.student_id;
    }

    const booked = new Set<string>();
    const attended = new Set<string>();
    const converted = new Set<string>();
    let linked = 0;

    for (const [key, contact] of contacts.entries()) {
      if (!contact.studentId) continue;
      linked += 1;
      const startTime = new Date(contact.startedAt).getTime();
      const afterConversation = (event: DomainEventRow) =>
        eventStudentId(event) === contact.studentId &&
        new Date(event.occurred_at).getTime() >= startTime;

      if (allBookingEvents.some(afterConversation)) booked.add(key);
      if (allAttendedEvents.some(afterConversation)) attended.add(key);

      const conversion = firstConversionAcquisitionByStudent.get(contact.studentId);
      if (conversion && new Date(conversion.created_at).getTime() >= startTime) {
        converted.add(key);
      }
    }

    return {
      conversations: rows.length,
      contacts: contacts.size,
      linked,
      booked: booked.size,
      attended: attended.size,
      converted: converted.size,
      conversationToBookingRate: safeRate(booked.size, contacts.size),
      bookingToAttendanceRate: safeRate(attended.size, booked.size),
      attendanceToConversionRate: safeRate(converted.size, attended.size),
      conversationToConversionRate: safeRate(converted.size, contacts.size),
    };
  }

  const currentDomainEvents = domainEvents.filter((event) =>
    isBetween(event.occurred_at, currentStart, currentEnd),
  );
  const previousDomainEvents = domainEvents.filter((event) =>
    isBetween(event.occurred_at, previousStart, currentStart),
  );

  function eventsOfType(rows: DomainEventRow[], type: string) {
    return rows.filter((event) => event.event_type === type);
  }

  const currentBookingEvents = eventsOfType(currentDomainEvents, "booking.created");
  const currentCancellationEventsAll = eventsOfType(currentDomainEvents, "booking.cancelled");
  const currentCancellationEvents = currentCancellationEventsAll.filter(
    (event) => eventPayloadText(event, "to_status") !== "cancelled_by_studio",
  );
  const currentStudioCancellationEvents = currentCancellationEventsAll.filter(
    (event) => eventPayloadText(event, "to_status") === "cancelled_by_studio",
  );
  const currentAttendanceEvents = eventsOfType(currentDomainEvents, "attendance.finalized");
  const previousAttendanceEvents = eventsOfType(previousDomainEvents, "attendance.finalized");

  const currentAttendedEvents = currentAttendanceEvents.filter(
    (event) => eventPayloadText(event, "attendance_status") === "attended",
  );
  const previousAttendedEvents = previousAttendanceEvents.filter(
    (event) => eventPayloadText(event, "attendance_status") === "attended",
  );
  const currentNoShowEvents = currentAttendanceEvents.filter(
    (event) => eventPayloadText(event, "attendance_status") === "no_show",
  );
  const previousNoShowEvents = previousAttendanceEvents.filter(
    (event) => eventPayloadText(event, "attendance_status") === "no_show",
  );

  const currentBookingStudents = uniqueEventStudents(currentBookingEvents);
  const currentCancelledStudents = uniqueEventStudents(currentCancellationEvents);
  const currentNoShowStudents = uniqueEventStudents(currentNoShowEvents);

  const showRate = safeRate(
    currentAttendedEvents.length,
    currentAttendedEvents.length + currentNoShowEvents.length,
  );
  const previousShowRate = safeRate(
    previousAttendedEvents.length,
    previousAttendedEvents.length + previousNoShowEvents.length,
  );

  function recoveryStats(
    sourceEvents: DomainEventRow[],
    availableBookingEvents: DomainEventRow[],
  ) {
    const eligible = uniqueEventStudents(sourceEvents);
    const recovered = new Set<string>();

    for (const source of sourceEvents) {
      const studentId = eventStudentId(source);
      if (!studentId) continue;
      const sourceTime = new Date(source.occurred_at).getTime();
      const rebooked = availableBookingEvents.some(
        (booking) =>
          eventStudentId(booking) === studentId &&
          new Date(booking.occurred_at).getTime() > sourceTime,
      );
      if (rebooked) recovered.add(studentId);
    }

    return {
      eligible: eligible.size,
      recovered: recovered.size,
      rate: safeRate(recovered.size, eligible.size),
    };
  }

  const allBookingEvents = eventsOfType(domainEvents, "booking.created");
  const allCancellationEvents = eventsOfType(domainEvents, "booking.cancelled").filter(
    (event) => eventPayloadText(event, "to_status") !== "cancelled_by_studio",
  );
  const allAttendanceEvents = eventsOfType(domainEvents, "attendance.finalized");
  const allAttendedEvents = allAttendanceEvents.filter(
    (event) => eventPayloadText(event, "attendance_status") === "attended",
  );
  const allNoShowEvents = allAttendanceEvents.filter(
    (event) => eventPayloadText(event, "attendance_status") === "no_show",
  );

  function marketingAttributionKey(source: string | null, campaign: string | null) {
    const normalizedCampaign = campaign?.trim().toLowerCase();
    if (normalizedCampaign) return "campaign:" + normalizedCampaign;
    const normalizedSource = source?.trim().toLowerCase();
    if (normalizedSource) return "source:" + normalizedSource;
    return "unattributed";
  }

  const confirmedSalesByStudent = new Map<string, SaleRow[]>();
  for (const sale of sales) {
    if (sale.status !== "confirmed") continue;
    const list = confirmedSalesByStudent.get(sale.student_id) ?? [];
    list.push(sale);
    confirmedSalesByStudent.set(sale.student_id, list);
  }

  const paymentsBySale = new Map<string, PaymentRow[]>();
  for (const payment of payments) {
    const list = paymentsBySale.get(payment.sale_id) ?? [];
    list.push(payment);
    paymentsBySale.set(payment.sale_id, list);
  }

  function collectedRevenueAfter(studentId: string, startedAt: string) {
    const startTime = new Date(startedAt).getTime();
    let total = 0;

    for (const sale of confirmedSalesByStudent.get(studentId) ?? []) {
      if (new Date(sale.created_at).getTime() < startTime) continue;
      for (const payment of paymentsBySale.get(sale.id) ?? []) {
        if (new Date(paymentEffectiveDateTime(payment)).getTime() < startTime) continue;
        total += payment.kind === "refund" ? -payment.amount_minor : payment.amount_minor;
      }
    }

    return total;
  }

  type MarketingTouch = {
    key: string;
    startedAt: string;
    studentId: string | null;
    source: string | null;
    campaign: string | null;
  };

  function firstMarketingTouches(rows: ConversationRow[]) {
    const touches = new Map<string, MarketingTouch>();

    for (const row of rows) {
      const identity = row.student_id
        ? "student:" + row.student_id
        : conversationIdentity(row);
      const existing = touches.get(identity);

      if (!existing) {
        touches.set(identity, {
          key: identity,
          startedAt: row.started_at,
          studentId: row.student_id,
          source: row.source,
          campaign: row.campaign,
        });
        continue;
      }

      if (new Date(row.started_at).getTime() < new Date(existing.startedAt).getTime()) {
        existing.startedAt = row.started_at;
      }
      existing.studentId = existing.studentId ?? row.student_id;
      existing.source = existing.source ?? row.source;
      existing.campaign = existing.campaign ?? row.campaign;
    }

    return [...touches.values()].sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
    );
  }

  const currentMarketingTouches = firstMarketingTouches(currentConversations);
  const previousMarketingTouches = firstMarketingTouches(previousConversations);

  function marketingRows(touches: MarketingTouch[], expenseRows: ExpenseRow[]) {
    const rows = new Map<
      string,
      {
        key: string;
        label: string;
        source: string | null;
        campaign: string | null;
        contacts: number;
        linked: number;
        booked: number;
        attended: number;
        converted: number;
        revenue: number;
        spend: number;
      }
    >();

    for (const touch of touches) {
      const attributionKey = marketingAttributionKey(touch.source, touch.campaign);
      const row =
        rows.get(attributionKey) ?? {
          key: attributionKey,
          label: touch.campaign ?? touch.source ?? "Sin atribución",
          source: touch.source,
          campaign: touch.campaign,
          contacts: 0,
          linked: 0,
          booked: 0,
          attended: 0,
          converted: 0,
          revenue: 0,
          spend: 0,
        };

      row.contacts += 1;

      if (touch.studentId) {
        row.linked += 1;
        const startTime = new Date(touch.startedAt).getTime();
        const afterTouch = (event: DomainEventRow) =>
          eventStudentId(event) === touch.studentId &&
          new Date(event.occurred_at).getTime() >= startTime;

        if (allBookingEvents.some(afterTouch)) row.booked += 1;
        if (allAttendedEvents.some(afterTouch)) row.attended += 1;

        const conversion = firstConversionAcquisitionByStudent.get(touch.studentId);
        if (conversion && new Date(conversion.created_at).getTime() >= startTime) {
          row.converted += 1;
          row.revenue += collectedRevenueAfter(touch.studentId, touch.startedAt);
        }
      }

      rows.set(attributionKey, row);
    }

    for (const expense of expenseRows) {
      if (expense.category !== "advertising") continue;
      const attributionKey = marketingAttributionKey(
        expense.marketing_source,
        expense.marketing_campaign,
      );
      const row =
        rows.get(attributionKey) ?? {
          key: attributionKey,
          label:
            expense.marketing_campaign ??
            expense.marketing_source ??
            "Publicidad sin atribución",
          source: expense.marketing_source,
          campaign: expense.marketing_campaign,
          contacts: 0,
          linked: 0,
          booked: 0,
          attended: 0,
          converted: 0,
          revenue: 0,
          spend: 0,
        };
      row.spend += expense.amount_minor;
      rows.set(attributionKey, row);
    }

    return [...rows.values()]
      .map((row) => ({
        ...row,
        bookingRate: safeRate(row.booked, row.contacts),
        attendanceRate: safeRate(row.attended, row.booked),
        conversionRate: safeRate(row.converted, row.contacts),
        costPerContact: row.contacts > 0 ? row.spend / row.contacts : null,
        costPerStudent: row.converted > 0 ? row.spend / row.converted : null,
        roas: row.spend > 0 ? row.revenue / row.spend : null,
      }))
      .sort((a, b) => b.contacts - a.contacts || b.revenue - a.revenue);
  }

  const currentMarketingRows = marketingRows(currentMarketingTouches, currentExpenses);
  const previousMarketingRows = marketingRows(previousMarketingTouches, previousExpenses);
  const currentMarketingSpend = currentMarketingRows.reduce((sum, row) => sum + row.spend, 0);
  const previousMarketingSpend = previousMarketingRows.reduce((sum, row) => sum + row.spend, 0);
  const currentMarketingRevenue = currentMarketingRows.reduce((sum, row) => sum + row.revenue, 0);
  const currentMarketingBooked = currentMarketingRows.reduce((sum, row) => sum + row.booked, 0);
  const currentMarketingAttended = currentMarketingRows.reduce(
    (sum, row) => sum + row.attended,
    0,
  );
  const currentMarketingConverted = currentMarketingRows.reduce(
    (sum, row) => sum + row.converted,
    0,
  );
  const currentMarketingContacts = currentMarketingRows.reduce((sum, row) => sum + row.contacts, 0);
  const previousMarketingContacts = previousMarketingRows.reduce((sum, row) => sum + row.contacts, 0);
  const currentMarketingBookingRate = safeRate(
    currentMarketingBooked,
    currentMarketingContacts,
  );
  const currentMarketingAttendanceRate = safeRate(
    currentMarketingAttended,
    currentMarketingBooked,
  );
  const currentMarketingConversionRate = safeRate(
    currentMarketingConverted,
    currentMarketingContacts,
  );
  const currentMarketingRoas =
    currentMarketingSpend > 0 ? currentMarketingRevenue / currentMarketingSpend : null;
  const unattributedMarketingContacts =
    currentMarketingRows.find((row) => row.key === "unattributed")?.contacts ?? 0;
  const unattributedMarketingSpend =
    currentMarketingRows.find((row) => row.key === "unattributed")?.spend ?? 0;

  const currentConversationCohort = conversationCohortStats(currentConversations);
  const previousConversationCohort = conversationCohortStats(previousConversations);

  const conversationChannelCounts = new Map<string, number>();
  for (const conversation of currentConversations) {
    const label = conversation.channel || "unknown";
    conversationChannelCounts.set(label, (conversationChannelCounts.get(label) ?? 0) + 1);
  }
  const conversationChannelRows = [...conversationChannelCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  const conversationSourceCounts = new Map<string, number>();
  for (const conversation of currentConversations) {
    const label = conversation.campaign ?? conversation.source ?? "Sin atribución";
    conversationSourceCounts.set(label, (conversationSourceCounts.get(label) ?? 0) + 1);
  }
  const conversationSourceRows = [...conversationSourceCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const currentTrialCohortRows = students.filter(
    (student) =>
      isBetween(student.created_at, currentStart, currentEnd) &&
      (student.student_type === "trial" || Boolean(student.trial_status)),
  );
  const previousTrialCohortRows = students.filter(
    (student) =>
      isBetween(student.created_at, previousStart, currentStart) &&
      (student.student_type === "trial" || Boolean(student.trial_status)),
  );

  function acquisitionCohortStats(rows: StudentRow[]) {
    const booked = new Set<string>();
    const cancelled = new Set<string>();
    const noShow = new Set<string>();
    const attended = new Set<string>();
    const converted = new Set<string>();

    for (const student of rows) {
      const createdAt = new Date(student.created_at).getTime();
      const eventAfterCreation = (event: DomainEventRow) =>
        eventStudentId(event) === student.id &&
        new Date(event.occurred_at).getTime() >= createdAt;

      if (allBookingEvents.some(eventAfterCreation)) booked.add(student.id);
      if (allCancellationEvents.some(eventAfterCreation)) cancelled.add(student.id);
      if (allNoShowEvents.some(eventAfterCreation)) noShow.add(student.id);
      if (allAttendedEvents.some(eventAfterCreation)) attended.add(student.id);

      const conversion = firstConversionAcquisitionByStudent.get(student.id);
      if (
        conversion &&
        new Date(conversion.created_at).getTime() >= createdAt
      ) {
        converted.add(student.id);
      }
    }

    return {
      total: rows.length,
      booked: booked.size,
      cancelled: cancelled.size,
      noShow: noShow.size,
      attended: attended.size,
      converted: converted.size,
      bookingRate: safeRate(booked.size, rows.length),
      attendanceFromBookingRate: safeRate(attended.size, booked.size),
      conversionFromAttendanceRate: safeRate(converted.size, attended.size),
      conversionRate: safeRate(converted.size, rows.length),
    };
  }

  const currentAcquisitionCohort = acquisitionCohortStats(currentTrialCohortRows);
  const previousAcquisitionCohort = acquisitionCohortStats(previousTrialCohortRows);
  const cancellationRecovery = recoveryStats(currentCancellationEvents, allBookingEvents);
  const noShowRecovery = recoveryStats(currentNoShowEvents, allBookingEvents);

  const cancellationReasonCounts = new Map<string, number>();
  for (const event of currentCancellationEvents) {
    const rawReason = eventPayloadText(event, "cancellation_reason");
    const label = !rawReason
      ? "Sin motivo registrado"
      : rawReason.startsWith("asistian:")
        ? "Sin motivo informado · Asistian"
        : cancellationReasonLabels[rawReason] ?? "Otro / histórico";
    cancellationReasonCounts.set(label, (cancellationReasonCounts.get(label) ?? 0) + 1);
  }
  const cancellationReasonRows = [...cancellationReasonCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
  const topCancellationReason = cancellationReasonRows[0] ?? null;
  const missingCancellationReasonCount =
    cancellationReasonCounts.get("Sin motivo registrado") ?? 0;

  const expiredCurrent = commercialAcquisitions.filter(
    (item) =>
      !item.refunded_at &&
      item.status !== "cancelled" &&
      Boolean(item.expires_on && item.expires_on >= currentStartDate && item.expires_on <= todayDate),
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

  function renewalStats(expiredRows: AcquisitionRow[]) {
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

    let immediate = 0;
    let within7 = 0;
    let within30 = 0;
    let reactivated = 0;
    let churnConfirmed = 0;
    let pendingMaturity = 0;

    for (const expired of expiryByStudent.values()) {
      if (!expired.expires_on) continue;
      const later = (acquisitionsByStudent.get(expired.student_id) ?? [])
        .filter((candidate) => {
          if (candidate.id === expired.id) return false;
          if (new Date(candidate.created_at).getTime() <= new Date(expired.created_at).getTime()) {
            return false;
          }
          return Boolean(candidate.expires_on && candidate.expires_on > expired.expires_on!);
        })
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        )[0];

      if (later) {
        const expiryTime = new Date(expired.expires_on + "T12:00:00Z").getTime();
        const renewalTime = new Date(later.created_at).getTime();
        const gapDays = Math.floor((renewalTime - expiryTime) / DAY);

        if (gapDays <= 0) immediate += 1;
        else if (gapDays <= 7) within7 += 1;
        else if (gapDays <= 30) within30 += 1;
        else reactivated += 1;
        continue;
      }

      const age = daysSince(expired.expires_on, now) ?? 0;
      if (age >= 30) churnConfirmed += 1;
      else pendingMaturity += 1;
    }

    const expired = expiryByStudent.size;
    const renewedWithin30 = immediate + within7 + within30;
    const matured = renewedWithin30 + reactivated + churnConfirmed;

    return {
      expired,
      immediate,
      within7,
      within30,
      renewedWithin30,
      reactivated,
      churnConfirmed,
      pendingMaturity,
      matured,
      rate: safeRate(renewedWithin30, matured),
    };
  }

  const renewal = renewalStats(expiredCurrent);
  const previousRenewal = renewalStats(expiredPrevious);
  const weeklyFrequency =
    activeStudents > 0 ? currentClassMetrics.attended / activeStudents / Math.max(days / 7, 1) : 0;

  const currentSaleIds = new Set(currentSales.map((sale) => sale.id));
  const productRevenue = new Map<string, number>();
  for (const line of saleLines) {
    if (
      line.refunded_at ||
      !currentSaleIds.has(line.sale_id) ||
      !isBetween(line.created_at, currentStart, currentEnd)
    ) continue;
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
      .filter((item) => paymentDateKey(item) === key)
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

  const actionableClassRows = classRows.filter((row) => row.sessionCount >= 3);
  const highestDemand = [...actionableClassRows].sort(
    (a, b) => b.occupancy - a.occupancy,
  )[0];
  const lowestDemand = [...actionableClassRows].sort(
    (a, b) => a.occupancy - b.occupancy,
  )[0];
  const highestCancellation = [...actionableClassRows]
    .filter((row) => row.total >= 5)
    .sort((a, b) => b.cancellation - a.cancellation)[0];
  const highestNoShow = [...actionableClassRows]
    .filter((row) => row.attended + row.noShow >= 5)
    .sort((a, b) => b.noShowRate - a.noShowRate)[0];

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

  const decisions: IntelligenceDecision[] = [];
  const attendanceDecisionSample =
    currentAttendedEvents.length + currentNoShowEvents.length;
  const showRateDrop = previousShowRate - showRate;
  const conversationBookingDrop =
    previousConversationCohort.conversationToBookingRate -
    currentConversationCohort.conversationToBookingRate;

  if (collectionOverdueAmount > 0) {
    decisions.push({
      key: "collections-overdue",
      priority: 1,
      tone: "danger",
      title:
        "Cobrar " +
        money(collectionOverdueAmount, studio.currency) +
        " vencidos",
      evidence:
        collectionOverdueRows.length +
        (collectionOverdueRows.length === 1
          ? " saldo ya pasó su promesa de pago."
          : " saldos ya pasaron su promesa de pago."),
      action: "Abrir cobranza y contactar primero los saldos vencidos.",
      href: viewHref("dinero", days),
    });
  }

  if (collectionOverdueAmount === 0 && collectionDueTodayAmount > 0) {
    decisions.push({
      key: "collections-due-today",
      priority: 1,
      tone: "warning",
      title:
        "Cobrar " +
        money(collectionDueTodayAmount, studio.currency) +
        " hoy",
      evidence:
        collectionDueTodayRows.length +
        (collectionDueTodayRows.length === 1
          ? " promesa de pago vence hoy."
          : " promesas de pago vencen hoy."),
      action: "Confirmar el pago hoy y registrar el ingreso con su fecha efectiva real.",
      href: viewHref("dinero", days),
    });
  }

  if (urgentRetentionStudents.length > 0) {
    decisions.push({
      key: "retention-preventive-urgent",
      priority: 1,
      tone: "danger",
      title:
        "Intervenir hoy a " +
        urgentRetentionStudents.length +
        (urgentRetentionStudents.length === 1 ? " alumna" : " alumnas"),
      evidence:
        "Tienen múltiples señales de desconexión y/o están a ≤2 días de vencer.",
      action: "Abrir Retención y recuperar una próxima reserva antes de que se venza el paquete.",
      href: viewHref("retencion", days),
    });
  } else if (watchRetentionStudents.length > 0) {
    decisions.push({
      key: "retention-preventive-watch",
      priority: 2,
      tone: "warning",
      title:
        "Vigilar " +
        watchRetentionStudents.length +
        (watchRetentionStudents.length === 1 ? " alumna" : " alumnas"),
      evidence:
        "Acumulan señales tempranas, pero todavía no alcanzan prioridad de intervención inmediata.",
      action: "Revisar evolución de frecuencia, próxima reserva y fricción antes de contactar.",
      href: viewHref("retencion", days),
    });
  }

  if (preventiveRiskStudents.length === 0 && riskStudents.length > 0) {
    decisions.push({
      key: "retention-recovery",
      priority: 2,
      tone: "warning",
      title:
        "Recuperar " +
        riskStudents.length +
        (riskStudents.length === 1 ? " paquete vencido" : " paquetes vencidos"),
      evidence:
        "Llevan entre 7 y 14 días desde vencimiento sin una nueva compra.",
      action: "Contactar primero a las alumnas con vencimiento más reciente y medir renovación posterior.",
      href: viewHref("retencion", days),
    });
  }

  if (
    currentConversationCohort.contacts >= 3 &&
    previousConversationCohort.contacts >= 3 &&
    conversationBookingDrop >= 5
  ) {
    decisions.push({
      key: "conversion-conversation-booking",
      priority: conversationBookingDrop >= 10 ? 1 : 2,
      tone: "danger",
      title: "Recuperar conversación → reserva",
      evidence:
        "La tasa cayó " +
        conversationBookingDrop.toFixed(1) +
        " pp: " +
        pct(previousConversationCohort.conversationToBookingRate) +
        " → " +
        pct(currentConversationCohort.conversationToBookingRate) +
        ".",
      action: "Comparar origen/campaña y revisar seguimiento, horarios ofrecidos y objeciones.",
      href: viewHref("conversion", days),
    });
  }

  const paidCampaignWithoutConversion = [...currentMarketingRows]
    .filter((row) => row.spend > 0 && row.contacts >= 5 && row.converted === 0)
    .sort((a, b) => b.spend - a.spend)[0];
  const efficientCampaign = [...currentMarketingRows]
    .filter(
      (row) =>
        row.spend > 0 &&
        row.contacts >= 5 &&
        row.converted >= 2 &&
        row.roas !== null &&
        row.roas >= 1.5,
    )
    .sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))[0];

  if (unattributedMarketingSpend > 0) {
    decisions.push({
      key: "marketing-spend-unattributed",
      priority: 2,
      tone: "warning",
      title: "Asignar gasto publicitario a campaña",
      evidence:
        money(unattributedMarketingSpend, studio.currency) +
        " de publicidad no tienen origen/campaña y no pueden calcular retorno.",
      action: "Editar el registro del gasto usando los mismos nombres que llegan desde Asistian.",
      href: viewHref("marketing", days),
    });
  }

  if (unattributedMarketingContacts >= 3) {
    decisions.push({
      key: "marketing-contacts-unattributed",
      priority: 3,
      tone: "info",
      title: "Mejorar atribución de prospectos",
      evidence:
        unattributedMarketingContacts +
        " contactos del periodo llegaron sin origen/campaña identificable.",
      action: "Enviar source y campaign en conversation_activity para no perder el origen del lead.",
      href: viewHref("marketing", days),
    });
  }

  if (paidCampaignWithoutConversion) {
    decisions.push({
      key: "marketing-paid-no-conversion-" + paidCampaignWithoutConversion.key,
      priority: 2,
      tone: "danger",
      title: "Revisar " + paidCampaignWithoutConversion.label,
      evidence:
        money(paidCampaignWithoutConversion.spend, studio.currency) +
        " de gasto, " +
        paidCampaignWithoutConversion.contacts +
        " contactos y ninguna alumna convertida al corte.",
      action: "Revisar calidad del lead y el punto del embudo antes de aumentar presupuesto.",
      href: viewHref("marketing", days),
    });
  }

  if (efficientCampaign) {
    decisions.push({
      key: "marketing-efficient-" + efficientCampaign.key,
      priority: 3,
      tone: "positive",
      title: "Señal positiva en " + efficientCampaign.label,
      evidence:
        efficientCampaign.converted +
        " alumnas convertidas y ROAS atribuido de " +
        (efficientCampaign.roas ?? 0).toFixed(1) +
        "× con " +
        efficientCampaign.contacts +
        " contactos.",
      action: "Validar que la calidad se sostenga antes de escalar presupuesto gradualmente.",
      href: viewHref("marketing", days),
    });
  }

  if (attendanceDecisionSample >= 5 && showRateDrop >= 5) {
    decisions.push({
      key: "conversion-show-rate",
      priority: showRateDrop >= 10 ? 1 : 2,
      tone: "danger",
      title: "Reducir no show",
      evidence:
        "El show rate cayó " +
        showRateDrop.toFixed(1) +
        " pp: " +
        pct(previousShowRate) +
        " → " +
        pct(showRate) +
        " con " +
        attendanceDecisionSample +
        " resultados de asistencia.",
      action: "Revisar recordatorios y concentrar recuperación en quienes faltaron.",
      href: viewHref("conversion", days),
    });
  }

  if (noShowRecovery.eligible >= 3 && noShowRecovery.rate < 50) {
    decisions.push({
      key: "no-show-recovery",
      priority: 2,
      tone: "warning",
      title: "Mejorar recuperación de no show",
      evidence:
        noShowRecovery.recovered +
        " de " +
        noShowRecovery.eligible +
        " personas con no show volvieron a reservar (" +
        pct(noShowRecovery.rate) +
        ").",
      action: "Contactar no-shows sin nueva reserva y medir cuántos regresan después del seguimiento.",
      href: viewHref("conversion", days),
    });
  }

  if (cancellationRecovery.eligible >= 3 && cancellationRecovery.rate < 50) {
    decisions.push({
      key: "cancellation-recovery",
      priority: 2,
      tone: "warning",
      title: "Recuperar cancelaciones",
      evidence:
        cancellationRecovery.recovered +
        " de " +
        cancellationRecovery.eligible +
        " personas que cancelaron volvieron a reservar (" +
        pct(cancellationRecovery.rate) +
        ").",
      action: "Separar por motivo y ofrecer una nueva reserva a quienes aún no regresan.",
      href: viewHref("conversion", days),
    });
  }

  if (highestDemand && highestDemand.occupancy >= 90) {
    decisions.push({
      key: "class-capacity-" + highestDemand.name,
      priority: 3,
      tone: "positive",
      title: "Evaluar más capacidad en " + highestDemand.name,
      evidence:
        pct(highestDemand.occupancy) +
        " de ocupación en " +
        highestDemand.sessionCount +
        " sesiones del periodo.",
      action: "Revisar si conviene abrir otro horario o aumentar capacidad sin canibalizar otra clase.",
      href: viewHref("clases", days),
    });
  }

  if (lowestDemand && lowestDemand.occupancy < 40) {
    decisions.push({
      key: "class-low-demand-" + lowestDemand.name,
      priority: 2,
      tone: "warning",
      title: "Revisar " + lowestDemand.name,
      evidence:
        pct(lowestDemand.occupancy) +
        " de ocupación en " +
        lowestDemand.sessionCount +
        " sesiones; ya hay muestra suficiente para no tratarlo como un día aislado.",
      action: "Comparar día/franja y probar cambio de horario o promoción antes de eliminarla.",
      href: viewHref("clases", days),
    });
  }

  if (highestCancellation && highestCancellation.cancellation >= 20) {
    decisions.push({
      key: "class-cancellation-" + highestCancellation.name,
      priority: 2,
      tone: "warning",
      title: "Investigar cancelaciones en " + highestCancellation.name,
      evidence:
        pct(highestCancellation.cancellation) +
        " de cancelación con al menos 5 decisiones de reserva.",
      action: "Cruzar motivos de cancelación con horario antes de cambiar la clase.",
      href: viewHref("clases", days),
    });
  }

  if (missingCancellationReasonCount >= 2) {
    decisions.push({
      key: "data-cancellation-reasons",
      priority: 3,
      tone: "info",
      title: "Completar causas de cancelación",
      evidence:
        missingCancellationReasonCount +
        " cancelaciones del periodo siguen sin un motivo analizable.",
      action: "Usar el nuevo selector estructurado y evitar cancelaciones administrativas sin causa.",
      href: viewHref("conversion", days),
    });
  }

  if (currentConversationCohort.conversations === 0) {
    decisions.push({
      key: "data-asistian-conversations",
      priority: 3,
      tone: "info",
      title: "Activar conversaciones de Asistian",
      evidence:
        "El receptor y el embudo ya están preparados, pero todavía no hay conversation_activity en este estudio.",
      action: "Configurar la automatización de Asistian para enviar actividad entrante al receptor de Studio Flow.",
      href: "/admin/integraciones/asistian",
    });
  }

  decisions.sort((a, b) => a.priority - b.priority);
  const topDecisions = decisions.slice(0, 5);

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
              delta={deltaText(activeStudents, previousActiveStudents)}
              tone="positive"
            />
            <MetricCard
              label="Show rate"
              value={pct(showRate)}
              delta={pointsDelta(showRate, previousShowRate)}
              tone={showRate >= previousShowRate ? "positive" : "warning"}
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
                title="🧭 Centro de decisiones"
                description="Prioriza sólo señales con evidencia suficiente. Cada tarjeta explica qué pasó y qué hacer."
              >
                <div className="intel-decision-list">
                  {topDecisions.length ? (
                    topDecisions.map((decision) => (
                      <DecisionCard key={decision.key} decision={decision} />
                    ))
                  ) : (
                    <div className="intel-decision-empty">
                      <strong>✓ Sin decisiones críticas detectadas</strong>
                      <p>
                        Las señales con muestra suficiente están dentro de los umbrales operativos.
                      </p>
                    </div>
                  )}
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
                title="🎯 Adquisición desde conversación"
                description="Las mismas personas avanzando desde conversación hasta compra."
              >
                <div className="intel-bars">
                  <BarRow
                    label="Conversaciones"
                    value={currentConversationCohort.conversations}
                    max={Math.max(currentConversationCohort.conversations, 1)}
                    display={String(currentConversationCohort.conversations)}
                    tone="info"
                  />
                  <BarRow
                    label="Contactos únicos"
                    value={currentConversationCohort.contacts}
                    max={Math.max(currentConversationCohort.conversations, 1)}
                    display={String(currentConversationCohort.contacts)}
                    tone="info"
                  />
                  <BarRow
                    label="Reservaron"
                    value={currentConversationCohort.booked}
                    max={Math.max(currentConversationCohort.contacts, 1)}
                    display={String(currentConversationCohort.booked)}
                    tone="accent"
                  />
                  <BarRow
                    label="Compraron paquete / membresía"
                    value={currentConversationCohort.converted}
                    max={Math.max(currentConversationCohort.contacts, 1)}
                    display={
                      currentConversationCohort.converted +
                      " · " +
                      pct(currentConversationCohort.conversationToConversionRate)
                    }
                    tone="success"
                  />
                </div>
                <div className="intel-source-note">
                  {currentConversationCohort.conversations > 0
                    ? "Conversación → reserva: " +
                      pct(currentConversationCohort.conversationToBookingRate) +
                      " · Conversación → alumna: " +
                      pct(currentConversationCohort.conversationToConversionRate)
                    : "La integración está lista; falta que Asistian empiece a enviar conversation_activity."}
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
              label="Cartera pendiente"
              value={money(collectionPending, studio.currency)}
              delta={
                collectionOpenRows.length > 0
                  ? collectionOpenRows.length + " saldos abiertos"
                  : "Sin saldos pendientes"
              }
              tone={collectionPending > 0 ? "warning" : "positive"}
            />
            <MetricCard
              label="Ticket promedio"
              value={money(ticketAverage, studio.currency)}
              delta={deltaText(ticketAverage, previousTicketAverage)}
              tone="neutral"
            />
            <MetricCard
              label="Cobranza vencida"
              value={money(collectionOverdueAmount, studio.currency)}
              delta={
                collectionOverdueRows.length > 0
                  ? collectionOverdueRows.length + " compromisos vencidos"
                  : "Sin vencidos"
              }
              tone={collectionOverdueAmount > 0 ? "danger" : "positive"}
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
              <Section title="Vendido por producto" description="Importe vendido; puede diferir del efectivo cobrado.">
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
                    tone={collectionOverdueAmount > 0 ? "danger" : "positive"}
                    title={
                      collectionOverdueAmount > 0
                        ? "🚨 Hay cobranza vencida"
                        : "✓ Sin promesas vencidas"
                    }
                    body={
                      collectionOverdueAmount > 0
                        ? money(collectionOverdueAmount, studio.currency) +
                          " debieron cobrarse antes de hoy."
                        : "No hay promesas de pago vencidas con saldo abierto."
                    }
                    href="/admin/ventas"
                  />
                  {collectionDueTodayAmount > 0 ? (
                    <Insight
                      tone="warning"
                      title="⏰ Vence hoy"
                      body={
                        money(collectionDueTodayAmount, studio.currency) +
                        " tienen promesa de pago para hoy."
                      }
                      href="/admin/ventas"
                    />
                  ) : null}
                  <Insight
                    tone={currentRefunds > 0 ? "danger" : "info"}
                    title="↩ Reembolsos"
                    body={money(currentRefunds, studio.currency) + " registrados en el periodo."}
                    href="/admin/ventas"
                  />
                </div>
              </Section>

              <Section
                title="Saldos de cobranza abiertos"
                description="Incluye saldos con y sin fecha de promesa; no depende del filtro de 7/30/90 días."
              >
                <div className="intel-risk-list">
                  {collectionOpenRows.slice(0, 8).map((sale) => {
                    const student = students.find((item) => item.id === sale.student_id);
                    const overdue = Boolean(
                      sale.payment_due_on && sale.payment_due_on < todayDate,
                    );
                    const dueToday = sale.payment_due_on === todayDate;
                    return (
                      <Link
                        href={"/admin/ventas/" + sale.id}
                        key={sale.id}
                        className="intel-risk-row"
                      >
                        <span>
                          <strong>{student?.full_name ?? "Alumna"}</strong>
                          <small>
                            {sale.payment_due_on
                              ? overdue
                                ? "Venció " + sale.payment_due_on
                                : dueToday
                                  ? "Vence hoy"
                                  : "Vence " + sale.payment_due_on
                              : "Sin fecha de promesa"}
                          </small>
                        </span>
                        <b>{money(sale.balance, sale.currency)}</b>
                      </Link>
                    );
                  })}
                  {!collectionOpenRows.length ? (
                    <p className="intel-empty">No hay saldos de cobranza abiertos.</p>
                  ) : null}
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
              label="Nuevas alumnas"
              value={String(newCommercialStudentsCurrent.length)}
              delta={deltaText(
                newCommercialStudentsCurrent.length,
                newCommercialStudentsPrevious.length,
              )}
              tone="info"
            />
            <MetricCard
              label="Riesgo preventivo"
              value={String(preventiveRiskStudents.length)}
              delta="Vencen ≤7 días · señales de desconexión"
              tone={preventiveRiskStudents.length ? "warning" : "positive"}
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
                    label="Vencidas 7–14 días"
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
                title="🚀 Onboarding"
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
                        tone={completed === onboardingRows.length && onboardingRows.length > 0 ? "success" : "info"}
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
                title="🚨 Requieren seguimiento"
                description="Tocar una alumna abre directamente su perfil."
              >
                <div className="intel-risk-list">
                  {[
                    ...preventiveRiskStudents,
                    ...[...riskStudents, ...inactiveStudents, ...abandonedStudents].sort(
                      (a, b) => b.days - a.days,
                    ),
                  ]
                    .slice(0, 8)
                    .map((item) => (
                      <Link
                        href={"/admin/alumnas/" + item.id}
                        key={item.id + ":" + item.state}
                        className="intel-risk-row"
                      >
                        <span>
                          <strong>{item.name}</strong>
                          <small>{item.detail}</small>
                        </span>
                        <b>{item.state}</b>
                      </Link>
                    ))}
                  {!preventiveRiskStudents.length &&
                  !riskStudents.length &&
                  !inactiveStudents.length &&
                  !abandonedStudents.length ? (
                    <p className="intel-empty">No hay señales de retención que requieran seguimiento.</p>
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
              label="Conversaciones"
              value={String(currentConversationCohort.conversations)}
              delta={deltaText(
                currentConversationCohort.conversations,
                previousConversationCohort.conversations,
              )}
              tone="info"
            />
            <MetricCard
              label="Contacto → reserva"
              value={
                currentConversationCohort.contacts > 0
                  ? pct(currentConversationCohort.conversationToBookingRate)
                  : "—"
              }
              delta={pointsDelta(
                currentConversationCohort.conversationToBookingRate,
                previousConversationCohort.conversationToBookingRate,
              )}
              tone={
                currentConversationCohort.conversationToBookingRate >=
                previousConversationCohort.conversationToBookingRate
                  ? "positive"
                  : "warning"
              }
            />
            <MetricCard
              label="Reserva → asistencia"
              value={
                currentConversationCohort.booked > 0
                  ? pct(currentConversationCohort.bookingToAttendanceRate)
                  : "—"
              }
              delta={pointsDelta(
                currentConversationCohort.bookingToAttendanceRate,
                previousConversationCohort.bookingToAttendanceRate,
              )}
              tone={
                currentConversationCohort.bookingToAttendanceRate >=
                previousConversationCohort.bookingToAttendanceRate
                  ? "positive"
                  : "warning"
              }
            />
            <MetricCard
              label="Asistencia → alumna"
              value={
                currentConversationCohort.attended > 0
                  ? pct(currentConversationCohort.attendanceToConversionRate)
                  : "—"
              }
              delta={pointsDelta(
                currentConversationCohort.attendanceToConversionRate,
                previousConversationCohort.attendanceToConversionRate,
              )}
              tone={
                currentConversationCohort.attendanceToConversionRate >=
                previousConversationCohort.attendanceToConversionRate
                  ? "positive"
                  : "warning"
              }
            />
          </section>

          <div className="intel-two-column">
            <div className="intel-stack">
              <Section
                title="💬 Embudo desde conversación"
                description="Cohorte por contacto conversado en el periodo. Varias conversaciones de la misma persona no inflan la conversión."
              >
                <div className="intel-bars">
                  <BarRow
                    label="Conversaciones"
                    value={currentConversationCohort.conversations}
                    max={Math.max(currentConversationCohort.conversations, 1)}
                    display={String(currentConversationCohort.conversations)}
                    tone="info"
                  />
                  <BarRow
                    label="Contactos únicos"
                    value={currentConversationCohort.contacts}
                    max={Math.max(currentConversationCohort.conversations, 1)}
                    display={String(currentConversationCohort.contacts)}
                    tone="info"
                  />
                  <BarRow
                    label="Reservaron"
                    value={currentConversationCohort.booked}
                    max={Math.max(currentConversationCohort.contacts, 1)}
                    display={
                      currentConversationCohort.booked +
                      " · " +
                      pct(currentConversationCohort.conversationToBookingRate)
                    }
                    tone="accent"
                  />
                  <BarRow
                    label="Asistieron"
                    value={currentConversationCohort.attended}
                    max={Math.max(currentConversationCohort.contacts, 1)}
                    display={String(currentConversationCohort.attended)}
                    tone="success"
                  />
                  <BarRow
                    label="Compraron paquete / membresía"
                    value={currentConversationCohort.converted}
                    max={Math.max(currentConversationCohort.contacts, 1)}
                    display={
                      currentConversationCohort.converted +
                      " · " +
                      pct(currentConversationCohort.conversationToConversionRate)
                    }
                    tone="success"
                  />
                </div>
                <div className="intel-source-note">
                  {currentConversationCohort.conversations > 0
                    ? currentConversationCohort.linked +
                      "/" +
                      currentConversationCohort.contacts +
                      " contactos ya están enlazados con una alumna/prospecto de Studio Flow."
                    : "Esperando el primer evento conversation_activity desde Asistian. El receptor y la cohorte ya están preparados."}
                </div>
              </Section>

              <Section
                title="📍 Actividad operativa del periodo"
                description="Volumen ocurrido en estas fechas. No se presenta como embudo porque las personas pueden venir de cohortes anteriores."
              >
                <div className="intel-bars">
                  <BarRow
                    label="Intentos de reserva"
                    value={currentBookingEvents.length}
                    max={Math.max(currentBookingEvents.length, 1)}
                    display={
                      currentBookingEvents.length +
                      " · " +
                      currentBookingStudents.size +
                      " personas"
                    }
                    tone="info"
                  />
                  <BarRow
                    label="Asistencias"
                    value={currentAttendedEvents.length}
                    max={Math.max(currentBookingEvents.length, currentAttendedEvents.length, 1)}
                    display={String(currentAttendedEvents.length)}
                    tone="success"
                  />
                  <BarRow
                    label="No show"
                    value={currentNoShowEvents.length}
                    max={Math.max(currentBookingEvents.length, currentNoShowEvents.length, 1)}
                    display={String(currentNoShowEvents.length)}
                    tone="danger"
                  />
                </div>
                <div className="intel-source-note">
                  Actividad sirve para operación; cohorte sirve para medir conversión.
                </div>
              </Section>

              <Section
                title="↻ Fugas y recuperación"
                description="Las cancelaciones y no show ya no desaparecen aunque la persona vuelva a reservar."
              >
                <div className="intel-bars">
                  <BarRow
                    label="Cancelaciones"
                    value={currentCancellationEvents.length}
                    max={Math.max(currentCancellationEvents.length, currentNoShowEvents.length, 1)}
                    display={
                      currentCancellationEvents.length +
                      " · " +
                      currentCancelledStudents.size +
                      " personas"
                    }
                    tone="warning"
                  />
                  <BarRow
                    label="Cancelaron y volvieron a reservar"
                    value={cancellationRecovery.recovered}
                    max={Math.max(cancellationRecovery.eligible, 1)}
                    display={
                      cancellationRecovery.recovered +
                      "/" +
                      cancellationRecovery.eligible +
                      " · " +
                      pct(cancellationRecovery.rate)
                    }
                    tone="success"
                  />
                  {currentStudioCancellationEvents.length > 0 ? (
                    <BarRow
                      label="Canceladas por el estudio"
                      value={currentStudioCancellationEvents.length}
                      max={Math.max(
                        currentCancellationEvents.length,
                        currentStudioCancellationEvents.length,
                        currentNoShowEvents.length,
                        1,
                      )}
                      display={String(currentStudioCancellationEvents.length)}
                      tone="info"
                    />
                  ) : null}
                  <BarRow
                    label="No show"
                    value={currentNoShowEvents.length}
                    max={Math.max(currentCancellationEvents.length, currentNoShowEvents.length, 1)}
                    display={
                      currentNoShowEvents.length +
                      " · " +
                      currentNoShowStudents.size +
                      " personas"
                    }
                    tone="danger"
                  />
                  <BarRow
                    label="No show y volvieron a reservar"
                    value={noShowRecovery.recovered}
                    max={Math.max(noShowRecovery.eligible, 1)}
                    display={
                      noShowRecovery.recovered +
                      "/" +
                      noShowRecovery.eligible +
                      " · " +
                      pct(noShowRecovery.rate)
                    }
                    tone="success"
                  />
                </div>
              </Section>

              <Section
                title="Motivos de cancelación"
                description="Solo usa motivos estructurados; los históricos sin clasificación permanecen visibles."
              >
                <div className="intel-bars">
                  {cancellationReasonRows.length ? (
                    cancellationReasonRows.map((item) => (
                      <BarRow
                        key={item.label}
                        label={item.label}
                        value={item.count}
                        max={cancellationReasonRows[0]?.count ?? 1}
                        display={String(item.count)}
                        tone={item.label === "Sin motivo registrado" ? "danger" : "warning"}
                      />
                    ))
                  ) : (
                    <p className="intel-empty">No hubo cancelaciones en el periodo.</p>
                  )}
                </div>
              </Section>
            </div>

            <div className="intel-stack">
              <Section title="🚨 Qué requiere atención">
                <div className="intel-insight-list">
                  {currentConversationCohort.conversations > 0 &&
                  currentConversationCohort.linked < currentConversationCohort.contacts ? (
                    <Insight
                      tone="warning"
                      title="🔗 Hay conversaciones aún sin identidad"
                      body={
                        currentConversationCohort.contacts -
                        currentConversationCohort.linked +
                        " contactos todavía no están vinculados a una alumna/prospecto. Se enlazarán automáticamente cuando reserven si Asistian conserva el mismo contacto."
                      }
                    />
                  ) : null}
                  {topCancellationReason ? (
                    <Insight
                      tone={topCancellationReason.label === "Sin motivo registrado" ? "danger" : "warning"}
                      title={
                        topCancellationReason.label === "Sin motivo registrado"
                          ? "Faltan motivos de cancelación"
                          : "Principal motivo: " + topCancellationReason.label
                      }
                      body={
                        topCancellationReason.count +
                        " de " +
                        currentCancellationEvents.length +
                        " cancelaciones del periodo."
                      }
                    />
                  ) : (
                    <Insight
                      tone="positive"
                      title="✓ Sin cancelaciones registradas"
                      body="No hay cancelaciones dentro del periodo seleccionado."
                    />
                  )}
                  {currentNoShowEvents.length > 0 ? (
                    <Insight
                      tone="danger"
                      title={"👻 " + currentNoShowEvents.length + " no show"}
                      body={
                        noShowRecovery.recovered +
                        " de " +
                        noShowRecovery.eligible +
                        " personas volvieron a reservar después."
                      }
                    />
                  ) : null}
                  {cancellationRecovery.eligible > 0 ? (
                    <Insight
                      tone={cancellationRecovery.rate >= 50 ? "positive" : "warning"}
                      title="↻ Recuperación después de cancelar"
                      body={
                        pct(cancellationRecovery.rate) +
                        " volvió a generar una reserva posterior."
                      }
                    />
                  ) : null}
                </div>
              </Section>

              <Section
                title="📣 Origen de conversaciones"
                description="Primera atribución disponible para entender qué canal o campaña sí genera reservas."
              >
                <div className="intel-bars">
                  {conversationSourceRows.length ? (
                    conversationSourceRows.map((item) => (
                      <BarRow
                        key={item.label}
                        label={item.label}
                        value={item.count}
                        max={conversationSourceRows[0]?.count ?? 1}
                        display={String(item.count)}
                        tone={item.label === "Sin atribución" ? "warning" : "info"}
                      />
                    ))
                  ) : (
                    <p className="intel-empty">Todavía no hay conversaciones con atribución.</p>
                  )}
                </div>
              </Section>

              <Section title="Canales">
                <div className="intel-bars">
                  {conversationChannelRows.length ? (
                    conversationChannelRows.map((item) => (
                      <BarRow
                        key={item.label}
                        label={item.label}
                        value={item.count}
                        max={conversationChannelRows[0]?.count ?? 1}
                        display={String(item.count)}
                        tone="info"
                      />
                    ))
                  ) : (
                    <p className="intel-empty">Todavía no hay conversaciones registradas.</p>
                  )}
                </div>
              </Section>

              <Section
                title="🧪 Cohorte de prueba · respaldo"
                description="Se conserva para comparar el historial previo mientras la nueva fuente de conversaciones acumula datos."
              >
                <div className="intel-bars">
                  <BarRow
                    label="Prospectos registrados"
                    value={currentAcquisitionCohort.total}
                    max={Math.max(currentAcquisitionCohort.total, 1)}
                    display={String(currentAcquisitionCohort.total)}
                    tone="info"
                  />
                  <BarRow
                    label="Reservaron"
                    value={currentAcquisitionCohort.booked}
                    max={Math.max(currentAcquisitionCohort.total, 1)}
                    display={
                      currentAcquisitionCohort.booked +
                      " · " +
                      pct(currentAcquisitionCohort.bookingRate)
                    }
                    tone="info"
                  />
                  <BarRow
                    label="Asistieron"
                    value={currentAcquisitionCohort.attended}
                    max={Math.max(currentAcquisitionCohort.total, 1)}
                    display={String(currentAcquisitionCohort.attended)}
                    tone="accent"
                  />
                  <BarRow
                    label="Compraron paquete / membresía"
                    value={currentAcquisitionCohort.converted}
                    max={Math.max(currentAcquisitionCohort.total, 1)}
                    display={
                      currentAcquisitionCohort.converted +
                      " · " +
                      pct(currentAcquisitionCohort.conversionRate)
                    }
                    tone="success"
                  />
                </div>
              </Section>
            </div>
          </div>
        </>
      ) : null}

      {view === "marketing" ? (
        <>
          <section className="intel-kpi-grid">
            <MetricCard
              label="Gasto publicitario"
              value={money(currentMarketingSpend, studio.currency)}
              delta={deltaText(currentMarketingSpend, previousMarketingSpend)}
              tone={currentMarketingSpend > 0 ? "neutral" : "warning"}
            />
            <MetricCard
              label="Contactos atribuidos"
              value={String(currentMarketingContacts)}
              delta={deltaText(currentMarketingContacts, previousMarketingContacts)}
              tone="info"
            />
            <MetricCard
              label="Contacto → alumna"
              value={
                currentMarketingContacts > 0
                  ? pct(currentMarketingConversionRate)
                  : "—"
              }
              delta="Cohorte first-touch al corte"
              tone={currentMarketingConversionRate > 0 ? "positive" : "neutral"}
            />
            <MetricCard
              label="ROAS atribuido"
              value={
                currentMarketingRoas === null
                  ? "—"
                  : currentMarketingRoas.toFixed(2) + "×"
              }
              delta={
                currentMarketingRoas === null
                  ? "Falta gasto atribuido"
                  : "Cobros atribuidos / gasto"
              }
              tone={
                currentMarketingRoas === null
                  ? "warning"
                  : currentMarketingRoas >= 1
                    ? "positive"
                    : "danger"
              }
            />
          </section>

          <div className="intel-two-column">
            <div className="intel-stack">
              <Section
                title="📣 Embudo de marketing"
                description="First-touch por contacto: cada persona se atribuye una sola vez al primer origen/campaña disponible del periodo."
              >
                <div className="intel-bars">
                  <BarRow
                    label="Contactos"
                    value={currentMarketingContacts}
                    max={Math.max(currentMarketingContacts, 1)}
                    display={String(currentMarketingContacts)}
                    tone="info"
                  />
                  <BarRow
                    label="Reservaron"
                    value={currentMarketingBooked}
                    max={Math.max(currentMarketingContacts, 1)}
                    display={
                      currentMarketingBooked +
                      " · " +
                      pct(currentMarketingBookingRate)
                    }
                    tone="accent"
                  />
                  <BarRow
                    label="Asistieron"
                    value={currentMarketingAttended}
                    max={Math.max(currentMarketingContacts, 1)}
                    display={
                      currentMarketingAttended +
                      " · " +
                      pct(currentMarketingAttendanceRate) +
                      " desde reserva"
                    }
                    tone="success"
                  />
                  <BarRow
                    label="Se convirtieron en alumnas"
                    value={currentMarketingConverted}
                    max={Math.max(currentMarketingContacts, 1)}
                    display={
                      currentMarketingConverted +
                      " · " +
                      pct(currentMarketingConversionRate)
                    }
                    tone="success"
                  />
                </div>
                <div className="intel-source-note">
                  Los ingresos son cobros posteriores al primer contacto únicamente para personas cuya primera compra de paquete/membresía ocurrió después de ese contacto.
                </div>
              </Section>

              <Section
                title="Campañas y orígenes"
                description="Compara volumen, calidad del embudo y economía. No se recomienda escalar con muestras pequeñas."
              >
                <div className="intel-campaign-list">
                  {currentMarketingRows.length ? (
                    currentMarketingRows.map((row) => (
                      <article className="intel-campaign-card" key={row.key}>
                        <div className="intel-campaign-heading">
                          <div>
                            <strong>{row.label}</strong>
                            <small>
                              {row.campaign && row.source
                                ? row.source + " · " + row.campaign
                                : row.source ?? (row.key === "unattributed" ? "Sin atribución" : "Campaña")}
                            </small>
                          </div>
                          <span>{row.contacts} contactos</span>
                        </div>
                        <div className="intel-campaign-metrics">
                          <div>
                            <small>Reserva</small>
                            <b>{pct(row.bookingRate)}</b>
                          </div>
                          <div>
                            <small>Alumna</small>
                            <b>{pct(row.conversionRate)}</b>
                          </div>
                          <div>
                            <small>Gasto</small>
                            <b>{money(row.spend, studio.currency)}</b>
                          </div>
                          <div>
                            <small>Costo/alumna</small>
                            <b>
                              {row.costPerStudent === null
                                ? "—"
                                : money(row.costPerStudent, studio.currency)}
                            </b>
                          </div>
                          <div>
                            <small>Cobros atribuidos</small>
                            <b>{money(row.revenue, studio.currency)}</b>
                          </div>
                          <div>
                            <small>ROAS</small>
                            <b>{row.roas === null ? "—" : row.roas.toFixed(2) + "×"}</b>
                          </div>
                        </div>
                        {row.contacts < 5 ? (
                          <p className="intel-campaign-note">
                            Muestra pequeña: todavía no usar esta fila para escalar o cortar presupuesto.
                          </p>
                        ) : null}
                      </article>
                    ))
                  ) : (
                    <div className="intel-decision-empty">
                      <strong>Todavía no hay atribución de marketing</strong>
                      <p>
                        Configura conversation_activity en Asistian y registra los gastos de publicidad con el mismo origen/campaña.
                      </p>
                      <Link href="/admin/integraciones/asistian">Configurar Asistian →</Link>
                    </div>
                  )}
                </div>
              </Section>
            </div>

            <div className="intel-stack">
              <Section title="💵 Economía atribuida">
                <div className="intel-rule-list">
                  <div>
                    <span>Gasto publicitario</span>
                    <strong>{money(currentMarketingSpend, studio.currency)}</strong>
                  </div>
                  <div>
                    <span>Cobros atribuidos</span>
                    <strong>{money(currentMarketingRevenue, studio.currency)}</strong>
                  </div>
                  <div>
                    <span>Costo por contacto</span>
                    <strong>
                      {currentMarketingContacts > 0
                        ? money(currentMarketingSpend / currentMarketingContacts, studio.currency)
                        : "—"}
                    </strong>
                  </div>
                  <div>
                    <span>Costo por alumna</span>
                    <strong>
                      {currentMarketingConverted > 0
                        ? money(currentMarketingSpend / currentMarketingConverted, studio.currency)
                        : "—"}
                    </strong>
                  </div>
                  <div>
                    <span>ROAS atribuido</span>
                    <strong>
                      {currentMarketingRoas === null
                        ? "—"
                        : currentMarketingRoas.toFixed(2) + "×"}
                    </strong>
                  </div>
                </div>
              </Section>

              <Section
                title="🧩 Calidad de atribución"
                description="La decisión es tan buena como la identidad y campaña que llegan desde la fuente."
              >
                <div className="intel-insight-list">
                  <Insight
                    tone={unattributedMarketingContacts > 0 ? "warning" : "positive"}
                    title={
                      unattributedMarketingContacts > 0
                        ? unattributedMarketingContacts + " contactos sin atribución"
                        : "✓ Contactos con origen identificado"
                    }
                    body={
                      unattributedMarketingContacts > 0
                        ? "No sabemos qué campaña originó esos contactos."
                        : "Los contactos del periodo tienen origen/campaña disponible."
                    }
                    href="/admin/integraciones/asistian"
                  />
                  <Insight
                    tone={unattributedMarketingSpend > 0 ? "warning" : "positive"}
                    title={
                      unattributedMarketingSpend > 0
                        ? money(unattributedMarketingSpend, studio.currency) +
                          " de gasto sin campaña"
                        : "✓ Gasto publicitario atribuido"
                    }
                    body={
                      unattributedMarketingSpend > 0
                        ? "Ese gasto no puede entrar a costo por alumna ni ROAS por campaña."
                        : "El gasto publicitario registrado tiene una llave de atribución."
                    }
                    href={viewHref("finanzas", days)}
                  />
                </div>
              </Section>

              <Section
                title="Cómo leer esta pantalla"
                description="Atribución no significa causalidad."
              >
                <ul className="intel-unlock-list">
                  <li>First-touch evita que varias conversaciones cuenten como varios leads.</li>
                  <li>Una campaña necesita al menos 5 contactos antes de generar una señal de decisión.</li>
                  <li>ROAS compara cobros atribuidos contra gasto registrado, no utilidad.</li>
                  <li>La rentabilidad final también depende de costos operativos y retención posterior.</li>
                </ul>
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
                    <span>No show</span>
                  </div>
                  {classRows.map((row) => (
                    <div className="intel-data-row intel-class-grid" key={row.name}>
                      <span>
                        {row.name} · {row.sessionCount} {row.sessionCount === 1 ? "sesión" : "sesiones"}
                      </span>
                      <strong>{pct(row.occupancy)}</strong>
                      <span>{pct(row.attendance)}</span>
                      <span>{pct(row.cancellation)}</span>
                      <span>{pct(row.noShowRate)}</span>
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
              <Section
                title="🚨 Decisiones sugeridas"
                description="Solo se generan con al menos 3 sesiones de muestra; cancelación/no show requieren además volumen suficiente."
              >
                <div className="intel-insight-list">
                  {highestDemand && highestDemand.occupancy >= 90 ? (
                    <Insight
                      tone="positive"
                      title={"🔥 Evaluar expansión · " + highestDemand.name}
                      body={
                        pct(highestDemand.occupancy) +
                        " de ocupación en " +
                        highestDemand.sessionCount +
                        " sesiones. Revisar lista de espera y, si la presión se repite, probar más capacidad u otro horario."
                      }
                    />
                  ) : null}
                  {lowestDemand && lowestDemand.occupancy < 40 ? (
                    <Insight
                      tone="danger"
                      title={"❄️ Revisar horario · " + lowestDemand.name}
                      body={
                        pct(lowestDemand.occupancy) +
                        " de ocupación en " +
                        lowestDemand.sessionCount +
                        " sesiones. Antes de eliminarla, probar horario/promoción y comparar el siguiente periodo."
                      }
                    />
                  ) : null}
                  {highestCancellation && highestCancellation.cancellation >= 15 ? (
                    <Insight
                      tone="warning"
                      title={"⚠️ Investigar cancelaciones · " + highestCancellation.name}
                      body={
                        pct(highestCancellation.cancellation) +
                        " de cancelación sobre " +
                        highestCancellation.total +
                        " reservas. Revisar motivos antes de asumir que el problema es el horario."
                      }
                    />
                  ) : null}
                  {highestNoShow && highestNoShow.noShowRate >= 10 ? (
                    <Insight
                      tone="danger"
                      title={"👻 Reducir no show · " + highestNoShow.name}
                      body={
                        pct(highestNoShow.noShowRate) +
                        " de no show. Revisar recordatorios, confirmación y cumplimiento de la política de no asistencia."
                      }
                    />
                  ) : null}
                  {!highestDemand && !lowestDemand && !highestCancellation && !highestNoShow ? (
                    <Insight
                      tone="info"
                      title="Muestra todavía insuficiente"
                      body="Necesitamos al menos 3 sesiones por clase antes de sugerir cambios operativos."
                    />
                  ) : null}
                </div>
              </Section>

              <Section title="Cómo se decide">
                <div className="intel-rule-list">
                  <div><span>≥90% ocupación · 3+ sesiones</span><strong>Evaluar expansión</strong></div>
                  <div><span>&lt;40% ocupación · 3+ sesiones</span><strong>Probar ajuste antes de eliminar</strong></div>
                  <div><span>≥15% cancelación · 5+ reservas</span><strong>Investigar motivos</strong></div>
                  <div><span>≥10% no show · 5+ cierres</span><strong>Reforzar recuperación</strong></div>
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
              label="Renovación ≤30 días"
              value={renewal.matured > 0 ? pct(renewal.rate) : "—"}
              delta={
                renewal.matured === 0
                  ? "Cohorte todavía sin resultados maduros"
                  : previousRenewal.matured > 0
                    ? pointsDelta(renewal.rate, previousRenewal.rate)
                    : renewal.matured + " casos con resultado conocido"
              }
              tone={
                renewal.matured === 0
                  ? "neutral"
                  : renewal.rate >= previousRenewal.rate
                    ? "positive"
                    : "warning"
              }
            />
            <MetricCard
              label="Churn confirmado"
              value={String(renewal.churnConfirmed)}
              delta={
                renewal.pendingMaturity > 0
                  ? renewal.pendingMaturity + " vencimientos aún madurando"
                  : "No incluye cohortes de menos de 30 días"
              }
              tone={renewal.churnConfirmed > 0 ? "danger" : "positive"}
            />
            <MetricCard
              label="Riesgo preventivo"
              value={String(preventiveRiskStudents.length)}
              delta="Señales de comportamiento explicables"
              tone={preventiveRiskStudents.length ? "warning" : "positive"}
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
                title="📈 Qué pasó después del vencimiento"
                description="Separa renovación, reactivación y churn. Una alumna no se declara perdida mientras su ventana de 30 días siga abierta."
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
                    label="Renovaron antes / al vencer"
                    value={renewal.immediate}
                    max={Math.max(renewal.expired, 1)}
                    display={String(renewal.immediate)}
                    tone="success"
                  />
                  <BarRow
                    label="Renovaron ≤7 días"
                    value={renewal.within7}
                    max={Math.max(renewal.expired, 1)}
                    display={String(renewal.within7)}
                    tone="success"
                  />
                  <BarRow
                    label="Renovaron 8–30 días"
                    value={renewal.within30}
                    max={Math.max(renewal.expired, 1)}
                    display={String(renewal.within30)}
                    tone="accent"
                  />
                  <BarRow
                    label="Reactivaron >30 días"
                    value={renewal.reactivated}
                    max={Math.max(renewal.expired, 1)}
                    display={String(renewal.reactivated)}
                    tone="info"
                  />
                  <BarRow
                    label="Churn confirmado"
                    value={renewal.churnConfirmed}
                    max={Math.max(renewal.expired, 1)}
                    display={String(renewal.churnConfirmed)}
                    tone="danger"
                  />
                  {renewal.pendingMaturity > 0 ? (
                    <BarRow
                      label="Todavía madurando"
                      value={renewal.pendingMaturity}
                      max={Math.max(renewal.expired, 1)}
                      display={String(renewal.pendingMaturity)}
                      tone="warning"
                    />
                  ) : null}
                </div>
              </Section>

              <Section
                title="🧠 Señales preventivas"
                description="No es una probabilidad opaca: cada alumna aparece por señales concretas observables."
              >
                <div className="intel-rule-list">
                  <div><span>Paquete vence ≤7 días</span><strong>+2 señales</strong></div>
                  <div><span>14 días sin asistir</span><strong>+2 señales</strong></div>
                  <div><span>Frecuencia cae ≥50% vs 28 días previos</span><strong>+2 señales</strong></div>
                  <div><span>Sin próxima reserva</span><strong>+1 señal</strong></div>
                  <div><span>2+ cancelaciones/no-show recientes</span><strong>+1 señal</strong></div>
                </div>
                <div className="intel-source-note">
                  Se necesita una combinación relevante de señales; una alumna nueva no se penaliza por no tener historial suficiente.
                </div>
              </Section>

              <Section
                title="Frecuencia general"
                description="Sirve como contexto del estudio; las alertas individuales comparan a cada alumna contra su propio comportamiento."
              >
                <div className="intel-frequency-value">
                  <strong>{weeklyFrequency.toFixed(1)}</strong>
                  <span>asistencias por semana / alumna activa</span>
                </div>
              </Section>
            </div>

            <div className="intel-stack">
              <Section
                title="🔴 Alta prioridad"
                description="Contactar ahora: múltiples señales y/o vencimiento inminente."
              >
                <div className="intel-risk-list">
                  {urgentRetentionStudents.slice(0, 8).map((item) => (
                    <Link
                      href={"/admin/alumnas/" + item.id}
                      key={item.id}
                      className="intel-risk-row"
                    >
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.detail}</small>
                      </span>
                      <b>Actuar hoy</b>
                    </Link>
                  ))}
                  {!urgentRetentionStudents.length ? (
                    <p className="intel-empty">No hay alumnas con prioridad inmediata hoy.</p>
                  ) : null}
                </div>
              </Section>

              <Section
                title="🟡 Vigilar"
                description="Señales tempranas que todavía no justifican contacto inmediato."
              >
                <div className="intel-risk-list">
                  {watchRetentionStudents.slice(0, 10).map((item) => (
                    <Link
                      href={"/admin/alumnas/" + item.id}
                      key={item.id}
                      className="intel-risk-row"
                    >
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.detail}</small>
                      </span>
                      <b>Vigilar</b>
                    </Link>
                  ))}
                  {!watchRetentionStudents.length ? (
                    <p className="intel-empty">No hay alumnas en vigilancia preventiva.</p>
                  ) : null}
                </div>
              </Section>

              <Section
                title="Recuperación después del vencimiento"
                description="Estas alumnas ya requieren recuperación, no prevención."
              >
                <div className="intel-risk-list">
                  {[...riskStudents, ...inactiveStudents, ...abandonedStudents]
                    .sort((a, b) => a.days - b.days)
                    .slice(0, 10)
                    .map((item) => (
                      <Link
                        href={"/admin/alumnas/" + item.id}
                        key={item.id + ":" + item.state}
                        className="intel-risk-row"
                      >
                        <span>
                          <strong>{item.name}</strong>
                          <small>{item.detail}</small>
                        </span>
                        <b>{item.state}</b>
                      </Link>
                    ))}
                  {!riskStudents.length && !inactiveStudents.length && !abandonedStudents.length ? (
                    <p className="intel-empty">No hay alumnas vencidas que requieran recuperación.</p>
                  ) : null}
                </div>
              </Section>

              <Section
                title="Cómo se clasifica el vencimiento"
                description="La etiqueta cambia con el tiempo sin borrar el historial de una eventual reactivación."
              >
                <div className="intel-insight-list">
                  <Insight
                    tone="warning"
                    title="🟠 Vencida reciente"
                    body="7–14 días desde vencimiento sin una nueva compra."
                  />
                  <Insight
                    tone="info"
                    title="🟠 Inactiva"
                    body="15–29 días desde vencimiento sin renovación."
                  />
                  <Insight
                    tone="danger"
                    title="🔴 Churn confirmado"
                    body="30+ días desde vencimiento sin una nueva compra. Si regresa después, se registra como reactivación."
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
              label="Ingresos cobrados"
              value={money(currentRevenue, studio.currency)}
              delta={deltaText(currentRevenue, previousRevenue)}
              tone={currentRevenue >= previousRevenue ? "positive" : "danger"}
            />
            <MetricCard
              label="Gastos registrados"
              value={money(currentExpenseTotal, studio.currency)}
              delta={deltaText(currentExpenseTotal, previousExpenseTotal)}
              tone={currentExpenseTotal > previousExpenseTotal ? "warning" : "neutral"}
            />
            <MetricCard
              label="Resultado operativo"
              value={money(currentOperatingResult, studio.currency)}
              delta={deltaText(currentOperatingResult, previousOperatingResult)}
              tone={currentOperatingResult >= 0 ? "positive" : "danger"}
            />
            <MetricCard
              label="Margen registrado"
              value={currentRevenue > 0 ? pct(currentOperatingMargin) : "—"}
              delta={pointsDelta(currentOperatingMargin, previousOperatingMargin)}
              tone={currentOperatingResult >= 0 ? "positive" : "danger"}
            />
          </section>

          <div className="intel-two-column">
            <div className="intel-stack">
              <Section
                title="💰 Resultado operativo registrado"
                description="Cobros netos menos gastos capturados con fecha efectiva dentro del periodo."
              >
                <div className="intel-rule-list">
                  <div>
                    <span>Ingresos cobrados</span>
                    <strong>{money(currentRevenue, studio.currency)}</strong>
                  </div>
                  <div>
                    <span>Gastos registrados</span>
                    <strong>{money(currentExpenseTotal, studio.currency)}</strong>
                  </div>
                  <div>
                    <span>Resultado</span>
                    <strong>{money(currentOperatingResult, studio.currency)}</strong>
                  </div>
                  <div>
                    <span>Margen</span>
                    <strong>{currentRevenue > 0 ? pct(currentOperatingMargin) : "—"}</strong>
                  </div>
                </div>
                <div className="intel-source-note">
                  Esto es inteligencia operativa, no contabilidad fiscal. Si faltan gastos por registrar,
                  el resultado estará sobreestimado.
                </div>
              </Section>

              <Section title="Gastos por categoría">
                <div className="intel-bars">
                  {expenseCategoryRows.length ? (
                    expenseCategoryRows.map((item) => (
                      <BarRow
                        key={item.category}
                        label={item.label}
                        value={item.amount}
                        max={expenseCategoryRows[0]?.amount ?? 1}
                        display={money(item.amount, studio.currency)}
                        tone="warning"
                      />
                    ))
                  ) : (
                    <p className="intel-empty">No hay gastos registrados en este periodo.</p>
                  )}
                </div>
              </Section>

              <Section
                title="Últimos gastos"
                description="Usamos fecha efectiva para que cada gasto caiga en el periodo económico correcto."
              >
                <div className="intel-expense-list">
                  {recentExpenses.map((expense) => (
                    <article className="intel-expense-row" key={expense.id}>
                      <div>
                        <strong>{expense.description}</strong>
                        <small>
                          {(expenseCategoryLabels[expense.category] ?? expense.category) +
                            " · " +
                            expense.effective_on +
                            (expense.vendor ? " · " + expense.vendor : "")}
                        </small>
                      </div>
                      <div className="intel-expense-amount">
                        <b>{money(expense.amount_minor, expense.currency)}</b>
                        {canWriteFinance ? (
                          <form action={deleteStudioExpense}>
                            <input type="hidden" name="expense_id" value={expense.id} />
                            <input type="hidden" name="days" value={String(days)} />
                            <button type="submit">Eliminar</button>
                          </form>
                        ) : null}
                      </div>
                    </article>
                  ))}
                  {!recentExpenses.length ? (
                    <p className="intel-empty">Todavía no hay gastos en el periodo seleccionado.</p>
                  ) : null}
                </div>
              </Section>
            </div>

            <div className="intel-stack">
              {canWriteFinance ? (
                <Section
                  title="＋ Registrar gasto"
                  description="Captura el gasto cuando realmente corresponda al negocio, no según la fecha en que lo estás registrando."
                >
                  <form action={createStudioExpense} className="intel-expense-form">
                    <input type="hidden" name="days" value={String(days)} />
                    <label>
                      Categoría
                      <select name="category" defaultValue="" required>
                        <option value="" disabled>Selecciona</option>
                        {Object.entries(expenseCategoryLabels).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Concepto
                      <input
                        name="description"
                        placeholder="Ej. Renta septiembre"
                        maxLength={140}
                        required
                      />
                    </label>
                    <div className="intel-expense-form-grid">
                      <label>
                        Importe
                        <input
                          name="amount"
                          type="number"
                          min="0.01"
                          step="0.01"
                          inputMode="decimal"
                          placeholder="0.00"
                          required
                        />
                      </label>
                      <label>
                        Fecha efectiva
                        <input name="effective_on" type="date" defaultValue={todayDate} required />
                      </label>
                    </div>
                    <label>
                      Proveedor
                      <input name="vendor" placeholder="Opcional" maxLength={120} />
                    </label>
                    <div className="intel-expense-form-grid">
                      <label>
                        Origen de marketing
                        <input
                          name="marketing_source"
                          placeholder="Ej. meta_ads"
                          maxLength={120}
                        />
                      </label>
                      <label>
                        Campaña
                        <input
                          name="marketing_campaign"
                          placeholder="Ej. pole_septiembre"
                          maxLength={160}
                        />
                      </label>
                    </div>
                    <p className="intel-form-help">
                      Si el gasto es Publicidad, usa los mismos nombres de origen/campaña que llegan desde Asistian para calcular costo y retorno.
                    </p>
                    <label>
                      Nota
                      <textarea name="notes" placeholder="Opcional" maxLength={500} rows={3} />
                    </label>
                    <button type="submit" className="primary-button">Guardar gasto</button>
                  </form>
                </Section>
              ) : null}

              <Section
                title={currentExpenses.length ? "✓ Fuente de gastos activa" : "⚠️ Cobertura de gastos"}
                description="La calidad del resultado depende de que los gastos del periodo estén completos."
              >
                <Insight
                  tone={currentExpenses.length ? "info" : "warning"}
                  title={
                    currentExpenses.length
                      ? currentExpenses.length + " gastos registrados"
                      : "No hay gastos registrados en el periodo"
                  }
                  body={
                    currentExpenses.length
                      ? "Resultado y margen ya usan estos movimientos. Revisa que no falten renta, nómina, servicios u otros costos."
                      : "No interpretes el resultado operativo como utilidad real hasta capturar los gastos del periodo."
                  }
                />
              </Section>

              <Section title="Siguiente nivel de rentabilidad">
                <ul className="intel-unlock-list">
                  <li>Costo por clase y por hora</li>
                  <li>Rentabilidad por disciplina</li>
                  <li>Rentabilidad por horario</li>
                  <li>Retorno de publicidad por campaña</li>
                </ul>
                <div className="intel-source-note">
                  Para esas métricas necesitamos asignar costos directos a clases/disciplinas y cerrar
                  la atribución de campañas desde conversaciones.
                </div>
              </Section>
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}
