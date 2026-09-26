import Image from "next/image";
import Link from "next/link";

import PendingActionButton from "@/app/admin/components/PendingActionButton";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import { createStudent } from "./actions";
import DuplicateStudentDialog from "./DuplicateStudentDialog";
import StudentDeletedDialog from "./StudentDeletedDialog";
import StudentFormErrorDialog from "./StudentFormErrorDialog";

const lifecycleLabels: Record<string, string> = {
  active: "Activa",
  inactive: "Inactiva",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

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
  const params = await searchParams;
  const query = String(params.q ?? "").trim();
  const requestedStatus = String(params.status ?? "all");
  const status = ["all", "active", "inactive", "expiring", "expired"].includes(requestedStatus)
    ? requestedStatus
    : "all";

  const { supabase, studio, membership, can } = await getAdminContext(CAPABILITIES.STUDENTS_READ);
  const canEdit = can(CAPABILITIES.STUDENTS_WRITE);
  const canReadProducts = can(CAPABILITIES.PRODUCTS_READ);
  const timeZone = studio.timezone;
  const today = localDateKey(timeZone);
  const sevenDaysFromToday = addDaysToDateKey(today, 7);

  let studentsQuery = supabase
    .from("students")
    .select("id, user_id, full_name, email, phone, lifecycle_status, created_at")
    .eq("studio_id", studio.id)
    .neq("lifecycle_status", "archived")
    .order("full_name");

  if (status === "active" || status === "inactive") {
    studentsQuery = studentsQuery.eq("lifecycle_status", status);
  }

  if (query) {
    const safeQuery = query.replace(/[,%()]/g, " ").trim();
    if (safeQuery) {
      studentsQuery = studentsQuery.or(
        `full_name.ilike.%${safeQuery}%,phone.ilike.%${safeQuery}%,email.ilike.%${safeQuery}%`,
      );
    }
  }

  const { data: students } = await studentsQuery;

  const [{ data: allStudents }, acquisitionResult] = await Promise.all([
    supabase
      .from("students")
      .select("id,lifecycle_status")
      .eq("studio_id", studio.id)
      .neq("lifecycle_status", "archived"),
    canReadProducts
      ? supabase
          .from("product_acquisitions")
          .select(
            "id,student_id,product_template_id,status,starts_on,expires_on,refunded_at,created_at",
          )
          .eq("studio_id", studio.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  const allAcquisitions = acquisitionResult.data ?? [];

  const acquisitionProductIds = [
    ...new Set((allAcquisitions ?? []).map((item) => item.product_template_id).filter(Boolean)),
  ];
  const { data: acquisitionProducts } = acquisitionProductIds.length
    ? await supabase
        .from("product_templates")
        .select("id,name")
        .eq("studio_id", studio.id)
        .in("id", acquisitionProductIds)
    : { data: [] as { id: string; name: string }[] };

  const productNameMap = new Map((acquisitionProducts ?? []).map((item) => [item.id, item.name]));
  const acquisitionsByStudent = new Map<
    string,
    Array<{
      id: string;
      product_template_id: string;
      status: string;
      starts_on: string | null;
      expires_on: string | null;
      refunded_at: string | null;
      created_at: string;
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
          !item.refunded_at &&
          (!item.starts_on || item.starts_on <= today) &&
          (!item.expires_on || item.expires_on >= today),
      ) ?? null
    );
  }

  const activeStudentsCount = (allStudents ?? []).filter(
    (item) => item.lifecycle_status === "active",
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
    if (currentAcquisitionFor(student.id)) return false;
    return (acquisitionsByStudent.get(student.id) ?? []).some(
      (item) => !item.refunded_at && Boolean(item.expires_on && item.expires_on < today),
    );
  }).length;

  const filteredStudents = (students ?? []).filter((student) => {
    if (status === "expiring") {
      const acquisition = currentAcquisitionFor(student.id);
      return Boolean(
        acquisition?.expires_on &&
        acquisition.expires_on >= today &&
        acquisition.expires_on <= sevenDaysFromToday,
      );
    }

    if (status === "expired") {
      if (currentAcquisitionFor(student.id)) return false;
      return (acquisitionsByStudent.get(student.id) ?? []).some(
        (item) => !item.refunded_at && Boolean(item.expires_on && item.expires_on < today),
      );
    }

    return true;
  });

  const duplicateId = String(params.duplicate ?? "").trim();
  const { data: duplicateStudent } = duplicateId
    ? await supabase
        .from("students")
        .select("id,full_name,lifecycle_status")
        .eq("id", duplicateId)
        .eq("studio_id", studio.id)
        .maybeSingle()
    : { data: null };

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
          : params.error
            ? {
                title: "No pudimos crear la alumna",
                message: "Revisa los datos e inténtalo de nuevo.",
              }
            : null;

  const filters = [
    { key: "all", label: "Todas", enabled: true },
    { key: "active", label: "Activas", enabled: true },
    { key: "inactive", label: "Inactivas", enabled: true },
    { key: "expiring", label: "Por vencer", enabled: canReadProducts },
    { key: "expired", label: "Vencidas", enabled: canReadProducts },
    { key: "trial", label: "De prueba", enabled: false },
    { key: "prospect", label: "Prospectos", enabled: false },
  ];

  return (
    <main className="dashboard-shell student-directory-page">
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
          <p className="eyebrow">ALUMNAS · {studio.name}</p>
          <h1>Alumnas</h1>
          <p>Encuentra a una persona y entra a su Perfil 360.</p>
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

        <form className="student-directory-search" method="get">
          {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
          <input
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Buscar por nombre, teléfono o correo"
            aria-label="Buscar alumnas"
          />
        </form>
      </header>

      <section className="student-directory-kpis" aria-label="Resumen de alumnas">
        <article className="student-directory-kpi is-active">
          <span className="student-kpi-icon" aria-hidden="true">
            ◎
          </span>
          <span>
            <strong>{activeStudentsCount}</strong>
            <small>Alumnas activas</small>
          </span>
        </article>
        <article className="student-directory-kpi is-expiring">
          <span className="student-kpi-icon" aria-hidden="true">
            ◷
          </span>
          <span>
            <strong>{expiringStudentsCount}</strong>
            <small>Por vencer · 7 días</small>
          </span>
        </article>
        <article className="student-directory-kpi is-expired">
          <span className="student-kpi-icon" aria-hidden="true">
            !
          </span>
          <span>
            <strong>{expiredStudentsCount}</strong>
            <small>Vencidas</small>
          </span>
        </article>
        <article className="student-directory-kpi is-total">
          <span className="student-kpi-icon" aria-hidden="true">
            ◉
          </span>
          <span>
            <strong>{allStudents?.length ?? 0}</strong>
            <small>Total</small>
          </span>
        </article>
      </section>

      <nav className="student-directory-filters" aria-label="Filtrar alumnas">
        {filters.map((filter) =>
          filter.enabled ? (
            <Link
              key={filter.key}
              href={filterHref(filter.key, query)}
              className={`student-filter-chip${status === filter.key ? " is-active" : ""}`}
            >
              {filter.label}
            </Link>
          ) : (
            <span
              key={filter.key}
              className="student-filter-chip is-future"
              aria-disabled="true"
              title={
                filter.key === "expiring"
                  ? "Se conectará a la regla configurable de paquete por vencer."
                  : "Estado preparado para una fase futura."
              }
            >
              {filter.label}
            </span>
          ),
        )}
      </nav>

      {params.created === "student" ? (
        <div className="notice success">Alumna creada correctamente.</div>
      ) : null}

      <section className="panel">
        <div className="panel-heading">
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
                      : "Vencidas"}
            </h2>
          </div>
          <span className="count-badge">{filteredStudents.length}</span>
        </div>

        {filteredStudents.length === 0 ? (
          <div className="empty-state">
            {query
              ? "No encontramos personas que coincidan con la búsqueda."
              : "No hay personas en este filtro todavía."}
          </div>
        ) : (
          <div className="student-directory-list">
            {filteredStudents.map((student) => (
              <Link
                className="student-directory-card"
                key={student.id}
                href={`/admin/alumnas/${student.id}`}
              >
                <span className="student-avatar" aria-hidden="true">
                  {initials(student.full_name)}
                  {student.user_id ? (
                    <Image
                      src={`/admin/alumnas/${student.id}/avatar`}
                      alt=""
                      width={46}
                      height={46}
                      unoptimized
                    />
                  ) : null}
                </span>
                <span className="student-directory-main">
                  <strong>{student.full_name}</strong>
                  <span className="student-directory-meta">
                    {student.email || student.phone}
                    {student.email && student.phone ? <small>{student.phone}</small> : null}
                  </span>
                  {(() => {
                    const acquisition = currentAcquisitionFor(student.id);
                    if (!acquisition) {
                      const hasExpired = (acquisitionsByStudent.get(student.id) ?? []).some(
                        (item) =>
                          !item.refunded_at && Boolean(item.expires_on && item.expires_on < today),
                      );
                      return (
                        <span
                          className={`student-package-summary${hasExpired ? " is-expired" : ""}`}
                        >
                          <b>{hasExpired ? "Paquete vencido" : "Sin paquete activo"}</b>
                          <small>{hasExpired ? "Revisar renovación" : "Sin vigencia actual"}</small>
                        </span>
                      );
                    }
                    return (
                      <span className="student-package-summary">
                        <b>
                          {productNameMap.get(acquisition.product_template_id) ?? "Paquete activo"}
                        </b>
                        <small>{shortDate(acquisition.expires_on, studio.locale)}</small>
                      </span>
                    );
                  })()}
                  <span
                    className={`student-state-pill is-${student.lifecycle_status === "inactive" ? "inactive" : "active"}`}
                  >
                    {lifecycleLabels[student.lifecycle_status] ?? student.lifecycle_status}
                  </span>
                </span>
                <span className="student-directory-arrow" aria-hidden="true">
                  ›
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
