import Link from "next/link";
import { notFound } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { InstructorAccessProvisioner } from "./InstructorAccessProvisioner";
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
  const canManageAccess = can(CAPABILITIES.SETTINGS_WRITE);
  const { data: instructor } = await supabase
    .from("instructors")
    .select("id, person_id, status, bio, created_at")
    .eq("id", instructorId)
    .eq("studio_id", studio.id)
    .maybeSingle();
  if (!instructor) notFound();

  const [
    { data: person },
    { data: contacts },
    { data: links },
    { data: disciplines },
    { data: sessions },
    { data: templates },
    { data: accessMembership },
  ] = await Promise.all([
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
    supabase
      .from("class_sessions")
      .select("id, template_id, starts_at, status")
      .eq("studio_id", studio.id)
      .eq("instructor_id", instructor.id)
      .gte("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(10),
    supabase.from("class_templates").select("id, name").eq("studio_id", studio.id),
    canManageAccess
      ? supabase
          .from("studio_memberships")
          .select("user_id, active")
          .eq("studio_id", studio.id)
          .eq("person_id", instructor.person_id)
          .eq("role", "instructor")
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const { data: accessAccount } =
    canManageAccess && accessMembership?.user_id
      ? await supabase
          .from("user_accounts")
          .select("status, must_change_password")
          .eq("id", accessMembership.user_id)
          .maybeSingle()
      : { data: null };

  const linkedIds = new Set((links ?? []).map((item) => item.discipline_id));
  const templateMap = new Map((templates ?? []).map((item) => [item.id, item.name]));
  const name = [person?.first_name, person?.last_name].filter(Boolean).join(" ") || "Instructor";
  const phone = contacts?.find((item) => item.kind === "phone")?.value;
  const primaryEmail = contacts?.find(
    (item) => item.kind === "email" && item.is_primary === true,
  )?.value;
  const email = primaryEmail ?? contacts?.find((item) => item.kind === "email")?.value;
  const timeZone = studio.timezone;
  const accessState = !accessMembership
    ? "not_linked"
    : !accessMembership.active || !accessAccount || accessAccount.status !== "active"
      ? "inconsistent"
      : accessAccount.must_change_password
        ? "pending_activation"
        : "active";

  return (
    <main className="dashboard-shell admin-ux04-secondary-detail team-detail-page">
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
          <p className="eyebrow">ACCESO COACH</p>
          <h2>Cuenta separada</h2>
          {!canManageAccess ? (
            <div className="empty-state">
              Tu rol puede consultar el InstructorProfile, pero no administrar cuentas de acceso.
            </div>
          ) : instructor.status !== "active" ? (
            <div className="notice error">
              Activa al instructor antes de habilitar el portal Coach.
            </div>
          ) : accessState === "not_linked" && !email ? (
            <div className="notice error">
              Falta un correo válido. El Coach inicia sesión con correo y contraseña, por lo que el
              acceso no puede crearse hasta completar ese dato.
            </div>
          ) : accessState === "not_linked" ? (
            <InstructorAccessProvisioner
              instructorId={instructor.id}
              email={email ?? ""}
              mode="provision"
            />
          ) : accessState === "pending_activation" ? (
            <>
              <div className="notice success">
                Cuenta Coach vinculada. Está pendiente de que el instructor cambie su contraseña
                temporal en el primer acceso.
              </div>
              <InstructorAccessProvisioner
                instructorId={instructor.id}
                email={email ?? ""}
                mode="reset"
              />
            </>
          ) : accessState === "active" ? (
            <div className="notice success">
              Acceso Coach activo y contraseña inicial ya reemplazada por el instructor.
            </div>
          ) : (
            <div className="notice error">
              La cuenta de acceso está incompleta o inactiva. No se harán reparaciones automáticas;
              revisa UserAccount y membership antes de continuar.
            </div>
          )}
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
        <div className="panel-heading">
          <div>
            <p className="eyebrow">AGENDA</p>
            <h2>Próximas clases</h2>
          </div>
          <span className="count-badge">{sessions?.length ?? 0}</span>
        </div>
        {(sessions?.length ?? 0) === 0 ? (
          <div className="empty-state">No tiene próximas clases asignadas.</div>
        ) : (
          <div className="student-list">
            {sessions?.map((session) => (
              <Link className="student-row" href={`/admin/agenda/${session.id}`} key={session.id}>
                <div>
                  <strong>{templateMap.get(session.template_id) ?? "Clase"}</strong>
                  <span>
                    {new Intl.DateTimeFormat(studio.locale, {
                      timeZone,
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(session.starts_at))}
                  </span>
                </div>
                <span className="status-pill">{session.status}</span>
              </Link>
            ))}
          </div>
        )}
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
