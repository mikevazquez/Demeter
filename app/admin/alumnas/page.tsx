import { resolveEnrollmentStatus } from "@/lib/assistant/enrollment-state";

import PendingActionButton from "@/app/admin/components/PendingActionButton";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import CrmBoard, { type CrmPerson } from "./CrmBoard";
import { contactStage, renewalRecommended } from "@/lib/student-crm";
import { contactConversations } from "@/lib/student-crm-conversations";

import { createStudent } from "./actions";
import DuplicateStudentDialog from "./DuplicateStudentDialog";
import StudentDeletedDialog from "./StudentDeletedDialog";
import StudentFormErrorDialog from "./StudentFormErrorDialog";

function localDateKey(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addDaysToDateKey(value: string, days: number) {
  const next = new Date(`${value}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, "0"),
    String(next.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function shortDate(value: string | null, locale: string) {
  if (!value) return "Sin vencimiento";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    created?: string;
    q?: string;
    status?: string;
    duplicate?: string;
    deleted?: string;
    cancelled?: string;
  }>;
}) {
  const [params, { supabase, studio, membership, can }] = await Promise.all([
    searchParams,
    getAdminContext(CAPABILITIES.STUDENTS_READ),
  ]);
  const query = String(params.q ?? "").trim();
  const requestedStatus = String(params.status ?? "all");
  const status = [
    "all",
    "active",
    "inactive",
    "expiring",
    "expired",
    "trial",
    "no_show",
    "prospect",
    "followup",
  ].includes(requestedStatus)
    ? requestedStatus
    : "all";
  const canEdit = can(CAPABILITIES.STUDENTS_WRITE);
  const canReadProducts = can(CAPABILITIES.PRODUCTS_READ);
  const timeZone = studio.timezone;
  const today = localDateKey(timeZone);
  const sevenDaysFromToday = addDaysToDateKey(today, 7);

  const studentsQuery = supabase
    .from("students")
    .select(
      "id, user_id, full_name, email, phone, lifecycle_status, student_type, trial_status, created_at",
    )
    .eq("studio_id", studio.id)
    .neq("lifecycle_status", "archived")
    .order("full_name");

  const duplicateId = String(params.duplicate ?? "").trim();
  const needsProspectsQuery = true;
  const [
    { data: students },
    { data: prospectContacts },
    acquisitionResult,
    { data: duplicateStudent },
    enrollmentResult,
  ] = await Promise.all([
    studentsQuery,
    needsProspectsQuery
      ? supabase
          .from("crm_contacts")
          .select("id,person_id,created_at")
          .eq("studio_id", studio.id)
          .eq("lifecycle_status", "prospect")
          .is("converted_student_id", null)
          .order("created_at", { ascending: false })
      : Promise.resolve({
          data: [] as { id: string; person_id: string; created_at: string }[],
        }),
    canReadProducts
      ? supabase
          .from("product_acquisitions")
          .select(
            "id,student_id,product_template_id,status,starts_on,expires_on,created_at,unlimited,credit_limit",
          )
          .eq("studio_id", studio.id)
          .is("refunded_at", null)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    duplicateId
      ? supabase
          .from("students")
          .select("id,full_name,lifecycle_status")
          .eq("id", duplicateId)
          .eq("studio_id", studio.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("student_enrollments")
      .select("student_id,status,starts_on,expires_on")
      .eq("studio_id", studio.id)
      .is("refunded_at", null),
  ]);
  if (enrollmentResult.error) throw new Error("crm_enrollment_unavailable");
  const stageFor = (student: Parameters<typeof contactStage>[0] & { id: string }) =>
    contactStage({
      ...student,
      enrollment_status: resolveEnrollmentStatus(
        (enrollmentResult.data ?? []).filter((row) => row.student_id === student.id),
        today,
      ),
    });
  const prospectPersonIds = [
    ...new Set((prospectContacts ?? []).map((contact) => contact.person_id)),
  ];
  const [{ data: prospectPeople }, { data: prospectPhones }] = await Promise.all([
    prospectPersonIds.length
      ? supabase
          .from("persons")
          .select("id,first_name,last_name")
          .eq("studio_id", studio.id)
          .in("id", prospectPersonIds)
      : Promise.resolve({
          data: [] as { id: string; first_name: string; last_name: string | null }[],
        }),
    prospectPersonIds.length
      ? supabase
          .from("person_contacts")
          .select("person_id,value,is_primary")
          .eq("studio_id", studio.id)
          .eq("kind", "phone")
          .in("person_id", prospectPersonIds)
      : Promise.resolve({
          data: [] as { person_id: string; value: string; is_primary: boolean }[],
        }),
  ]);
  const peopleById = new Map((prospectPeople ?? []).map((person) => [person.id, person]));
  const phoneByPersonId = new Map<string, string>();
  for (const contact of prospectPhones ?? []) {
    if (!phoneByPersonId.has(contact.person_id) || contact.is_primary) {
      phoneByPersonId.set(contact.person_id, contact.value);
    }
  }
  const allProspectRows = (prospectContacts ?? []).map((contact) => {
    const person = peopleById.get(contact.person_id);
    return {
      id: contact.id,
      created_at: contact.created_at,
      full_name: [person?.first_name, person?.last_name].filter(Boolean).join(" ") || "Prospecto",
      phone: phoneByPersonId.get(contact.person_id) ?? "Sin teléfono",
    };
  });
  const prospectRows = allProspectRows;
  const allAcquisitions = acquisitionResult.data ?? [];
  const acquisitionsByStudent = new Map<
    string,
    Array<{
      id: string;
      product_template_id: string;
      status: string;
      starts_on: string | null;
      expires_on: string | null;
      created_at: string;
      unlimited: boolean;
      credit_limit: number | null;
    }>
  >();

  for (const acquisition of allAcquisitions ?? []) {
    const list = acquisitionsByStudent.get(acquisition.student_id) ?? [];
    list.push(acquisition);
    acquisitionsByStudent.set(acquisition.student_id, list);
  }

  function currentAcquisitionFor(studentId: string) {
    return (
      (acquisitionsByStudent.get(studentId) ?? []).find(
        (item) =>
          item.status === "active" &&
          (!item.starts_on || item.starts_on <= today) &&
          (!item.expires_on || item.expires_on >= today),
      ) ?? null
    );
  }

  const filteredStudents = (students ?? []).filter(
    (student) => student.lifecycle_status === "active",
  );

  const visibleCurrentAcquisitions = filteredStudents
    .map((student) => currentAcquisitionFor(student.id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const visibleAcquisitionIds = visibleCurrentAcquisitions.map((item) => item.id);
  const visibleProductIds = [
    ...new Set(visibleCurrentAcquisitions.map((item) => item.product_template_id)),
  ];
  const [{ data: acquisitionProducts }, { data: visibleLedgerRows }] = await Promise.all([
    visibleProductIds.length
      ? supabase
          .from("product_templates")
          .select("id,name")
          .eq("studio_id", studio.id)
          .in("id", visibleProductIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    canReadProducts && visibleAcquisitionIds.length
      ? supabase
          .from("credit_ledger")
          .select("acquisition_id,quantity")
          .eq("studio_id", studio.id)
          .in("acquisition_id", visibleAcquisitionIds)
      : Promise.resolve({ data: [] as { acquisition_id: string; quantity: number }[] }),
  ]);
  const productNameMap = new Map((acquisitionProducts ?? []).map((item) => [item.id, item.name]));
  const visibleBalanceMap = new Map<string, number>();
  for (const row of visibleLedgerRows ?? []) {
    visibleBalanceMap.set(
      row.acquisition_id,
      (visibleBalanceMap.get(row.acquisition_id) ?? 0) + row.quantity,
    );
  }

  const errorDialog =
    params.error === "first_name_required"
      ? { title: "Falta el nombre", message: "Escribe el nombre de la alumna para continuar." }
      : params.error === "phone_invalid"
        ? {
            title: "El teléfono no es válido",
            message: "Ingresa 10 dígitos de México o un número internacional con código de país.",
          }
        : params.error === "phone_exists"
          ? {
              title: "Este teléfono ya está registrado",
              message: "Ya existe una alumna con este teléfono en el estudio.",
            }
          : params.error === "plan_limit_active_students"
            ? {
                title: "Límite de alumnas alcanzado",
                message:
                  "Tu plan ya alcanzó el máximo de alumnas activas. Archiva una alumna que ya no esté activa o cambia de plan para continuar.",
              }
            : params.error
              ? {
                  title: "No pudimos crear la alumna",
                  message: "Revisa los datos e inténtalo de nuevo.",
                }
              : null;

  const communications = await contactConversations(
    supabase,
    studio.id,
    filteredStudents.map((student) => student.id),
    prospectRows.map((contact) => contact.id),
    can(CAPABILITIES.SETTINGS_WRITE),
  );
  const [salesResult, paymentsResult, transferResult, reservationsResult] = await Promise.all([
    supabase.from("sales").select("id,student_id,status,total_minor").eq("studio_id", studio.id),
    supabase.from("payments").select("sale_id,amount_minor,kind").eq("studio_id", studio.id),
    supabase
      .from("assistant_transfer_purchase_intents")
      .select("student_id,sale_id,amount_minor")
      .eq("studio_id", studio.id)
      .eq("status", "provisional_active"),
    supabase
      .from("reservations")
      .select(
        "student_id,status,commercial_status,class_kind,class_amount_minor,booked_at,session_id",
      )
      .eq("studio_id", studio.id)
      .in("status", ["reserved", "attended", "no_show"])
      .order("booked_at", { ascending: false }),
  ]);
  if (salesResult.error || paymentsResult.error || transferResult.error || reservationsResult.error)
    throw new Error(
      `crm_financial_data_unavailable: ${[
        salesResult.error,
        paymentsResult.error,
        transferResult.error,
        reservationsResult.error,
      ]
        .filter(Boolean)
        .map((e) => e?.message)
        .join("; ")}`,
    );
  const unvalidatedSales = new Set(
    (transferResult.data ?? []).map((t) => t.sale_id).filter(Boolean),
  );
  const debtByStudent = new Map<string, number>();
  for (const sale of salesResult.data ?? []) {
    if (["cancelled", "voided"].includes(sale.status) || unvalidatedSales.has(sale.id)) continue;
    const paid = (paymentsResult.data ?? [])
      .filter((p) => p.sale_id === sale.id)
      .reduce((n, p) => n + (p.kind === "payment" ? p.amount_minor : 0), 0);
    debtByStudent.set(
      sale.student_id,
      (debtByStudent.get(sale.student_id) ?? 0) + Math.max(0, sale.total_minor - paid),
    );
  }
  const money = (value: number) =>
    new Intl.NumberFormat(studio.locale, {
      style: "currency",
      currency: studio.currency,
      maximumFractionDigits: 0,
    }).format(value / 100);
  const boardPeople: CrmPerson[] = filteredStudents.map((student) => {
    const stage = stageFor(student);
    const acquisition = currentAcquisitionFor(student.id);
    const remaining = acquisition ? (visibleBalanceMap.get(acquisition.id) ?? 0) : null;
    const reservations = (reservationsResult.data ?? []).filter((r) => r.student_id === student.id);
    const trial = reservations.find((r) => r.class_kind === "trial");
    const transfer = (transferResult.data ?? []).find((t) => t.student_id === student.id);
    const pendingClass = reservations.find((r) => r.commercial_status === "payment_pending");
    const debt = debtByStudent.get(student.id) ?? 0;
    let column = "contacto";
    let context =
      communications.messages.get(student.id)?.[0]?.content ?? student.phone ?? "Primer contacto";
    if (stage === "former") {
      column = "ex";
      context = "Su inscripción anual venció";
    } else if (stage === "student") {
      if (transfer || debt > 0 || pendingClass) {
        column = "pagoa";
        context = transfer
          ? `Comprobante de ${money(transfer.amount_minor)} por validar`
          : debt > 0
            ? `Debe ${money(debt)}`
            : `Cobro de ${money(pendingClass?.class_amount_minor ?? 0)} pendiente`;
      } else if (
        acquisition &&
        (renewalRecommended(stage, acquisition.expires_on, today, sevenDaysFromToday) ||
          (!acquisition.unlimited && remaining !== null && remaining <= 1))
      ) {
        column = "porvencer";
        context = `${acquisition.unlimited ? "Ilimitado" : `${remaining} clases`} · vence ${shortDate(acquisition.expires_on, studio.locale)}`;
      } else if (acquisition) {
        column = "activa";
        context = `${productNameMap.get(acquisition.product_template_id) ?? "Paquete"} · ${acquisition.unlimited ? "Ilimitado" : `quedan ${remaining}`}`;
      } else {
        column = "vencida";
        context = "Inscrita, sin paquete activo";
      }
    } else if (trial || stage === "trial") {
      if (trial?.status === "no_show" || student.trial_status === "no_show") {
        column = "noshow";
        context = "Faltó a su clase de prueba";
      } else if (trial?.status === "attended" || student.trial_status === "attended") {
        column = "pagoins";
        context = "Tomó su prueba · falta inscripción";
      } else if (trial?.commercial_status === "payment_pending") {
        column = "pagop";
        context = "Prueba reservada · sin pago";
      } else {
        column = "agendada";
        context = "Prueba pagada · por asistir";
      }
    }
    return {
      id: student.id,
      name: student.full_name,
      phone: student.phone ?? "",
      href: `/admin/alumnas/${student.id}`,
      column,
      context,
    };
  });
  for (const prospect of prospectRows)
    boardPeople.push({
      id: prospect.id,
      name: prospect.full_name,
      phone: prospect.phone,
      href: `/admin/alumnas/contactos/${prospect.id}`,
      column: "contacto",
      context: communications.messages.get(prospect.id)?.[0]?.content ?? "Pidió información",
    });

  return (
    <main className="portal-page dashboard-shell student-directory-page crm-page">
      {duplicateStudent ? (
        <DuplicateStudentDialog studentName={duplicateStudent.full_name} />
      ) : null}
      {errorDialog ? (
        <StudentFormErrorDialog title={errorDialog.title} message={errorDialog.message} />
      ) : null}
      {params.deleted === "1" ? (
        <StudentDeletedDialog cancelledReservations={Number(params.cancelled ?? 0)} />
      ) : null}

      <header className="student-directory-header">
        <div>
          <p className="eyebrow">CRM DE ALUMNAS · {studio.name}</p>
          <h1>Alumnas</h1>
          <p>Prospectos, pruebas y alumnas en un solo lugar.</p>
        </div>
        {canEdit ? (
          <details id="alta-rapida" className="student-quick-create">
            <summary aria-label="Nueva alumna" title="Nueva alumna">
              <span aria-hidden="true">+</span>
              <span className="student-quick-create-label">Nueva alumna</span>
            </summary>
            <div className="student-quick-create-panel">
              <div className="student-quick-create-heading">
                <div>
                  <p className="eyebrow">ALTA RÁPIDA</p>
                  <h2>Nueva alumna</h2>
                  <p>Nombre y teléfono bastan para crear el expediente.</p>
                </div>
              </div>
              <form action={createStudent} className="compact-form">
                <div className="form-split">
                  <input
                    name="first_name"
                    required
                    placeholder="Nombre"
                    autoComplete="given-name"
                  />
                  <input
                    name="last_name"
                    placeholder="Apellido opcional"
                    autoComplete="family-name"
                  />
                </div>
                <input
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  required
                  placeholder="Teléfono · 10 dígitos"
                  autoComplete="tel"
                />
                <input
                  name="email"
                  type="email"
                  placeholder="Correo opcional"
                  autoComplete="email"
                />
                <label>
                  Origen
                  <select name="acquisition_source" defaultValue="">
                    <option value="">Sin origen registrado</option>
                    {[
                      "Instagram",
                      "TikTok",
                      "Facebook",
                      "Google",
                      "Recomendación",
                      "Visita al estudio",
                      "Otro",
                    ].map((source) => (
                      <option key={source}>{source}</option>
                    ))}
                  </select>
                </label>
                <PendingActionButton className="primary-button" pendingLabel="Creando alumna…">
                  Crear alumna
                </PendingActionButton>
              </form>
            </div>
          </details>
        ) : (
          <span className="role-pill">{membership.role}</span>
        )}
      </header>
      {params.created === "student" ? (
        <div className="notice success">Alumna creada correctamente.</div>
      ) : null}
      <CrmBoard people={boardPeople} initialQuery={query} />
    </main>
  );
}
