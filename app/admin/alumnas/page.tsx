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
  const status = ["all", "active", "inactive"].includes(requestedStatus)
    ? requestedStatus
    : "all";

  const { supabase, studio, membership, can } = await getAdminContext(CAPABILITIES.STUDENTS_READ);
  const canEdit = can(CAPABILITIES.STUDENTS_WRITE);

  let studentsQuery = supabase
    .from("students")
    .select("id, user_id, full_name, email, phone, lifecycle_status, created_at")
    .eq("studio_id", studio.id)
    .neq("lifecycle_status", "archived")
    .order("full_name");

  if (status !== "all") {
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
    { key: "expiring", label: "Por vencer", enabled: false },
    { key: "trial", label: "De prueba", enabled: false },
    { key: "prospect", label: "Prospectos", enabled: false },
  ];

  return (
    <main className="dashboard-shell student-directory-page">
      {duplicateStudent ? <DuplicateStudentDialog studentName={duplicateStudent.full_name} /> : null}
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
          <a className="primary-button" href="#alta-rapida">
            + Nueva alumna
          </a>
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
                  : "Inactivas"}
            </h2>
          </div>
          <span className="count-badge">{students?.length ?? 0}</span>
        </div>

        {(students?.length ?? 0) === 0 ? (
          <div className="empty-state">
            {query
              ? "No encontramos personas que coincidan con la búsqueda."
              : "No hay personas en este filtro todavía."}
          </div>
        ) : (
          <div className="student-directory-list">
            {students?.map((student) => (
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
                  <span className="student-directory-meta">{student.phone}</span>
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

      {canEdit ? (
        <details id="alta-rapida" className="panel compact-panel scroll-mt-6">
          <summary className="cursor-pointer font-semibold text-white">Nueva alumna</summary>
          <div className="mt-4">
            <p>Nombre y teléfono bastan para crear el expediente.</p>
            <form action={createStudent} className="compact-form mt-4">
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
      ) : null}
    </main>
  );
}
