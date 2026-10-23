import { resolveEnrollmentStatus } from "@/lib/assistant/enrollment-state";
import Link from "next/link";

import PendingActionButton from "@/app/admin/components/PendingActionButton";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import ContactRow, { type DirectoryTone } from "./ContactRow";
import { contactStage, renewalRecommended, type ContactStage } from "@/lib/student-crm";

import { createStudent } from "./actions";
import DuplicateStudentDialog from "./DuplicateStudentDialog";
import StudentDeletedDialog from "./StudentDeletedDialog";
import StudentFormErrorDialog from "./StudentFormErrorDialog";
import {
  DIRECTORY_ATTENTION,
  DIRECTORY_ATTENTION_LABELS,
  DIRECTORY_STAGES,
  DIRECTORY_STAGE_LABELS,
  directoryHref,
  resolveDirectoryFilters,
  type DirectoryAttention,
} from "./directory-filters";

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
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

const toneOrder: Record<DirectoryTone, number> = { bad: 0, warn: 1, info: 2, ok: 3 };

/**
 * Alumnas · directorio (P360-V2-07).
 * Estado como selector único (Todas · Prospectos · Prueba · Alumnas · Exalumnas) y un filtro
 * aparte de Atención. Cada fila muestra el siguiente paso; quien tiene pendientes va primero.
 */
export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    created?: string;
    q?: string;
    status?: string;
    att?: string;
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
  const { stage: stageFilter, attention } = resolveDirectoryFilters(params.status, params.att);
  const canEdit = can(CAPABILITIES.STUDENTS_WRITE);
  const canReadProducts = can(CAPABILITIES.PRODUCTS_READ);
  const canReadSales = can(CAPABILITIES.SALES_READ);
  const timeZone = studio.timezone;
  const today = localDateKey(timeZone);
  const sevenDaysFromToday = addDaysToDateKey(today, 7);

  let studentsQuery = supabase
    .from("students")
    .select(
      "id, user_id, full_name, email, phone, lifecycle_status, student_type, trial_status, created_at",
    )
    .eq("studio_id", studio.id)
    .neq("lifecycle_status", "archived")
    .order("full_name");

  if (stageFilter === "prospect") {
    studentsQuery = studentsQuery.limit(0);
  }

  if (query) {
    const safeQuery = query.replace(/[,%()]/g, " ").trim();
    if (safeQuery) {
      studentsQuery = studentsQuery.or(
        `full_name.ilike.%${safeQuery}%,phone.ilike.%${safeQuery}%,email.ilike.%${safeQuery}%`,
      );
    }
  }

  const duplicateId = String(params.duplicate ?? "").trim();
  const [
    { data: students },
    allStudentsResult,
    { data: prospectContacts },
    acquisitionResult,
    { data: duplicateStudent },
    enrollmentResult,
    transferResult,
    chargeResult,
  ] = await Promise.all([
    studentsQuery,
    supabase
      .from("students")
      .select("id,lifecycle_status,student_type,trial_status")
      .eq("studio_id", studio.id)
      .neq("lifecycle_status", "archived"),
    supabase
      .from("crm_contacts")
      .select("id,person_id,created_at")
      .eq("studio_id", studio.id)
      .eq("lifecycle_status", "prospect")
      .is("converted_student_id", null)
      .order("created_at", { ascending: false }),
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
    canReadSales
      ? supabase
          .from("assistant_transfer_purchase_intents")
          .select("student_id")
          .eq("studio_id", studio.id)
          .eq("status", "provisional_active")
      : Promise.resolve({ data: [] as { student_id: string | null }[] }),
    canReadSales
      ? supabase
          .from("student_operating_charges")
          .select("student_id")
          .eq("studio_id", studio.id)
          .eq("status", "pending")
      : Promise.resolve({ data: [] as { student_id: string | null }[] }),
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
  const allStudents = allStudentsResult.data ?? [];
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
  const prospectRows = allProspectRows.filter((prospect) => {
    if (!query) return true;
    const needle = query.toLocaleLowerCase("es-MX");
    return (
      prospect.full_name.toLocaleLowerCase("es-MX").includes(needle) ||
      prospect.phone.includes(query)
    );
  });
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

  for (const acquisition of acquisitionResult.data ?? []) {
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
  function hasExpiredPackage(studentId: string) {
    return (acquisitionsByStudent.get(studentId) ?? []).some((item) =>
      Boolean(item.expires_on && item.expires_on < today),
    );
  }
  function isExpiring(studentId: string) {
    const acquisition = currentAcquisitionFor(studentId);
    return Boolean(
      acquisition?.expires_on &&
      acquisition.expires_on >= today &&
      acquisition.expires_on <= sevenDaysFromToday,
    );
  }
  const transferStudents = new Set(
    (transferResult.data ?? []).map((row) => row.student_id).filter(Boolean),
  );
  const chargeStudents = new Set(
    (chargeResult.data ?? []).map((row) => row.student_id).filter(Boolean),
  );

  /** Primer pendiente de la persona, con la misma prioridad que el Resumen del Perfil 360. */
  function pendingFor(student: {
    id: string;
    user_id?: string | null;
    lifecycle_status: string;
    stage: ContactStage;
  }) {
    const items: Array<{ tone: DirectoryTone; text: string }> = [];
    const active = student.lifecycle_status !== "inactive";
    if (transferStudents.has(student.id))
      items.push({ tone: "bad", text: "Transferencia por validar" });
    if (chargeStudents.has(student.id)) items.push({ tone: "bad", text: "Penalización pendiente" });
    if (canReadProducts && active && student.stage !== "former") {
      const acquisition = currentAcquisitionFor(student.id);
      if (!acquisition) {
        items.push({
          tone: "warn",
          text: hasExpiredPackage(student.id) ? "Paquete vencido" : "Sin paquete activo",
        });
      } else if (
        renewalRecommended(student.stage, acquisition.expires_on, today, sevenDaysFromToday)
      ) {
        items.push({
          tone: "warn",
          text: `Paquete por vencer · ${shortDate(acquisition.expires_on, studio.locale)}`,
        });
      }
    }
    if (active && !student.user_id)
      items.push({ tone: "info", text: "Acceso a la app no enviado" });
    return items;
  }

  function matchesAttention(
    student: { id: string; student_type?: string | null; trial_status?: string | null },
    pending: Array<{ tone: DirectoryTone }>,
    filter: DirectoryAttention | null,
  ) {
    if (!filter) return true;
    if (filter === "pending") return pending.some((item) => item.tone !== "info");
    if (filter === "expiring") return isExpiring(student.id);
    if (filter === "expired") {
      return (
        student.student_type !== "trial" &&
        !currentAcquisitionFor(student.id) &&
        hasExpiredPackage(student.id)
      );
    }
    return student.student_type === "trial" && student.trial_status === "no_show";
  }

  const stageCounts: Record<string, number> = {
    all: allStudents.length + allProspectRows.length,
    prospect: allProspectRows.length,
    trial: 0,
    student: 0,
    former: 0,
  };
  for (const student of allStudents) stageCounts[stageFor(student)] += 1;

  const rows = (students ?? [])
    .map((student) => {
      const stage = stageFor(student);
      return { student, stage, pending: pendingFor({ ...student, stage }) };
    })
    .filter(({ stage }) => stageFilter === "all" || stage === stageFilter)
    .filter(({ student, pending }) => matchesAttention(student, pending, attention))
    .sort((a, b) => {
      const toneA = a.pending[0] ? toneOrder[a.pending[0].tone] : toneOrder.ok;
      const toneB = b.pending[0] ? toneOrder[b.pending[0].tone] : toneOrder.ok;
      return toneA - toneB || a.student.full_name.localeCompare(b.student.full_name, "es");
    });
  const showProspects = (stageFilter === "all" || stageFilter === "prospect") && !attention;

  const visibleCurrentAcquisitions = rows
    .map(({ student }) => currentAcquisitionFor(student.id))
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

  const attentionOptions = DIRECTORY_ATTENTION.filter(
    (item) => canReadProducts || item === "no_show" || item === "pending",
  );
  const total = rows.length + (showProspects ? prospectRows.length : 0);

  return (
    <main className="dashboard-shell student-directory-page crm-page p360v2-directory">
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
                  <p>
                    Nombre y teléfono bastan para crear el expediente. Su acceso a la app le llega
                    por WhatsApp.
                  </p>
                </div>
              </div>
              <form action={createStudent} className="compact-form">
                <div className="form-split">
                  <input
                    name="first_name"
                    aria-label="Nombre"
                    required
                    placeholder="Nombre"
                    autoComplete="given-name"
                  />
                  <input
                    name="last_name"
                    aria-label="Apellido"
                    placeholder="Apellido opcional"
                    autoComplete="family-name"
                  />
                </div>
                <input
                  name="phone"
                  aria-label="Teléfono"
                  type="tel"
                  inputMode="tel"
                  required
                  placeholder="Teléfono · 10 dígitos"
                  autoComplete="tel"
                />
                <input
                  name="email"
                  aria-label="Correo"
                  type="email"
                  placeholder="Correo opcional"
                  autoComplete="email"
                />
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

      <form className="student-directory-search" method="get">
        {stageFilter !== "all" ? <input type="hidden" name="status" value={stageFilter} /> : null}
        {attention ? <input type="hidden" name="att" value={attention} /> : null}
        <input
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Buscar por nombre, teléfono o correo"
          aria-label="Buscar alumnas"
        />
        <button className="crm-btn" type="submit">
          Buscar
        </button>
      </form>

      <nav className="p360v2-segment" aria-label="Estado">
        {DIRECTORY_STAGES.map((item) => (
          <Link
            key={item}
            href={directoryHref(item, attention, query)}
            className={stageFilter === item ? "is-active" : ""}
            aria-current={stageFilter === item ? "page" : undefined}
          >
            {DIRECTORY_STAGE_LABELS[item]}
            <small>{stageCounts[item]}</small>
          </Link>
        ))}
      </nav>

      <nav className="p360v2-chips p360v2-attention" aria-label="Atención">
        {attentionOptions.map((item) => (
          <Link
            key={item}
            href={directoryHref(stageFilter, attention === item ? null : item, query)}
            className={attention === item ? "is-active" : ""}
            aria-current={attention === item ? "page" : undefined}
          >
            {DIRECTORY_ATTENTION_LABELS[item]}
          </Link>
        ))}
      </nav>

      {params.created === "student" ? (
        <div className="notice success">Alumna creada correctamente.</div>
      ) : null}

      <section className="panel">
        <div className="panel-heading crm-directory-heading">
          <div>
            <p className="eyebrow">DIRECTORIO</p>
            <h2>
              {DIRECTORY_STAGE_LABELS[stageFilter]}
              {attention ? ` · ${DIRECTORY_ATTENTION_LABELS[attention]}` : ""}
            </h2>
          </div>
          <span className="count-badge">{total}</span>
        </div>

        {total === 0 ? (
          <div className="empty-state">
            {query
              ? "No encontramos personas que coincidan con la búsqueda."
              : "No hay personas con estos filtros."}
          </div>
        ) : (
          <div className="student-directory-list">
            {rows.map(({ student, stage, pending }) => {
              const acquisition = currentAcquisitionFor(student.id);
              const remaining = acquisition ? (visibleBalanceMap.get(acquisition.id) ?? 0) : null;
              const first = pending[0];
              const next = first
                ? first.text
                : acquisition && canReadProducts
                  ? `${productNameMap.get(acquisition.product_template_id) ?? "Paquete"} · ${
                      acquisition.unlimited ? "ilimitado" : `${remaining} clases`
                    } · vence ${shortDate(acquisition.expires_on, studio.locale)}`
                  : "Al día";
              return (
                <ContactRow
                  key={student.id}
                  id={student.id}
                  name={student.full_name}
                  phone={student.phone}
                  userId={student.user_id}
                  stage={stage}
                  href={`/admin/alumnas/${student.id}`}
                  next={next}
                  tone={first?.tone ?? "ok"}
                  extra={pending.length > 1 ? pending.length - 1 : undefined}
                />
              );
            })}
            {showProspects
              ? prospectRows.map((prospect) => (
                  <ContactRow
                    key={prospect.id}
                    id={prospect.id}
                    name={prospect.full_name}
                    phone={prospect.phone}
                    stage="prospect"
                    href={`/admin/alumnas/contactos/${prospect.id}`}
                    next={`Prospecto desde ${shortDate(prospect.created_at.slice(0, 10), studio.locale)}`}
                    tone="info"
                  />
                ))
              : null}
          </div>
        )}
      </section>
    </main>
  );
}
