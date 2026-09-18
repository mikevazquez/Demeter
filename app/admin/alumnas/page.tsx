import Link from "next/link";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { createStudent } from "./actions";
import DuplicateStudentDialog from "./DuplicateStudentDialog";

const lifecycleLabels: Record<string, string> = {
  active: "Activa",
  inactive: "Inactiva",
  archived: "Archivada",
};

const filterLabels: Record<string, string> = {
  active: "Activas",
  inactive: "Inactivas",
  archived: "Archivadas",
};

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string; q?: string; status?: string; duplicate?: string; duplicate_state?: string }>;
}) {
  const params = await searchParams;
  const query = String(params.q ?? "").trim();
  const status = ["active", "inactive", "archived"].includes(params.status ?? "")
    ? params.status!
    : "active";

  const { supabase, studio, membership, can } = await getAdminContext(CAPABILITIES.STUDENTS_READ);
  const canEdit = can(CAPABILITIES.STUDENTS_WRITE);

  let studentsQuery = supabase
    .from("students")
    .select("id, person_id, full_name, email, phone, lifecycle_status, profile_status, created_at")
    .eq("studio_id", studio.id)
    .eq("lifecycle_status", status)
    .order("full_name");

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

  const errorMessage =
    params.error === "first_name_required"
      ? "El nombre es obligatorio."
      : params.error === "phone_invalid"
        ? "Ingresa un teléfono válido: 10 dígitos de México o un número internacional con código de país."
        : params.error === "phone_exists"
          ? "Ya existe una alumna con ese teléfono en este estudio."
          : params.error
            ? "No se pudo guardar. Revisa los datos e inténtalo de nuevo."
            : null;

  return (
    <main className="dashboard-shell">
      {duplicateStudent ? (
        <DuplicateStudentDialog
          studentName={duplicateStudent.full_name}
          archived={duplicateStudent.lifecycle_status === "archived"}
        />
      ) : null}
      <header className="topbar">
        <div>
          <Link className="back-link compact" href="/admin">
            ← Hoy
          </Link>
          <p className="eyebrow">ALUMNAS · {studio.name}</p>
          <h1 className="dashboard-title">Alumnas</h1>
          <p>Directorio, búsqueda, alta y estado del expediente.</p>
        </div>
        <div className="toolbar-actions">
          <span className="role-pill">{membership.role}</span>
        </div>
      </header>

      {params.created === "student" ? (
        <div className="notice success">Alumna creada correctamente.</div>
      ) : null}
      {errorMessage ? <div className="notice error">{errorMessage}</div> : null}

      <section className="agenda-layout">
        <div className="agenda-main">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">DIRECTORIO</p>
                <h2>{filterLabels[status]}</h2>
              </div>
              <span className="count-badge">{students?.length ?? 0}</span>
            </div>

            <form className="compact-form" method="get">
              <div className="form-split">
                <input
                  name="q"
                  type="search"
                  defaultValue={query}
                  placeholder="Buscar por nombre, teléfono o correo"
                  aria-label="Buscar alumnas"
                />
                <select name="status" defaultValue={status} aria-label="Estado de la alumna">
                  <option value="active">Activas</option>
                  <option value="inactive">Inactivas</option>
                  <option value="archived">Archivadas</option>
                </select>
              </div>
              <button className="ghost-button" type="submit">
                Buscar
              </button>
            </form>

            {(students?.length ?? 0) === 0 ? (
              <div className="empty-state">
                {query
                  ? "No encontramos alumnas que coincidan con la búsqueda."
                  : `No hay alumnas ${filterLabels[status].toLowerCase()} todavía.`}
              </div>
            ) : (
              <div className="student-list">
                {students?.map((student) => (
                  <Link
                    className="student-row"
                    key={student.id}
                    href={`/admin/alumnas/${student.id}`}
                  >
                    <div>
                      <strong>{student.full_name}</strong>
                      <span>
                        {student.phone}
                        {student.email ? ` · ${student.email}` : ""}
                      </span>
                    </div>
                    <div className="student-package-summary">
                      <strong>
                        {student.profile_status === "complete"
                          ? "Perfil completo"
                          : "Perfil incompleto"}
                      </strong>
                      <span>
                        {lifecycleLabels[student.lifecycle_status] ?? student.lifecycle_status}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </article>
        </div>

        <aside className="agenda-sidebar">
          {!canEdit ? (
            <article className="panel">
              <p>Tu rol puede consultar alumnas, pero no crear ni editar expedientes.</p>
            </article>
          ) : (
            <article id="alta-rapida" className="panel compact-panel scroll-mt-6">
              <p className="eyebrow">ALTA RÁPIDA</p>
              <h2>Nueva alumna</h2>
              <p>
                Nombre y teléfono bastan para crear el expediente. Apellido y correo son opcionales.
              </p>
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
                  aria-describedby="student-phone-help"
                />
                <small id="student-phone-help">
                  Se normaliza a E.164. En México, 10 dígitos se guardan con +52.
                </small>
                <input
                  name="email"
                  type="email"
                  placeholder="Correo opcional"
                  autoComplete="email"
                />
                <button className="primary-button" type="submit">
                  Crear alumna
                </button>
              </form>
            </article>
          )}
        </aside>
      </section>
    </main>
  );
}
