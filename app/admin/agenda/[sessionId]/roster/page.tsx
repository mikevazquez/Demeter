import Link from "next/link";
import { redirect } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import { SessionOperations } from "../../../hoy/SessionOperations";

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
  enrollment_required: "inscripción no vigente",
  payment_pending: "pago pendiente",
  outside_product: "fuera de paquete",
  no_credits: "sin créditos",
};

function attendanceLabel(status: string) {
  if (status === "attended") return "Asistió";
  if (status === "no_show") return "No asistió";
  return "Pendiente";
}

export default async function AdminSessionRosterPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const { supabase, studio, can } = await getAdminContext(CAPABILITIES.ATTENDANCE_WRITE);

  const { data: session } = await supabase
    .from("class_sessions")
    .select("id,template_id,starts_at,ends_at,capacity,status,space_id,instructor_id")
    .eq("id", sessionId)
    .eq("studio_id", studio.id)
    .single();

  if (!session) redirect("/admin");

  const [
    { data: template },
    { data: reservations },
    { data: students },
    { data: persons },
    { data: space },
  ] = await Promise.all([
    supabase
      .from("class_templates")
      .select("name")
      .eq("id", session.template_id)
      .eq("studio_id", studio.id)
      .single(),
    supabase
      .from("reservations")
      .select("id,student_id,guest_person_id,status")
      .eq("session_id", sessionId)
      .in("status", ["reserved", "attended", "no_show"])
      .order("booked_at"),
    supabase
      .from("students")
      .select("id,full_name,active,lifecycle_status")
      .eq("studio_id", studio.id)
      .eq("active", true)
      .eq("lifecycle_status", "active")
      .order("full_name"),
    supabase
      .from("persons")
      .select("id,first_name,last_name")
      .eq("studio_id", studio.id),
    session.space_id
      ? supabase
          .from("spaces")
          .select("name")
          .eq("id", session.space_id)
          .eq("studio_id", studio.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const studentMap = new Map((students ?? []).map((student) => [student.id, student.full_name]));
  const personMap = new Map(
    (persons ?? []).map((person) => [
      person.id,
      [person.first_name, person.last_name].filter(Boolean).join(" ") || "Invitado",
    ]),
  );

  const roster = (reservations ?? []).map((reservation) => {
    const isGuest = Boolean(reservation.guest_person_id);

    return {
      id: reservation.id,
      studentName: isGuest
        ? (personMap.get(reservation.guest_person_id!) ?? "Invitado")
        : reservation.student_id
          ? (studentMap.get(reservation.student_id) ?? "Alumna")
          : "Alumna",
      status: reservation.status,
      packageLabel: isGuest ? "Invitación" : "Reserva",
      creditsLabel: isGuest ? "Beneficio por nivel" : "Studio Flow",
      expiresLabel: "—",
      studentId: reservation.student_id,
      evaluationInvitationId: null,
      evaluationStatus: null,
    };
  });

  const bookedStudentIds = new Set(
    (reservations ?? []).map((reservation) => reservation.student_id).filter(Boolean),
  );
  const candidates = (students ?? []).filter((student) => !bookedStudentIds.has(student.id));
  const eligibilityEntries = can(CAPABILITIES.SCHEDULE_WRITE)
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

  const operationCandidates = candidates.map((student) => {
    const eligibility = eligibilityMap.get(student.id);
    const reason = eligibility?.reason_code
      ? (eligibilityCopy[eligibility.reason_code] ?? "no elegible")
      : "no elegible";

    return {
      id: student.id,
      fullName: student.full_name,
      eligible: eligibility?.eligible === true,
      detail: eligibility?.eligible
        ? eligibility.unlimited
          ? "membresía ilimitada"
          : `${eligibility.available_credits ?? 0} créditos`
        : reason,
    };
  });

  const occupied = roster.filter((item) => ["reserved", "attended"].includes(item.status)).length;
  const attended = roster.filter((item) => item.status === "attended").length;
  const noShow = roster.filter((item) => item.status === "no_show").length;
  const pending = roster.filter((item) => item.status === "reserved").length;
  const available = Math.max(session.capacity - occupied, 0);
  const returnTo = `/admin/agenda/${sessionId}/roster`;

  const dateLabel = new Intl.DateTimeFormat("es-MX", {
    timeZone: studio.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(session.starts_at));

  return (
    <main className="dashboard-shell admin-class-detail admin-ux04-session-detail">
      <header className="topbar admin-class-detail-header">
        <div>
          <Link className="back-link compact" href={`/admin/agenda/${sessionId}`}>
            ← Detalle de clase
          </Link>
          <p className="eyebrow">ROSTER EN VIVO · {studio.name}</p>
          <h1 className="dashboard-title">{template?.name ?? "Clase"}</h1>
          <p>
            {dateLabel}
            {space?.name ? ` · ${space.name}` : ""}
          </p>
        </div>
        <Link className="secondary-button" href={`/admin/agenda/${sessionId}`}>
          Ver operación completa
        </Link>
      </header>

      <section className="stat-grid admin-class-stats">
        <article className="stat-card">
          <span>En roster</span>
          <strong>
            {roster.length}/{session.capacity}
          </strong>
          <small>{available} lugares disponibles</small>
        </article>
        <article className="stat-card">
          <span>Asistieron</span>
          <strong>{attended}</strong>
          <small>{attendanceLabel("attended")}</small>
        </article>
        <article className="stat-card">
          <span>No asistieron</span>
          <strong>{noShow}</strong>
          <small>{attendanceLabel("no_show")}</small>
        </article>
        <article className="stat-card">
          <span>Pendientes</span>
          <strong>{pending}</strong>
          <small>{attendanceLabel("reserved")}</small>
        </article>
      </section>

      <section className="panel admin-class-operations-panel">
        <SessionOperations
          sessionId={sessionId}
          returnDate=""
          sessionStatus={session.status}
          startsAt={session.starts_at}
          endsAt={session.ends_at}
          roster={roster}
          candidates={operationCandidates}
          available={available}
          canAttendance
          canBook={can(CAPABILITIES.SCHEDULE_WRITE) && session.status === "scheduled"}
          canCreateStudent={can(CAPABILITIES.STUDENTS_WRITE) && session.status === "scheduled"}
          returnTo={returnTo}
          initiallyOpen
          showToggle={false}
        />
      </section>
    </main>
  );
}
