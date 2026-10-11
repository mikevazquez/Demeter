import Link from "next/link";
import { notFound } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import { InstructorAccessProvisioner } from "./InstructorAccessProvisioner";
import { setInstructorStatus, updateTeamMember } from "../actions";
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
  const canWriteBase = can(CAPABILITIES.INSTRUCTORS_WRITE);
  const canManageAccessBase = can(CAPABILITIES.SETTINGS_WRITE);

  const { data: instructor } = await supabase
    .from("instructors")
    .select("id, person_id, status, bio, staff_role, teaches, created_at")
    .eq("id", instructorId)
    .eq("studio_id", studio.id)
    .maybeSingle();

  if (!instructor) notFound();
  const { data: profileData, error: profileError } = await supabase.rpc("admin_team_profile", {
    p_instructor_id: instructor.id,
  });
  const profile = profileData as {
    is_owner: boolean;
    email_locked: boolean;
    last_sign_in_at: string | null;
    access_status: string;
    classes_taught: number;
    cancelled_classes: number;
    attendances: number;
    capacity: number;
    unique_students: number;
    future_classes: number;
    has_recurring: boolean;
  } | null;
  const isOwner = Boolean(profile?.is_owner);
  const roleLabel = isOwner
    ? "Owner"
    : instructor.staff_role === "admin"
      ? "Administración"
      : instructor.staff_role === "reception"
        ? "Recepción"
        : "Coach";
  const canWrite = canWriteBase;
  const canManageAccess = canManageAccessBase;
  const { data: replacements } = canWrite
    ? await supabase
        .from("instructors")
        .select("id,person_id")
        .eq("studio_id", studio.id)
        .eq("status", "active")
        .eq("teaches", true)
        .neq("id", instructor.id)
    : { data: [] };
  const { data: replacementPeople } = replacements?.length
    ? await supabase
        .from("persons")
        .select("id,first_name,last_name")
        .eq("studio_id", studio.id)
        .in(
          "id",
          replacements.map((r) => r.person_id),
        )
    : { data: [] };

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
      .select("kind, value, is_primary, phone_role")
      .eq("person_id", instructor.person_id),
    supabase
      .from("instructor_disciplines")
      .select("discipline_id")
      .eq("instructor_id", instructor.id),
    supabase.from("disciplines").select("id, name").eq("studio_id", studio.id).order("name"),
    supabase
      .from("class_sessions")
      .select("id, template_id, starts_at, status, capacity")
      .eq("studio_id", studio.id)
      .eq("instructor_id", instructor.id)
      .eq("status", "scheduled")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(6),
    supabase.from("class_templates").select("id, name, discipline_id").eq("studio_id", studio.id),
    canManageAccess
      ? supabase
          .from("studio_memberships")
          .select("user_id, active")
          .eq("studio_id", studio.id)
          .eq("person_id", instructor.person_id)
          .eq("role", instructor.staff_role)
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
  for (const session of sessions ?? []) {
    const template = templates?.find((item) => item.id === session.template_id);
    if (template?.discipline_id) linkedIds.add(template.discipline_id);
  }
  const { data: recurring } = await supabase
    .from("recurring_schedules")
    .select("template_id")
    .eq("studio_id", studio.id)
    .eq("instructor_id", instructor.id)
    .eq("active", true);
  for (const row of recurring ?? []) {
    const template = templates?.find((item) => item.id === row.template_id);
    if (template?.discipline_id) linkedIds.add(template.discipline_id);
  }
  const { data: bookings } = sessions?.length
    ? await supabase
        .from("reservations")
        .select("session_id,status")
        .eq("studio_id", studio.id)
        .in(
          "session_id",
          sessions.map((s) => s.id),
        )
        .in("status", ["reserved", "attended", "no_show"])
    : { data: [] };
  const templateMap = new Map((templates ?? []).map((item) => [item.id, item.name]));
  const name = [person?.first_name, person?.last_name].filter(Boolean).join(" ") || "Integrante";
  const phone = contacts?.find(
    (item) => item.kind === "phone" && item.phone_role === "coach",
  )?.value;
  const primaryEmail = contacts?.find(
    (item) => item.kind === "email" && item.is_primary === true,
  )?.value;
  const email = primaryEmail ?? contacts?.find((item) => item.kind === "email")?.value;
  const timeZone = studio.timezone;

  const accessState = profile
    ? profile.access_status === "active"
      ? "active"
      : profile.access_status === "pending"
        ? "pending_activation"
        : "not_linked"
    : !accessMembership
      ? "not_linked"
      : !accessMembership.active || !accessAccount || accessAccount.status !== "active"
        ? "inconsistent"
        : accessAccount.must_change_password
          ? "pending_activation"
          : "active";

  return (
    <main className="portal-page team-v2-detail">
      <header className="team-v2-detail-header">
        <div>
          <Link className="team-v2-detail-back" href="/admin/instructores">
            ← Equipo
          </Link>
          <h1>{name}</h1>
          <p>
            {roleLabel}
            {instructor.staff_role !== "instructor" && instructor.teaches
              ? " · imparte clases"
              : ""}
            {instructor.status !== "active" ? " · inactivo" : ""}
          </p>
        </div>

        <span
          className={`team-v2-detail-status ${instructor.status === "active" ? "is-active" : ""}`}
        >
          {accessState === "active"
            ? "Acceso activo"
            : accessState === "pending_activation"
              ? "Pendiente de activar"
              : "Sin acceso"}
        </span>
      </header>

      {query.created ? (
        <div className="team-v2-notice is-success">Integrante creado correctamente.</div>
      ) : null}
      {query.saved ? (
        <div className="team-v2-notice is-success">
          {query.saved === "data" ? "Datos guardados." : "Estado actualizado."}
        </div>
      ) : null}
      {query.error ? (
        <div className="team-v2-notice is-error">
          {(
            {
              phone_in_use:
                "Ese número ya pertenece a otro integrante. Sí puede coincidir con el de una alumna.",
              phone_invalid: "Ingresa un teléfono válido.",
              email_invalid: "Revisa el correo.",
              email_in_use: "Ese correo ya está registrado en el equipo.",
              first_name_required: "El nombre es obligatorio.",
              teaching_assignments_exist:
                "Reasigna sus clases y horarios antes de quitar la opción de impartir clases.",
              linked_email_locked:
                "El correo está vinculado a su cuenta de acceso. Conserva el correo de inicio de sesión.",
              owner_protected: "No se puede cambiar el rol ni desactivar al Owner.",
            } as Record<string, string>
          )[query.error] ??
            "No se pudo guardar el cambio. Revisa los datos y el reemplazo de sus clases."}
        </div>
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
          <div className="team-v2-detail-row">
            <div>
              <strong>Rol</strong>
              <span>{roleLabel}</span>
            </div>
          </div>
          {canWrite ? (
            <details className="team-v2-edit">
              <summary className="portal-button">Editar datos</summary>
              <form action={updateTeamMember} className="portal-form">
                <input type="hidden" name="instructor_id" value={instructor.id} />
                <label>
                  Nombre
                  <input name="first_name" required defaultValue={person?.first_name ?? ""} />
                </label>
                <label>
                  Apellido <small>Opcional</small>
                  <input name="last_name" defaultValue={person?.last_name ?? ""} />
                </label>
                <label>
                  Teléfono
                  <input
                    name="phone"
                    type="tel"
                    defaultValue={phone ?? ""}
                    placeholder="33 1234 5678"
                  />
                </label>
                <label>
                  Correo
                  <input
                    name="email"
                    type="email"
                    defaultValue={email ?? ""}
                    readOnly={profile?.email_locked}
                  />
                  {profile?.email_locked ? <small>Vinculado a su cuenta de acceso.</small> : null}
                </label>
                {isOwner ? (
                  <input type="hidden" name="staff_role" value={instructor.staff_role} />
                ) : (
                  <label>
                    Rol
                    <select name="staff_role" defaultValue={instructor.staff_role}>
                      <option value="instructor">Coach</option>
                      <option value="reception">Recepción</option>
                      <option value="admin">Administración</option>
                    </select>
                    <small>
                      Define qué ve al iniciar sesión. Recepción y Administración también pueden
                      impartir clases.
                    </small>
                  </label>
                )}
                {isOwner ? (
                  instructor.teaches ? (
                    <input type="hidden" name="teaches" value="on" />
                  ) : null
                ) : (
                  <label className="portal-inline-form">
                    <input type="checkbox" name="teaches" defaultChecked={instructor.teaches} />
                    También imparte clases
                  </label>
                )}
                <label>
                  Especialidad o nota
                  <textarea name="bio" defaultValue={instructor.bio ?? ""} />
                </label>
                <button className="portal-button primary" type="submit">
                  Guardar
                </button>
              </form>
            </details>
          ) : null}
        </article>

        <article className="team-v2-card">
          <div className="team-v2-card-heading">
            <div>
              <h2>Acceso a StudioFlow</h2>
              <p>
                Entra con el mismo inicio de sesión que todos; StudioFlow le muestra lo que
                corresponde a su rol ({roleLabel}).
              </p>
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
              Agrega un correo válido antes de crear su acceso.
            </div>
          ) : accessState === "not_linked" ? (
            <InstructorAccessProvisioner
              roleLabel={roleLabel}
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
                roleLabel={roleLabel}
                instructorId={instructor.id}
                email={email ?? ""}
                mode="reset"
              />
            </>
          ) : accessState === "active" ? (
            <div className="team-v2-notice is-success">
              Acceso activo
              {profile?.last_sign_in_at
                ? ` · último ingreso ${new Intl.DateTimeFormat(studio.locale, { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(profile.last_sign_in_at))}`
                : ""}
              . Ya completó su activación; si olvida su contraseña la recupera desde el inicio de
              sesión.
            </div>
          ) : (
            <div className="team-v2-notice is-error">
              El acceso está incompleto o inactivo. Revisa la cuenta antes de continuar.
            </div>
          )}
        </article>

        {instructor.teaches ? (
          <>
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
                  <h2>Últimos 30 días</h2>
                </div>
              </div>
              {profileError || !profile ? (
                <p>No pudimos cargar sus métricas. Intenta nuevamente.</p>
              ) : (
                <div className="portal-stats-grid">
                  <div>
                    <strong>{profile.classes_taught}</strong>
                    <span>Clases impartidas</span>
                    <small>{profile.cancelled_classes} canceladas</small>
                  </div>
                  <div>
                    <strong>
                      {profile.classes_taught
                        ? (profile.attendances / profile.classes_taught).toFixed(1)
                        : "—"}
                    </strong>
                    <span>Asistencia promedio</span>
                    <small>alumnas por clase</small>
                  </div>
                  <div>
                    <strong>
                      {profile.capacity
                        ? `${Math.round((100 * profile.attendances) / profile.capacity)}%`
                        : "—"}
                    </strong>
                    <span>Ocupación</span>
                  </div>
                  <div>
                    <strong>{profile.unique_students}</strong>
                    <span>Alumnas distintas</span>
                  </div>
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
                      <small>
                        {bookings?.filter((r) => r.session_id === session.id).length ?? 0}/
                        {session.capacity} lugares
                      </small>
                    </Link>
                  ))}
                </div>
              )}
              {profile && profile.future_classes > 6 ? (
                <p className="team-v2-access-help">Y {profile.future_classes - 6} más en Agenda.</p>
              ) : null}
            </article>
          </>
        ) : null}
        {canWrite && !isOwner ? (
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
              {instructor.status === "active" ? (
                <label className="portal-form">
                  Reasignar clases futuras a
                  <select
                    name="replacement_instructor_id"
                    required={Boolean(profile?.future_classes || profile?.has_recurring)}
                    defaultValue=""
                  >
                    <option value="">
                      {profile?.future_classes || profile?.has_recurring
                        ? "Elige quién cubre sus clases"
                        : "Sin reasignación"}
                    </option>
                    {(replacements ?? []).map((replacement) => {
                      const person = replacementPeople?.find((p) => p.id === replacement.person_id);
                      return (
                        <option value={replacement.id} key={replacement.id}>
                          {[person?.first_name, person?.last_name].filter(Boolean).join(" ") ||
                            "Integrante"}
                        </option>
                      );
                    })}
                  </select>
                  <small>
                    Se reasignan las sesiones futuras y los horarios recurrentes. Las alumnas
                    reservadas reciben aviso del cambio de coach.
                  </small>
                </label>
              ) : null}
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
