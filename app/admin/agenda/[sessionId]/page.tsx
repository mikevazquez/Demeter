import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bookStudent, cancelReservation } from "./actions";

export default async function SessionDetailPage({ params, searchParams }: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ error?: string; created?: string }>;
}) {
  const { sessionId } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login/admin");

  const { data: membership } = await supabase.from("studio_memberships").select("studio_id, role").eq("user_id", user.id).eq("active", true).maybeSingle();
  if (!membership || !["owner", "admin", "coach"].includes(membership.role)) redirect("/login/admin?error=access");

  const { data: session } = await supabase.from("class_sessions").select("id, template_id, starts_at, ends_at, capacity, status, location_id").eq("id", sessionId).eq("studio_id", membership.studio_id).single();
  if (!session) redirect("/admin/agenda");

  const [{ data: studio }, { data: template }, { data: location }, { data: students }, { data: reservations }, { data: assignments }] = await Promise.all([
    supabase.from("studios").select("name, timezone").eq("id", membership.studio_id).single(),
    supabase.from("class_templates").select("name, discipline_id").eq("id", session.template_id).single(),
    session.location_id ? supabase.from("studio_locations").select("name").eq("id", session.location_id).single() : Promise.resolve({ data: null }),
    supabase.from("students").select("id, full_name, active").eq("studio_id", membership.studio_id).eq("active", true).order("full_name"),
    supabase.from("reservations").select("id, student_id, status, student_package_id").eq("session_id", sessionId).neq("status", "cancelled").order("booked_at"),
    supabase.from("student_packages").select("id, student_id, credits_remaining, starts_on, expires_on").eq("studio_id", membership.studio_id),
  ]);

  const timeZone = studio?.timezone ?? "America/Mexico_City";
  const dateLabel = new Intl.DateTimeFormat("es-MX", { timeZone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(session.starts_at));
  const studentMap = new Map((students ?? []).map((student) => [student.id, student.full_name]));
  const bookedStudentIds = new Set((reservations ?? []).map((reservation) => reservation.student_id).filter(Boolean));
  const classDate = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(session.starts_at));
  const eligibleStudentIds = new Set((assignments ?? []).filter((item) => item.student_id && item.starts_on <= classDate && item.expires_on >= classDate && (item.credits_remaining === null || item.credits_remaining > 0)).map((item) => item.student_id));
  const eligibleStudents = (students ?? []).filter((student) => eligibleStudentIds.has(student.id) && !bookedStudentIds.has(student.id));
  const canEdit = ["owner", "admin"].includes(membership.role);
  const available = Math.max(session.capacity - (reservations?.length ?? 0), 0);

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <Link className="back-link compact" href="/admin/agenda">← Agenda</Link>
          <p className="eyebrow">DETALLE DE CLASE · {studio?.name ?? "ESTUDIO"}</p>
          <h1 className="dashboard-title">{template?.name ?? "Clase"}</h1>
          <p>{dateLabel} · {location?.name ?? "Sin ubicación"}</p>
        </div>
        <div className="toolbar-actions"><span className="role-pill">{membership.role}</span></div>
      </header>

      {query.created ? <div className="notice success">Cambio guardado correctamente.</div> : null}
      {query.error ? <div className="notice error">No se pudo completar la reserva. Verifica paquete, vigencia y capacidad.</div> : null}

      <section className="stat-grid">
        <article className="stat-card"><span>Capacidad</span><strong>{session.capacity}</strong><small>Lugares totales</small></article>
        <article className="stat-card"><span>Reservas</span><strong>{reservations?.length ?? 0}</strong><small>Activas</small></article>
        <article className="stat-card"><span>Disponibles</span><strong>{available}</strong><small>Lugares libres</small></article>
        <article className="stat-card"><span>Estado</span><strong className="stat-word">{session.status}</strong><small>Estado de sesión</small></article>
      </section>

      <section className="panel-grid">
        <article className="panel">
          <div className="panel-heading"><div><p className="eyebrow">ASISTENTES</p><h2>Reservaciones</h2></div></div>
          {(reservations?.length ?? 0) === 0 ? <div className="empty-state">Todavía no hay alumnas reservadas.</div> : (
            <div className="student-list">
              {reservations?.map((reservation) => (
                <div className="student-row" key={reservation.id}>
                  <div><strong>{reservation.student_id ? studentMap.get(reservation.student_id) ?? "Alumna" : "Alumna"}</strong><span>{reservation.status}</span></div>
                  {canEdit ? <form action={cancelReservation}><input type="hidden" name="session_id" value={sessionId} /><input type="hidden" name="reservation_id" value={reservation.id} /><button className="ghost-button" type="submit">Cancelar</button></form> : null}
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel">
          <p className="eyebrow">NUEVA RESERVA</p>
          <h2>Agregar alumna</h2>
          {!canEdit ? <p>Solo owner y admin pueden crear reservas.</p> : (
            <form action={bookStudent} className="compact-form reservation-form">
              <input type="hidden" name="session_id" value={sessionId} />
              <select name="student_id" required defaultValue=""><option value="" disabled>Alumna con paquete vigente</option>{eligibleStudents.map((student) => <option key={student.id} value={student.id}>{student.full_name}</option>)}</select>
              <button className="primary-button" type="submit" disabled={eligibleStudents.length === 0 || available === 0}>Reservar lugar</button>
              {eligibleStudents.length === 0 ? <p className="form-help">No hay alumnas disponibles con paquete vigente y créditos.</p> : null}
            </form>
          )}
        </article>
      </section>
    </main>
  );
}
