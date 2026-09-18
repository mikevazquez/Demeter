import Link from "next/link";
import PendingActionButton from "@/app/admin/components/PendingActionButton";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { reserveStudentFromOnboarding } from "./actions";

type Eligibility = {
  eligible?: boolean;
  reason_code?: string | null;
  available_credits?: number | null;
  unlimited?: boolean;
  credit_cost?: number | null;
};

const reasonCopy: Record<string, string> = {
  invalid_request: "No se pudo identificar la clase.",
  student_not_operable: "La alumna no está habilitada para reservar.",
  session_not_found: "La clase ya no está disponible.",
  session_not_bookable: "La clase ya no admite reservas.",
  already_reserved: "La alumna ya está reservada en esta clase.",
  session_full: "La clase está llena.",
  enrollment_required: "La inscripción no está vigente para la fecha de esta clase.",
  payment_pending: "El paquete está bloqueado porque no se ha registrado pago.",
  no_active_product: "No hay un paquete vigente para esta clase.",
  outside_product: "El paquete no incluye esta disciplina.",
  no_credits: "No hay créditos disponibles.",
  booking: "No se pudo completar la reserva.",
};

export default async function StudentFirstReservationPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { studentId } = await params;
  const query = await searchParams;
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.SCHEDULE_READ);

  const { data: student } = await supabase
    .from("students")
    .select("id,full_name,active,lifecycle_status")
    .eq("id", studentId)
    .eq("studio_id", studio.id)
    .neq("lifecycle_status", "archived")
    .maybeSingle();

  if (!student) notFound();

  const { data: sessions } = await supabase
    .from("class_sessions")
    .select("id,template_id,starts_at,capacity,status")
    .eq("studio_id", studio.id)
    .eq("status", "scheduled")
    .gt("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(24);

  const templateIds = [...new Set((sessions ?? []).map((item) => item.template_id))];
  const { data: templates } = templateIds.length
    ? await supabase
        .from("class_templates")
        .select("id,name,credit_cost")
        .eq("studio_id", studio.id)
        .in("id", templateIds)
    : { data: [] };

  const templateMap = new Map((templates ?? []).map((item) => [item.id, item]));
  const canBook = can(CAPABILITIES.SCHEDULE_WRITE);

  const eligibilityEntries = canBook
    ? await Promise.all(
        (sessions ?? []).map(async (session) => {
          const { data } = await supabase.rpc("booking_eligibility", {
            target_session_id: session.id,
            target_student_id: student.id,
          });
          return [session.id, (data ?? {}) as Eligibility] as const;
        }),
      )
    : [];

  const eligibilityMap = new Map(eligibilityEntries);
  const timeZone = studio.timezone ?? "America/Mexico_City";

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <Link className="back-link compact" href={`/admin/alumnas/${student.id}`}>
            ← Perfil 360
          </Link>
          <p className="eyebrow">PRIMERA RESERVA · {studio.name}</p>
          <h1 className="dashboard-title">{student.full_name}</h1>
          <p>
            La alumna ya está seleccionada. Elige la clase; Studio Flow valida paquete, inscripción,
            créditos y cupo.
          </p>
        </div>
      </header>

      {query.error ? (
        <div className="notice error">
          {reasonCopy[decodeURIComponent(query.error)] ?? "No se pudo completar la reserva."}
        </div>
      ) : null}

      {!student.active || student.lifecycle_status !== "active" ? (
        <section className="panel">
          <h2>La alumna no está habilitada para reservar</h2>
          <Link
            className="primary-button inline-flex"
            href={`/admin/alumnas/${student.id}#estado-alumna`}
          >
            Resolver desde Perfil 360
          </Link>
        </section>
      ) : !canBook ? (
        <section className="panel">
          <h2>Tu rol no puede crear reservas</h2>
          <p>Puedes terminar el alta y dejar la reserva para una persona con permiso de Agenda.</p>
          <Link className="primary-button inline-flex" href={`/admin/alumnas/${student.id}`}>
            Terminar alta
          </Link>
        </section>
      ) : !(sessions ?? []).length ? (
        <section className="panel">
          <div className="empty-state">No hay clases futuras programadas.</div>
        </section>
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">CLASES PRÓXIMAS</p>
              <h2>Selecciona una clase</h2>
            </div>
            <span className="count-badge">{sessions?.length ?? 0}</span>
          </div>

          <div className="student-list">
            {(sessions ?? []).map((session) => {
              const template = templateMap.get(session.template_id);
              const eligibility = eligibilityMap.get(session.id);
              const label = new Intl.DateTimeFormat("es-MX", {
                timeZone,
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(session.starts_at));
              const reason = eligibility?.reason_code
                ? (reasonCopy[eligibility.reason_code] ?? "No disponible")
                : null;

              return (
                <div className="student-row" key={session.id}>
                  <div>
                    <strong>{template?.name ?? "Clase"}</strong>
                    <span>{label}</span>
                    <span>
                      {eligibility?.eligible
                        ? eligibility.unlimited
                          ? "Paquete ilimitado válido"
                          : `${eligibility.available_credits ?? 0} créditos disponibles · usa ${eligibility.credit_cost ?? template?.credit_cost ?? 1}`
                        : reason}
                    </span>
                  </div>
                  {eligibility?.eligible ? (
                    <form action={reserveStudentFromOnboarding}>
                      <input type="hidden" name="student_id" value={student.id} />
                      <input type="hidden" name="session_id" value={session.id} />
                      <PendingActionButton className="primary-button" pendingLabel="Reservando…">
                        Reservar
                      </PendingActionButton>
                    </form>
                  ) : (
                    <span className="status-pill">No disponible</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="toolbar-actions">
        <Link className="ghost-button" href={`/admin/alumnas/${student.id}`}>
          Terminar sin reservar
        </Link>
      </div>
    </main>
  );
}
