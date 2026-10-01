import Link from "next/link";
import { notFound } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import { InstructorAccessProvisioner } from "./InstructorAccessProvisioner";
import { setInstructorStatus } from "../actions";
import "../team-v2.css";

export default async function InstructorProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ instructorId: string }>;
  searchParams: Promise<{ created?: string; saved?: string; error?: string }>;
}) {
  const [{ instructorId }, query, { supabase, studio, can }] = await Promise.all([
    params,
    searchParams,
    getAdminContext(CAPABILITIES.INSTRUCTORS_READ),
  ]);
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
  const name = [person?.first_name, person?.last_name].filter(Boolean).join(" ") || "Integrante";
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
    <main className="team-v2-detail">
      <header className="team-v2-detail-header">
        <div>
          <Link className="team-v2-detail-back" href="/admin/instructores">
            ← Equipo
          </Link>
          <h1>{name}</h1>
          <p>Datos, acceso, especialidades y próximas clases.</p>
        </div>

        <span
          className={`team-v2-detail-status ${instructor.status === "active" ? "is-active" : ""}`}
        >
          {instructor.status === "active" ? "Activo" : "Inactivo"}
        </span>
      </header>

      {query.created ? (
        <div className="team-v2-notice is-success">Integrante creado correctamente.</div>
      ) : null}
      {query.saved ? <div className="team-v2-notice is-success">Estado actualizado.</div> : null}
      {query.error ? (
        <div className="team-v2-notice is-error">No se pudo guardar el cambio.</div>
      ) : null}

      <section className="team-v2-detail-grid">
        <article className="team-v2-card">
          <div className="team-v2-card-heading">
            <div>
              <h2>Datos</h2>
              <p>Información básica del integrante.</p>
            </div>
          </div>

          <div className="team-v2-detail-list">
            <div className="team-v2-detail-row">
              <div>
                <strong>Nombre</strong>
                <span>{name}</span>
              </div>
            </div>
            <div className="team-v2-detail-row">
              <div>
                <strong>Teléfono</strong>
                <span>{phone || "Sin teléfono"}</span>
              </div>
            </div>
            <div className="team-v2-detail-row">
              <div>
                <strong>Correo</strong>
                <span>{email || "Sin correo"}</span>
              </div>
            </div>
            {instructor.bio ? (
              <div className="team-v2-detail-row">
                <div>
                  <strong>Especialidad o nota</strong>
                  <span>{instructor.bio}</span>
                </div>
              </div>
            ) : null}
          </div>
        </article>

        <article className="team-v2-card">
          <div className="team-v2-card-heading">
            <div>
              <h2>Acceso Coach</h2>
              <p>Permite entrar al portal para consultar y operar sus clases.</p>
            </div>
          </div>

          {!canManageAccess ? (
            <div className="team-v2-empty-inline">
              Puedes consultar este perfil, pero no administrar su acceso.
            </div>
          ) : instructor.status !== "active" ? (
            <div className="team-v2-notice is-error">
              Reactiva al integrante antes de habilitar su acceso.
            </div>
          ) : accessState === "not_linked" && !email ? (
            <div className="team-v2-notice is-error">
              Agrega un correo válido antes de crear su acceso Coach.
            </div>
          ) : accessState === "not_linked" ? (
            <InstructorAccessProvisioner
              instructorId={instructor.id}
              email={email ?? ""}
              mode="provision"
            />
          ) : accessState === "pending_activation" ? (
            <>
              <div className="team-v2-notice is-success">
                El acceso ya fue creado. Falta que el integrante cambie su contraseña temporal.
              </div>
              <InstructorAccessProvisioner
                instructorId={instructor.id}
                email={email ?? ""}
                mode="reset"
              />
            </>
          ) : accessState === "active" ? (
            <div className="team-v2-notice is-success">Acceso Coach activo.</div>
          ) : (
            <div className="team-v2-notice is-error">
              El acceso está incompleto o inactivo. Revisa la cuenta antes de continuar.
            </div>
          )}
        </article>

        <article className="team-v2-card">
          <div className="team-v2-card-heading">
            <div>
              <h2>Especialidades</h2>
              <p>Disciplinas asociadas a este integrante.</p>
            </div>
            <span className="team-v2-count">{linkedIds.size}</span>
          </div>

          {linkedIds.size === 0 ? (
            <div className="team-v2-empty-inline">Aún no tiene especialidades asignadas.</div>
          ) : (
            <div className="team-v2-detail-list">
              {(disciplines ?? [])
                .filter((item) => linkedIds.has(item.id))
                .map((item) => (
                  <div className="team-v2-detail-row" key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>Especialidad asignada</span>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </article>

        <article className="team-v2-card">
          <div className="team-v2-card-heading">
            <div>
              <h2>Próximas clases</h2>
              <p>Sesiones que ya tiene asignadas en Agenda.</p>
            </div>
            <span className="team-v2-count">{sessions?.length ?? 0}</span>
          </div>

          {(sessions?.length ?? 0) === 0 ? (
            <div className="team-v2-empty-inline">No tiene próximas clases asignadas.</div>
          ) : (
            <div className="team-v2-detail-list">
              {sessions?.map((session) => (
                <Link
                  className="team-v2-detail-row"
                  href={`/admin/agenda/${session.id}`}
                  key={session.id}
                >
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
                  <small>{session.status}</small>
                </Link>
              ))}
            </div>
          )}
        </article>

        {canWrite ? (
          <article className="team-v2-card is-wide">
            <div className="team-v2-card-heading">
              <div>
                <h2>Estado</h2>
                <p>
                  Desactivar conserva el perfil, historial y clases anteriores; no elimina
                  información.
                </p>
              </div>
            </div>

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
                {instructor.status === "active" ? "Marcar como inactivo" : "Reactivar integrante"}
              </button>
            </form>
          </article>
        ) : null}
      </section>
    </main>
  );
}
