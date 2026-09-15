import Link from "next/link";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { bookStudent, cancelReservation, cancelSession, updateSession } from "./actions";

type EligibilityResult = {
  eligible?: boolean;
  reason_code?: string | null;
  available_credits?: number | null;
  unlimited?: boolean;
};

const eligibilityCopy: Record<string, string> = {
  student_not_operable: "perfil no habilitado",
  session_not_bookable: "clase no disponible",
  already_reserved: "ya reservada",
  session_full: "clase llena",
  no_active_product: "sin paquete activo",
  outside_product: "fuera de paquete",
  no_credits: "sin créditos",
};

export default async function SessionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ error?: string; created?: string }>;
}) {
  const { sessionId } = await params;
  const query = await searchParams;
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.SCHEDULE_READ);
  const { data: session } = await supabase
    .from("class_sessions")
    .select(
      "id,template_id,starts_at,ends_at,capacity,status,notes,space_id,instructor_id,recurring_schedule_id,is_schedule_exception",
    )
    .eq("id", sessionId)
    .eq("studio_id", studio.id)
    .single();
  if (!session) redirect("/admin/agenda");

  const canEdit = can(CAPABILITIES.SCHEDULE_WRITE);
  const [
    { data: template },
    { data: spaces },
    { data: instructors },
    { data: persons },
    { data: students },
    { data: reservations },
  ] = await Promise.all([
    supabase
      .from("class_templates")
      .select("name,discipline_id,duration_minutes,credit_cost")
      .eq("id", session.template_id)
      .single(),
    supabase
      .from("spaces")
      .select("id,name,capacity")
      .eq("studio_id", studio.id)
      .eq("active", true)
      .order("name"),
    supabase
      .from("instructors")
      .select("id,person_id")
      .eq("studio_id", studio.id)
      .eq("status", "active"),
    supabase.from("persons").select("id,first_name,last_name").eq("studio_id", studio.id),
    supabase
      .from("students")
      .select("id,full_name,active,lifecycle_status")
      .eq("studio_id", studio.id)
      .eq("active", true)
      .eq("lifecycle_status", "active")
      .order("full_name"),
    supabase
      .from("reservations")
      .select("id,student_id,status,acquisition_id")
      .eq("session_id", sessionId)
      .in("status", ["reserved", "attended"])
      .order("booked_at"),
  ]);

  const timeZone = studio.timezone ?? "America/Mexico_City";
  const personMap = new Map(
    (persons ?? []).map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(" ")]),
  );
  const instructorMap = new Map(
    (instructors ?? []).map((i) => [i.id, personMap.get(i.person_id) ?? "Instructor"]),
  );
  const spaceMap = new Map((spaces ?? []).map((s) => [s.id, s.name]));
  const dateLabel = new Intl.DateTimeFormat("es-MX", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(session.starts_at));
  const localInput = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(session.starts_at))
    .replace(" ", "T");

  const studentMap = new Map((students ?? []).map((s) => [s.id, s.full_name]));
  const bookedStudentIds = new Set((reservations ?? []).map((r) => r.student_id).filter(Boolean));
  const candidates = (students ?? []).filter((student) => !bookedStudentIds.has(student.id));
  const eligibilityEntries = canEdit
    ? await Promise.all(
        candidates.map(async (student) => {
          const { data } = await supabase.rpc("booking_eligibility", {
            target_session_id: sessionId,
            target_student_id: student.id,
          });
          return [student.id, (data ?? {}) as EligibilityResult] as const;
        }),
      )
    : [];
  const eligibilityMap = new Map(eligibilityEntries);
  const eligibleStudents = candidates.filter(
    (student) => eligibilityMap.get(student.id)?.eligible === true,
  );
  const available = Math.max(session.capacity - (reservations?.length ?? 0), 0);
  const lateCancellation = Date.now() > new Date(session.starts_at).getTime() - 8 * 60 * 60 * 1000;

  const errorCopy: Record<string, string> = {
    conflict: "El instructor o espacio ya está ocupado en ese horario.",
    space: "El espacio no admite ese cupo.",
    instructor: "Selecciona un instructor activo del estudio.",
    edit: "No se pudieron guardar los cambios.",
    booking: "No se pudo crear la reserva.",
    no_active_product: "La alumna no tiene un paquete o membresía vigente para esta clase.",
    outside_product: "El producto activo de la alumna no incluye esta disciplina.",
    no_credits: "La alumna ya no tiene créditos disponibles.",
    session_full: "La clase está llena. No se permiten sobrecupos automáticos.",
    already_reserved: "La alumna ya tiene una reserva activa en esta clase.",
    student_not_operable: "La alumna no está habilitada para reservar.",
    session_not_bookable: "Esta sesión ya no admite reservas.",
    cancel: "No se pudo cancelar la reserva.",
  };

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <Link className="back-link compact" href="/admin/agenda">
            ← Agenda
          </Link>
          <p className="eyebrow">DETALLE DE CLASE · {studio.name}</p>
          <h1 className="dashboard-title">{template?.name ?? "Clase"}</h1>
          <p>
            {dateLabel} ·{" "}
            {session.space_id ? (spaceMap.get(session.space_id) ?? "Espacio") : "Sin espacio"} ·{" "}
            {session.instructor_id
              ? (instructorMap.get(session.instructor_id) ?? "Instructor")
              : "Sin instructor"}
          </p>
          {session.recurring_schedule_id ? (
            <small>
              {session.is_schedule_exception
                ? "Sesión modificada dentro de un horario recurrente"
                : "Parte de un horario recurrente"}
            </small>
          ) : (
            <small>Sesión individual</small>
          )}
        </div>
      </header>

      {query.created ? <div className="notice success">Cambio guardado correctamente.</div> : null}
      {query.error ? (
        <div className="notice error">
          {errorCopy[decodeURIComponent(query.error)] ?? "No se pudo completar la operación."}
        </div>
      ) : null}

      <section className="stat-grid">
        <article className="stat-card">
          <span>Capacidad</span>
          <strong>{session.capacity}</strong>
          <small>Lugares totales</small>
        </article>
        <article className="stat-card">
          <span>Reservas</span>
          <strong>{reservations?.length ?? 0}</strong>
          <small>Activas</small>
        </article>
        <article className="stat-card">
          <span>Disponibles</span>
          <strong>{available}</strong>
          <small>Lugares libres</small>
        </article>
        <article className="stat-card">
          <span>Créditos</span>
          <strong>{template?.credit_cost ?? 1}</strong>
          <small>Por reserva MVP</small>
        </article>
      </section>

      {canEdit && session.status !== "cancelled" ? (
        <section className="panel">
          <p className="eyebrow">EDITAR SESIÓN</p>
          <h2>Horario y recursos</h2>
          <form action={updateSession} className="compact-form">
            <input type="hidden" name="session_id" value={sessionId} />
            <input name="starts_at" type="datetime-local" defaultValue={localInput} required />
            <select name="instructor_id" defaultValue={session.instructor_id ?? ""}>
              <option value="">Sin instructor</option>
              {instructors?.map((i) => (
                <option key={i.id} value={i.id}>
                  {instructorMap.get(i.id)}
                </option>
              ))}
            </select>
            <select name="space_id" defaultValue={session.space_id ?? ""}>
              <option value="">Sin espacio</option>
              {spaces?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.capacity ? ` · máx. ${s.capacity}` : ""}
                </option>
              ))}
            </select>
            <input name="capacity" type="number" min="1" defaultValue={session.capacity} required />
            <textarea name="notes" rows={3} defaultValue={session.notes ?? ""} />
            {session.recurring_schedule_id ? (
              <fieldset className="rounded-xl border border-white/10 p-3">
                <legend>Aplicar cambios a</legend>
                <label className="block">
                  <input type="radio" name="scope" value="single" defaultChecked /> Solo esta sesión
                </label>
                <label className="block mt-2">
                  <input type="radio" name="scope" value="future" /> Esta y todas las siguientes
                </label>
              </fieldset>
            ) : (
              <input type="hidden" name="scope" value="single" />
            )}
            <button className="primary-button" type="submit">
              Guardar cambios
            </button>
          </form>
          <form action={cancelSession} className="compact-form mt-4">
            <input type="hidden" name="session_id" value={sessionId} />
            {session.recurring_schedule_id ? (
              <select name="scope" defaultValue="single">
                <option value="single">Cancelar solo esta sesión</option>
                <option value="future">Cancelar esta y todas las siguientes</option>
              </select>
            ) : (
              <input type="hidden" name="scope" value="single" />
            )}
            <small>Las reservas activas se cancelarán y sus créditos se liberarán.</small>
            <button className="ghost-button" type="submit">
              Cancelar clase
            </button>
          </form>
        </section>
      ) : null}

      <section className="panel-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">ASISTENTES</p>
              <h2>Reservaciones</h2>
            </div>
          </div>
          {!reservations?.length ? (
            <div className="empty-state">Todavía no hay alumnas reservadas.</div>
          ) : (
            <div className="student-list">
              {reservations.map((reservation) => (
                <div className="student-row" key={reservation.id}>
                  <div>
                    <strong>
                      {reservation.student_id
                        ? (studentMap.get(reservation.student_id) ?? "Alumna")
                        : "Alumna"}
                    </strong>
                    <span>{reservation.status === "reserved" ? "Reservada" : "Asistió"}</span>
                  </div>
                  {canEdit &&
                  session.status !== "cancelled" &&
                  reservation.status === "reserved" ? (
                    <form action={cancelReservation}>
                      <input type="hidden" name="session_id" value={sessionId} />
                      <input type="hidden" name="reservation_id" value={reservation.id} />
                      <button className="ghost-button" type="submit">
                        {lateCancellation
                          ? "Cancelar · consume crédito"
                          : "Cancelar · devuelve crédito"}
                      </button>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel">
          <p className="eyebrow">NUEVA RESERVA</p>
          <h2>Agregar alumna</h2>
          {!canEdit || session.status === "cancelled" ? (
            <p>La sesión no admite nuevas reservas.</p>
          ) : available === 0 ? (
            <div className="empty-state">
              Clase llena. El sobrecupo automático está bloqueado; la lista de espera llegará en
              1.1.
            </div>
          ) : (
            <form action={bookStudent} className="compact-form reservation-form">
              <input type="hidden" name="session_id" value={sessionId} />
              <select name="student_id" required defaultValue="">
                <option value="" disabled>
                  Selecciona una alumna
                </option>
                {candidates.map((student) => {
                  const eligibility = eligibilityMap.get(student.id);
                  const reason = eligibility?.reason_code
                    ? (eligibilityCopy[eligibility.reason_code] ?? "no elegible")
                    : null;
                  return (
                    <option key={student.id} value={student.id} disabled={!eligibility?.eligible}>
                      {student.full_name}
                      {eligibility?.eligible
                        ? eligibility.unlimited
                          ? " · membresía ilimitada"
                          : ` · ${eligibility.available_credits ?? 0} créditos`
                        : ` · ${reason}`}
                    </option>
                  );
                })}
              </select>
              {!candidates.length ? (
                <small>No hay más alumnas disponibles para esta clase.</small>
              ) : null}
              {candidates.length > 0 && !eligibleStudents.length ? (
                <small>
                  Ninguna alumna disponible cumple actualmente las reglas de paquete, disciplina y
                  créditos.
                </small>
              ) : null}
              <button className="primary-button" type="submit" disabled={!eligibleStudents.length}>
                Reservar lugar + crédito
              </button>
            </form>
          )}
        </article>
      </section>
    </main>
  );
}
