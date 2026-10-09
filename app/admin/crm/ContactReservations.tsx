import Link from "next/link";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { setCrmAttendance } from "./actions";
import PendingActionButton from "../components/PendingActionButton";

export default async function ContactReservations({
  studentId,
  personId,
  trial = false,
}: {
  studentId: string;
  personId: string;
  trial?: boolean;
}) {
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.STUDENTS_READ);
  if (!can(CAPABILITIES.SCHEDULE_READ)) return null;
  const { data: reservations, error } = await supabase
    .from("reservations")
    .select("id,session_id,status")
    .eq("studio_id", studio.id)
    .eq("student_id", studentId)
    .order("booked_at", { ascending: false })
    .limit(12);
  if (error) throw new Error("crm_reservations_unavailable");
  const ids = [...new Set((reservations || []).map((r) => r.session_id))];
  const { data: sessions, error: sessionError } = ids.length
    ? await supabase
        .from("class_sessions")
        .select("id,template_id,starts_at,ends_at,status")
        .eq("studio_id", studio.id)
        .in("id", ids)
    : { data: [], error: null };
  if (sessionError) throw new Error("crm_sessions_unavailable");
  const templates = [...new Set((sessions || []).map((s) => s.template_id))];
  const { data: names, error: nameError } = templates.length
    ? await supabase
        .from("class_templates")
        .select("id,name")
        .eq("studio_id", studio.id)
        .in("id", templates)
    : { data: [], error: null };
  if (nameError) throw new Error("crm_class_names_unavailable");
  const now = new Date().toISOString();
  return (
    <details className="crm-panel crm-reservations" open={trial}>
      <summary>Clases y asistencia · {reservations?.length || 0} reservas recientes</summary>
      <div className="crm-contact-actions">
        {can(CAPABILITIES.SCHEDULE_WRITE) && (
          <Link className="crm-secondary" href={`/admin/alumnas/${studentId}/reservar`}>
            Reservar clase
          </Link>
        )}
        {can(CAPABILITIES.SALES_WRITE) && (
          <Link className="crm-secondary" href={`/admin/ventas/nueva?student_id=${studentId}`}>
            Registrar inscripción o paquete
          </Link>
        )}
      </div>
      {!reservations?.length && <p className="crm-help">Sin reservas registradas.</p>}
      {reservations?.map((r) => {
        const s = sessions?.find((s) => s.id === r.session_id);
        if (!s) return null;
        const inProgress = s.status === "scheduled" && s.starts_at <= now && s.ends_at > now;
        const correctable = s.status === "completed" && ["attended", "no_show"].includes(r.status);
        const operable = ["reserved", "attended", "no_show"].includes(r.status);
        return (
          <article key={r.id} className="crm-history-item">
            <strong>{names?.find((n) => n.id === s.template_id)?.name || "Clase"}</strong>
            <p>
              {new Date(s.starts_at).toLocaleString("es-MX", { timeZone: studio.timezone })} ·{" "}
              {(
                {
                  reserved: "Reservada",
                  attended: "Asistió",
                  no_show: "No asistió",
                  cancelled_on_time: "Cancelada a tiempo",
                  cancelled_late: "Cancelada tarde",
                  cancelled_by_studio: "Cancelada por el estudio",
                } as Record<string, string>
              )[r.status] || r.status}
            </p>
            {can(CAPABILITIES.ATTENDANCE_WRITE) && operable && (inProgress || correctable) ? (
              <form action={setCrmAttendance.bind(null, personId)} className="crm-contact-actions">
                <input type="hidden" name="reservation_id" value={r.id} />
                {correctable && (
                  <label>
                    Motivo de corrección
                    <input name="reason" required maxLength={1000} />
                  </label>
                )}
                <PendingActionButton
                  className="crm-secondary"
                  name="status"
                  value="attended"
                  pendingLabel="Guardando…"
                >
                  Asistió
                </PendingActionButton>
                <PendingActionButton
                  className="crm-secondary"
                  name="status"
                  value="no_show"
                  pendingLabel="Guardando…"
                >
                  No asistió
                </PendingActionButton>
              </form>
            ) : (
              <p className="crm-help">
                La asistencia se registra durante la clase. Las correcciones al cierre requieren un
                motivo y permisos.
              </p>
            )}
          </article>
        );
      })}
    </details>
  );
}
