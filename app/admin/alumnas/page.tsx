import Link from "next/link";

import PendingActionButton from "@/app/admin/components/PendingActionButton";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import ContactRow from "./ContactRow";
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

function filterHref(status: string, query: string) {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (query) params.set("q", query);
  const suffix = params.toString();
  return suffix ? `/admin/alumnas?${suffix}` : "/admin/alumnas";
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

  let studentsQuery = supabase
    .from("students")
    .select(
      "id, user_id, full_name, email, phone, lifecycle_status, student_type, trial_status, created_at",
    )
    .eq("studio_id", studio.id)
    .neq("lifecycle_status", "archived")
    .order("full_name");

  if (status === "active" || status === "inactive") {
    studentsQuery = studentsQuery.eq("lifecycle_status", status);
    if (status === "active") studentsQuery = studentsQuery.neq("student_type", "trial");
  }
  if (status === "trial") {
    studentsQuery = studentsQuery
      .eq("student_type", "trial")
      .in("trial_status", ["pending", "attended", "cancelled"]);
  }
  if (status === "no_show") {
    studentsQuery = studentsQuery.eq("student_type", "trial").eq("trial_status", "no_show");
  }
  if (status === "prospect") {
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
  const needsAllStudentsQuery =
    Boolean(query) || ["active", "inactive", "trial", "no_show"].includes(status);
  const needsProspectsQuery = true;
  const [
    { data: students },
    allStudentsResult,
    { data: prospectContacts },
    acquisitionResult,
    { data: duplicateStudent },
  ] = await Promise.all([
    studentsQuery,
    needsAllStudentsQuery
      ? supabase
          .from("students")
          .select("id,lifecycle_status,student_type,trial_status")
          .eq("studio_id", studio.id)
          .neq("lifecycle_status", "archived")
      : Promise.resolve({ data: null }),
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
  ]);
  const allStudents =
    allStudentsResult.data ??
    (students ?? []).map((student) => ({
      id: student.id,
      lifecycle_status: student.lifecycle_status,
      student_type: student.student_type,
      trial_status: student.trial_status,
    }));
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

  const activeStudentsCount = (allStudents ?? []).filter(
    (item) => item.lifecycle_status === "active" && item.student_type !== "trial",
  ).length;
  const trialStudentsCount = (allStudents ?? []).filter(
    (item) =>
      item.student_type === "trial" &&
      ["pending", "attended", "cancelled"].includes(item.trial_status ?? ""),
  ).length;
  const noShowStudentsCount = (allStudents ?? []).filter(
    (item) => item.student_type === "trial" && item.trial_status === "no_show",
  ).length;
  const expiringStudentsCount = (allStudents ?? []).filter((student) => {
    const acquisition = currentAcquisitionFor(student.id);
    return Boolean(
      acquisition?.expires_on &&
      acquisition.expires_on >= today &&
      acquisition.expires_on <= sevenDaysFromToday,
    );
  }).length;
  const expiredStudentsCount = (allStudents ?? []).filter((student) => {
    if (student.student_type === "trial" || currentAcquisitionFor(student.id)) return false;
    return (acquisitionsByStudent.get(student.id) ?? []).some((item) =>
      Boolean(item.expires_on && item.expires_on < today),
    );
  }).length;

  const filteredStudents = (students ?? []).filter((student) => {
    if (status === "expiring" || status === "followup") {
      const acquisition = currentAcquisitionFor(student.id);
      return (
        (status !== "followup" || contactStage(student) === "student") &&
        Boolean(
          acquisition?.expires_on &&
          acquisition.expires_on >= today &&
          acquisition.expires_on <= sevenDaysFromToday,
        )
      );
    }

    if (status === "expired") {
      if (student.student_type === "trial" || currentAcquisitionFor(student.id)) return false;
      return (acquisitionsByStudent.get(student.id) ?? []).some((item) =>
        Boolean(item.expires_on && item.expires_on < today),
      );
    }

    return true;
  });

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

  const recommendationsCount = (allStudents ?? []).filter((student) =>
    renewalRecommended(
      contactStage(student),
      currentAcquisitionFor(student.id)?.expires_on,
      today,
      sevenDaysFromToday,
    ),
  ).length;
  const communications = await contactConversations(
    supabase,
    studio.id,
    filteredStudents.map((student) => student.id),
    status === "all" || status === "prospect" ? prospectRows.map((contact) => contact.id) : [],
    can(CAPABILITIES.SETTINGS_WRITE),
  );
  const filters = [
    { key: "all", label: "Todas", enabled: true },
    { key: "prospect", label: "Prospecto", enabled: true },
    { key: "trial", label: "Prueba", enabled: true },
    { key: "active", label: "Alumna", enabled: true },
    { key: "inactive", label: "Exalumna", enabled: true },
    { key: "followup", label: "Con recomendación", enabled: canReadProducts },
    { key: "expiring", label: "Por vencer", enabled: canReadProducts },
    { key: "expired", label: "Vencidas", enabled: canReadProducts },
    { key: "no_show", label: "No show", enabled: true },
  ];

  return (
    <main className="dashboard-shell student-directory-page crm-page">
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
          <h1>Contactos</h1>
          <p>Conversaciones, etapas y seguimiento en un solo lugar.</p>
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
      <section className="crm-summary" aria-label="Resumen de contactos">
        <Link className="crm-stat" href={filterHref("prospect", "")}>
          <span>Prospectos</span>
          <b>{allProspectRows.length}</b>
        </Link>
        <Link className="crm-stat" href={filterHref("trial", "")}>
          <span>Pruebas</span>
          <b>{trialStudentsCount}</b>
        </Link>
        <Link className="crm-stat" href={filterHref("active", "")}>
          <span>Alumnas</span>
          <b>{activeStudentsCount}</b>
        </Link>
        {canReadProducts ? (
          <Link className="crm-stat is-focus" href={filterHref("followup", "")}>
            <span>Seguimientos sugeridos</span>
            <b>{recommendationsCount}</b>
          </Link>
        ) : (
          <div className="crm-stat">
            <span>Personas registradas</span>
            <b>{allStudents.length + allProspectRows.length}</b>
          </div>
        )}
      </section>
      <form className="student-directory-search" method="get">
        {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
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

      <nav
        className="student-directory-filters student-directory-crm-toolbar"
        aria-label="Filtrar alumnas"
      >
        {filters
          .filter((filter) => filter.enabled)
          .map((filter) => (
            <Link
              key={filter.key}
              href={filterHref(filter.key, query)}
              className={`student-filter-chip${status === filter.key ? " is-active" : ""}`}
              aria-current={status === filter.key ? "page" : undefined}
            >
              {filter.label}
              {filter.key === "all" ? <small>{allStudents?.length ?? 0}</small> : null}
              {filter.key === "active" ? <small>{activeStudentsCount}</small> : null}
              {filter.key === "expiring" ? <small>{expiringStudentsCount}</small> : null}
              {filter.key === "expired" ? <small>{expiredStudentsCount}</small> : null}
              {filter.key === "trial" ? <small>{trialStudentsCount}</small> : null}
              {filter.key === "no_show" ? <small>{noShowStudentsCount}</small> : null}
              {filter.key === "prospect" ? <small>{allProspectRows.length}</small> : null}
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
              {status === "all"
                ? "Todas"
                : status === "active"
                  ? "Activas"
                  : status === "inactive"
                    ? "Inactivas"
                    : status === "expiring"
                      ? "Por vencer"
                      : status === "expired"
                        ? "Exalumnas"
                        : status === "trial"
                          ? "Alumnas de prueba"
                          : status === "no_show"
                            ? "No show"
                            : status === "prospect"
                              ? "Prospectos"
                              : "Vencidas"}
            </h2>
          </div>
          <span className="count-badge">
            {filteredStudents.length +
              (status === "all" || status === "prospect" ? prospectRows.length : 0)}
          </span>
        </div>

        {filteredStudents.length === 0 &&
        (!(status === "all" || status === "prospect") || prospectRows.length === 0) ? (
          <div className="empty-state">
            {query
              ? "No encontramos personas que coincidan con la búsqueda."
              : "No hay personas en este filtro todavía."}
          </div>
        ) : (
          <div className="student-directory-list">
            <div className="crm-list-labels" aria-hidden="true">
              <span>Persona</span>
              <span>Último mensaje</span>
              <span>Etapa y estado</span>
              <span>Próximo paso</span>
            </div>
            {filteredStudents.map((student) => {
              const acquisition = currentAcquisitionFor(student.id);
              const stage = contactStage(student);
              const recommended = renewalRecommended(
                stage,
                acquisition?.expires_on,
                today,
                sevenDaysFromToday,
              );
              const remaining = acquisition ? (visibleBalanceMap.get(acquisition.id) ?? 0) : null;
              const hasExpired = (acquisitionsByStudent.get(student.id) ?? []).some((item) =>
                Boolean(item.expires_on && item.expires_on < today),
              );
              const state = !canReadProducts
                ? "Consulta el perfil"
                : acquisition?.expires_on
                  ? "Paquete vence " + shortDate(acquisition.expires_on, studio.locale)
                  : acquisition
                    ? "Paquete sin vencimiento"
                    : hasExpired
                      ? "Paquete vencido"
                      : "Sin paquete activo";
              return (
                <ContactRow
                  key={student.id}
                  id={student.id}
                  name={student.full_name}
                  phone={student.phone}
                  userId={student.user_id}
                  stage={stage}
                  href={`/admin/alumnas/${student.id}`}
                  channel={communications.channels.get(student.id)}
                  message={communications.messages.get(student.id)?.[0]}
                  state={
                    acquisition
                      ? `${productNameMap.get(acquisition.product_template_id) ?? "Paquete"} · ${state}`
                      : state
                  }
                  next={
                    recommended
                      ? "✦ Renovación sugerida"
                      : stage === "trial"
                        ? "Revisar prueba"
                        : stage === "former"
                          ? "Revisar expediente"
                          : "Ver perfil"
                  }
                  nextDetail={
                    acquisition
                      ? acquisition.unlimited
                        ? "Clases ilimitadas"
                        : `${remaining} clases restantes`
                      : undefined
                  }
                  timeZone={timeZone}
                  locale={studio.locale}
                />
              );
            })}
            {status === "all" || status === "prospect"
              ? prospectRows.map((prospect) => (
                  <ContactRow
                    key={prospect.id}
                    id={prospect.id}
                    name={prospect.full_name}
                    phone={prospect.phone}
                    stage="prospect"
                    href={`/admin/alumnas/contactos/${prospect.id}`}
                    channel={communications.channels.get(prospect.id)}
                    message={communications.messages.get(prospect.id)?.[0]}
                    state="Sin convertir a alumna"
                    next="Ver contacto"
                    nextDetail={
                      "Recibido " + shortDate(prospect.created_at.slice(0, 10), studio.locale)
                    }
                    timeZone={timeZone}
                    locale={studio.locale}
                  />
                ))
              : null}
          </div>
        )}
      </section>
    </main>
  );
}
