import Link from "next/link";
import { notFound } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { setInstructorStatus } from "../actions";

export default async function InstructorProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ instructorId: string }>;
  searchParams: Promise<{ created?: string; saved?: string; error?: string }>;
}) {
  const { instructorId } = await params;
  const query = await searchParams;
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.INSTRUCTORS_READ);
  const canWrite = can(CAPABILITIES.INSTRUCTORS_WRITE);

  const { data: instructor } = await supabase
    .from("instructors")
    .select("id, person_id, status, bio, created_at")
    .eq("id", instructorId)
    .eq("studio_id", studio.id)
    .maybeSingle();
  if (!instructor) notFound();

  const [{ data: person }, { data: contacts }, { data: links }, { data: disciplines }] =
    await Promise.all([
      supabase
        .from("persons")
        .select("first_name, last_name")
        .eq("id", instructor.person_id)
        .maybeSingle(),
      supabase
        .from("person_contacts")
        .select("kind, value, is_primary")
        .eq("person_id", instructor.person_id),
      supabase
        .from("instructor_disciplines")
        .select("discipline_id")
        .eq("instructor_id", instructor.id),
      supabase.from("disciplines").select("id, name").eq("studio_id", studio.id).order("name"),
    ]);
  const linkedIds = new Set((links ?? []).map((item) => item.discipline_id));
  const name = [person?.first_name, person?.last_name].filter(Boolean).join(" ") || "Instructor";
  const phone = contacts?.find((item) => item.kind === "phone")?.value;
  const email = contacts?.find((item) => item.kind === "email")?.value;

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <Link className="back-link compact" href="/admin/instructores">
            ← Instructores
          </Link>
          <p className="eyebrow">PERFIL INSTRUCTOR · {studio.name}</p>
          <h1 className="dashboard-title">{name}</h1>
          <p>Perfil operativo independiente de su cuenta de acceso.</p>
        </div>
        <span className="role-pill">{instructor.status === "active" ? "ACTIVO" : "INACTIVO"}</span>
      </header>
      {query.created ? (
        <div className="notice success">Instructor creado correctamente.</div>
      ) : null}
      {query.saved ? <div className="notice success">Estado actualizado.</div> : null}
      {query.error ? <div className="notice error">No se pudo guardar el cambio.</div> : null}

      <section className="panel-grid">
        <article className="panel">
          <p className="eyebrow">CONTACTO</p>
          <h2>Datos del instructor</h2>
          <div className="student-list">
            <div className="student-row">
              <div>
                <strong>{name}</strong>
                <span>{phone || "Sin teléfono"}</span>
                <span>{email || "Sin correo"}</span>
              </div>
            </div>
            {instructor.bio ? (
              <div className="student-row">
                <div>
                  <strong>Bio / especialidad</strong>
                  <span>{instructor.bio}</span>
                </div>
              </div>
            ) : null}
          </div>
        </article>
        <article className="panel">
          <p className="eyebrow">ACCESO</p>
          <h2>Cuenta separada</h2>
          <div className="empty-state">
            Este perfil no crea credenciales automáticamente. La vinculación de UserAccount +
            membership INSTRUCTOR se realiza mediante el flujo de acceso, sin convertir el perfil
            operativo en una cuenta.
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">DISCIPLINAS</p>
            <h2>Especialidades asignadas</h2>
          </div>
          <span className="count-badge">{linkedIds.size}</span>
        </div>
        {linkedIds.size === 0 ? (
          <div className="empty-state">Aún no tiene disciplinas asignadas.</div>
        ) : (
          <div className="student-list">
            {(disciplines ?? [])
              .filter((item) => linkedIds.has(item.id))
              .map((item) => (
                <div className="student-row" key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <span>Disciplina autorizada</span>
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>

      <section className="panel">
        <p className="eyebrow">AGENDA</p>
        <h2>Clases asignadas</h2>
        <div className="empty-state">
          La asignación de instructor a Session se conecta en F5 para mantener una sola fuente de
          agenda.
        </div>
      </section>

      {canWrite ? (
        <section className="panel">
          <p className="eyebrow">ADMINISTRACIÓN</p>
          <h2>Estado operativo</h2>
          <p>Desactivar conserva el perfil y su historial; no elimina información.</p>
          <form action={setInstructorStatus}>
            <input type="hidden" name="instructor_id" value={instructor.id} />
            <input
              type="hidden"
              name="status"
              value={instructor.status === "active" ? "inactive" : "active"}
            />
            <button
              className={instructor.status === "active" ? "ghost-button" : "primary-button"}
              type="submit"
            >
              {instructor.status === "active" ? "Marcar inactivo" : "Reactivar instructor"}
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
