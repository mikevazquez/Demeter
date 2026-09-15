import Link from "next/link";
import { notFound } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { setStudentLifecycle, updateStudent } from "./actions";

export default async function StudentProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { studentId } = await params;
  const query = await searchParams;
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.STUDENTS_READ);

  const { data: student } = await supabase
    .from("students")
    .select(
      "id, person_id, full_name, email, phone, lifecycle_status, profile_status, created_at, archived_at",
    )
    .eq("id", studentId)
    .eq("studio_id", studio.id)
    .maybeSingle();

  if (!student) notFound();

  const [{ data: person }, { data: contacts }] = await Promise.all([
    student.person_id
      ? supabase
          .from("persons")
          .select("id, first_name, last_name")
          .eq("id", student.person_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    student.person_id
      ? supabase
          .from("person_contacts")
          .select("kind, value, is_primary")
          .eq("person_id", student.person_id)
          .order("kind")
      : Promise.resolve({ data: [] }),
  ]);

  const phone = contacts?.find((item) => item.kind === "phone")?.value ?? student.phone;
  const email = contacts?.find((item) => item.kind === "email")?.value ?? student.email ?? "";
  const firstName = person?.first_name ?? student.full_name.split(" ")[0] ?? "";
  const lastName = person?.last_name ?? student.full_name.split(" ").slice(1).join(" ");
  const canEdit = can(CAPABILITIES.STUDENTS_WRITE);
  const canArchive = can(CAPABILITIES.STUDENTS_ARCHIVE);

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <Link className="back-link compact" href="/admin/alumnas">
            ← Alumnas
          </Link>
          <p className="eyebrow">PERFIL 360 · {studio.name}</p>
          <h1 className="dashboard-title">{student.full_name}</h1>
          <p>Expediente operativo de la alumna.</p>
        </div>
        <div className="toolbar-actions">
          <span className="role-pill">{student.lifecycle_status}</span>
        </div>
      </header>

      {query.saved ? <div className="notice success">Cambios guardados correctamente.</div> : null}
      {query.error ? (
        <div className="notice error">
          {query.error === "phone_exists"
            ? "Ese teléfono ya pertenece a otra alumna."
            : "No se pudo guardar el cambio."}
        </div>
      ) : null}

      <section className="stat-grid">
        <article className="stat-card">
          <span>Expediente</span>
          <strong className="stat-word">
            {student.profile_status === "complete" ? "Completo" : "Incompleto"}
          </strong>
          <small>Nombre, apellido, teléfono y correo</small>
        </article>
        <article className="stat-card">
          <span>Estado</span>
          <strong className="stat-word">{student.lifecycle_status}</strong>
          <small>Ciclo operativo</small>
        </article>
        <article className="stat-card">
          <span>Teléfono</span>
          <strong className="stat-word">{phone}</strong>
          <small>Formato E.164</small>
        </article>
      </section>

      <section className="panel-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">DATOS PERSONALES</p>
              <h2>Información de contacto</h2>
            </div>
          </div>

          {canEdit ? (
            <form action={updateStudent} className="compact-form">
              <input type="hidden" name="student_id" value={student.id} />
              <div className="form-split">
                <input name="first_name" required defaultValue={firstName} placeholder="Nombre" />
                <input name="last_name" defaultValue={lastName ?? ""} placeholder="Apellido" />
              </div>
              <input name="phone" type="tel" required defaultValue={phone} placeholder="Teléfono" />
              <input name="email" type="email" defaultValue={email} placeholder="Correo" />
              <button className="primary-button" type="submit">
                Guardar cambios
              </button>
            </form>
          ) : (
            <div className="student-list">
              <div className="student-row">
                <div>
                  <strong>{student.full_name}</strong>
                  <span>{phone}</span>
                  {email ? <span>{email}</span> : null}
                </div>
              </div>
            </div>
          )}
        </article>

        <article className="panel">
          <p className="eyebrow">RESUMEN OPERATIVO</p>
          <h2>Perfil 360</h2>
          <div className="student-list">
            <div className="student-row">
              <div>
                <strong>Paquete activo</strong>
                <span>Se integrará desde F6 Productos/Créditos.</span>
              </div>
            </div>
            <div className="student-row">
              <div>
                <strong>Próximas clases</strong>
                <span>Se integrará desde F5 Agenda.</span>
              </div>
            </div>
            <div className="student-row">
              <div>
                <strong>Documentos y notas</strong>
                <span>Se integrarán en sus fases correspondientes sin duplicar datos.</span>
              </div>
            </div>
          </div>
        </article>
      </section>

      {canArchive ? (
        <section className="panel">
          <p className="eyebrow">ADMINISTRACIÓN</p>
          <h2>Estado de la alumna</h2>
          <div className="toolbar-actions">
            {student.lifecycle_status !== "active" ? (
              <form action={setStudentLifecycle}>
                <input type="hidden" name="student_id" value={student.id} />
                <input type="hidden" name="status" value="active" />
                <button className="primary-button" type="submit">
                  Reactivar
                </button>
              </form>
            ) : null}
            {student.lifecycle_status === "active" ? (
              <form action={setStudentLifecycle}>
                <input type="hidden" name="student_id" value={student.id} />
                <input type="hidden" name="status" value="inactive" />
                <button className="ghost-button" type="submit">
                  Marcar inactiva
                </button>
              </form>
            ) : null}
            {student.lifecycle_status !== "archived" ? (
              <form action={setStudentLifecycle}>
                <input type="hidden" name="student_id" value={student.id} />
                <input type="hidden" name="status" value="archived" />
                <button className="ghost-button" type="submit">
                  Archivar
                </button>
              </form>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
