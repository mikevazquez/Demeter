import Link from "next/link";
import { redirect } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { STUDIO_MODULES } from "@/lib/auth/modules";
import { getAdminContext } from "@/lib/auth/admin-context";
import { SessionOperations } from "../../hoy/SessionOperations";
import { cancelSession, setMinimumOverride, updateSession } from "./actions";

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

function formatExpiry(value: string | null, locale: string) {
  if (!value) return "Sin vencimiento";
  return `Vence ${new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`))}`;
}

function validDateKey(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function formatSessionDateTime(value: string | null, timeZone: string, locale: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function minimumStatusCopy(status: string) {
  if (status === "met") return "Mínimo alcanzado";
  if (status === "cancelled") return "Cancelada automáticamente";
  if (status === "overridden") return "Excepción activa";
  if (status === "pending") return "Revisión pendiente";
  return "Sin revisión automática";
}

export default async function SessionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ error?: string; created?: string; from?: string }>;
}) {
  const { sessionId } = await params;
  const query = await searchParams;
  const { supabase, studio, can, hasModule } = await getAdminContext(CAPABILITIES.SCHEDULE_READ);
  const resourcesEnabled = hasModule(STUDIO_MODULES.RESOURCES);

  const { data: session } = await supabase
    .from("class_sessions")
    .select(
      "id,template_id,starts_at,ends_at,capacity,status,notes,space_id,instructor_id,recurring_schedule_id,is_schedule_exception,requires_resource,resource_uses_per_item,minimum_reservations_enabled,minimum_reservations,minimum_review_minutes_before,minimum_override_allowed,minimum_override,minimum_review_status,minimum_review_at,minimum_reviewed_at,minimum_reservations_at_review,minimum_cancelled_at,minimum_cancelled_reservations,minimum_credits_returned",
    )
    .eq("id", sessionId)
    .eq("studio_id", studio.id)
    .single();

  if (!session) redirect("/admin");

  const canEdit = can(CAPABILITIES.SCHEDULE_WRITE);
  const canAttendance = can(CAPABILITIES.ATTENDANCE_WRITE);
  const canCreateStudent = can(CAPABILITIES.STUDENTS_WRITE);

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
      .select("name,discipline_id,duration_minutes,credit_cost,color_hex")
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
      .select("id,student_id,guest_person_id,status,acquisition_id")
      .eq("session_id", sessionId)
      .in("status", ["reserved", "attended", "no_show"])
      .order("booked_at"),
  ]);

  const timeZone = studio.timezone;
  const locale = studio.locale;
  const personMap = new Map(
    (persons ?? []).map((person) => [
      person.id,
      [person.first_name, person.last_name].filter(Boolean).join(" ") || "Persona",
    ]),
  );
  const instructorMap = new Map(
    (instructors ?? []).map((instructor) => [
      instructor.id,
      personMap.get(instructor.person_id) ?? "Instructor",
    ]),
  );
  const spaceMap = new Map((spaces ?? []).map((space) => [space.id, space.name]));
  const studentMap = new Map((students ?? []).map((student) => [student.id, student.full_name]));

  const dateLabel = new Intl.DateTimeFormat(locale, {
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

  const reservationIds = (reservations ?? []).map((reservation) => reservation.id);
  const { data: evaluationInvitations } = reservationIds.length
    ? await supabase
        .from("evaluation_invitations")
        .select("id,reservation_id,status")
        .in("reservation_id", reservationIds)
        .in("status", ["scheduled", "in_progress"])
    : {
        data: [] as { id: string; reservation_id: string | null; status: string }[],
      };
  const evaluationByReservation = new Map(
    (evaluationInvitations ?? [])
      .filter((item) => item.reservation_id)
      .map((item) => [item.reservation_id!, item]),
  );

  const acquisitionIds = [
    ...new Set(
      (reservations ?? []).map((reservation) => reservation.acquisition_id).filter(Boolean),
    ),
  ] as string[];

  const { data: acquisitions } = acquisitionIds.length
    ? await supabase
        .from("product_acquisitions")
        .select("id,product_template_id,expires_on,unlimited")
        .in("id", acquisitionIds)
    : {
        data: [] as {
          id: string;
          product_template_id: string;
          expires_on: string | null;
          unlimited: boolean;
        }[],
      };

  const productIds = [...new Set((acquisitions ?? []).map((item) => item.product_template_id))];
  const { data: products } = productIds.length
    ? await supabase.from("product_templates").select("id,name").in("id", productIds)
    : { data: [] as { id: string; name: string }[] };

  const balances = await Promise.all(
    (acquisitions ?? []).map(async (acquisition) => {
      if (acquisition.unlimited) return [acquisition.id, null] as const;
      const { data } = await supabase.rpc("acquisition_credit_balance", {
        target_acquisition_id: acquisition.id,
      });
      return [acquisition.id, typeof data === "number" ? data : 0] as const;
    }),
  );

  const acquisitionMap = new Map((acquisitions ?? []).map((item) => [item.id, item]));
  const productMap = new Map((products ?? []).map((item) => [item.id, item.name]));
  const balanceMap = new Map(balances);

  const bookedStudentIds = new Set(
    (reservations ?? []).map((reservation) => reservation.student_id).filter(Boolean),
  );
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

  const roster = (reservations ?? []).map((reservation) => {
    const isGuest = Boolean(reservation.guest_person_id);
    const evaluationInvitation = evaluationByReservation.get(reservation.id);
    const acquisition = reservation.acquisition_id
      ? acquisitionMap.get(reservation.acquisition_id)
      : null;
    const balance = reservation.acquisition_id ? balanceMap.get(reservation.acquisition_id) : null;

    return {
      id: reservation.id,
      studentName: isGuest
        ? (personMap.get(reservation.guest_person_id!) ?? "Invitado")
        : reservation.student_id
          ? (studentMap.get(reservation.student_id) ?? "Alumna")
          : "Alumna",
      status: reservation.status,
      packageLabel: isGuest
        ? "Invitación"
        : acquisition
          ? (productMap.get(acquisition.product_template_id) ?? "Producto activo")
          : "Sin producto vinculado",
      creditsLabel: isGuest
        ? "Beneficio por nivel"
        : acquisition?.unlimited
          ? "Ilimitado"
          : acquisition
            ? `${balance ?? 0} créditos disponibles`
            : "—",
      expiresLabel: isGuest ? "Misma clase" : formatExpiry(acquisition?.expires_on ?? null, locale),
      studentId: reservation.student_id,
      evaluationInvitationId: evaluationInvitation?.id ?? null,
      evaluationStatus: evaluationInvitation?.status ?? null,
    };
  });

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

  const occupied = (reservations ?? []).filter((reservation) =>
    ["reserved", "attended"].includes(reservation.status),
  ).length;
  const attended = (reservations ?? []).filter(
    (reservation) => reservation.status === "attended",
  ).length;
  const noShow = (reservations ?? []).filter(
    (reservation) => reservation.status === "no_show",
  ).length;
  const available = Math.max(session.capacity - occupied, 0);

  const from = validDateKey(query.from) ? query.from! : "";
  const backHref = from ? `/admin?date=${from}` : "/admin";
  const returnTo = `/admin/agenda/${sessionId}${from ? `?from=${from}` : ""}`;

  const errorCopy: Record<string, string> = {
    conflict: "El instructor o espacio ya está ocupado en ese horario.",
    space: "El espacio no admite ese cupo.",
    instructor: "Selecciona un instructor activo del estudio.",
    edit: "No se pudieron guardar los cambios.",
    resource_space_assigned:
      "No puedes cambiar el espacio mientras existan reservas con recursos asignados. Reasigna o cancela esas reservas primero.",
    booking: "No se pudo crear la reserva.",
    no_active_product: "La alumna no tiene un paquete o membresía vigente para esta clase.",
    enrollment_required: "La alumna no tiene una inscripción vigente para la fecha de esta clase.",
    payment_pending: "El paquete está bloqueado porque no se ha registrado pago.",
    outside_product: "El producto activo de la alumna no incluye esta disciplina.",
    no_credits: "La alumna ya no tiene créditos disponibles.",
    session_full: "La clase está llena. No se permiten sobrecupos automáticos.",
    already_reserved: "La alumna ya tiene una reserva activa en esta clase.",
    student_not_operable: "La alumna no está habilitada para reservar.",
    session_not_bookable: "Esta sesión ya no admite reservas.",
    cancel: "No se pudo cancelar la reserva.",
    forbidden: "No tienes permisos para realizar esta acción.",
    attendance: "No se pudo registrar la asistencia.",
    walkin_invalid: "Completa los datos mínimos para registrar la walk-in.",
    minimum_override: "No se pudo cambiar la excepción del mínimo de reservas.",
    minimum_review_already_completed: "La revisión automática de esta sesión ya terminó.",
    minimum_rule_disabled: "Esta sesión no tiene activa la regla de mínimo de reservas.",
    minimum_override_not_allowed: "La actividad no permite excepciones para esta regla.",
  };

  const showManagementNotice =
    query.created === "edit" ||
    query.created === "cancel-session" ||
    query.created === "minimum-override";

  const { data: sessionResourceRows } = resourcesEnabled && session.requires_resource
    ? await supabase
        .from("session_resources")
        .select("id,enabled")
        .eq("studio_id", studio.id)
        .eq("session_id", session.id)
    : { data: [] as { id: string; enabled: boolean }[] };

  const enabledSessionResources = (sessionResourceRows ?? []).filter((item) => item.enabled).length;

  const { data: cancellationNotifications } =
    session.minimum_review_status === "cancelled"
      ? await supabase
          .from("app_notifications")
          .select("recipient_kind,created_at")
          .eq("studio_id", studio.id)
          .eq("session_id", session.id)
          .eq("notification_type", "session_minimum_cancelled")
      : { data: [] as { recipient_kind: string; created_at: string }[] };

  const studentNotificationCount = (cancellationNotifications ?? []).filter(
    (item) => item.recipient_kind === "student",
  ).length;
  const coachNotificationCount = (cancellationNotifications ?? []).filter(
    (item) => item.recipient_kind === "instructor",
  ).length;

  return (
    <main className="dashboard-shell admin-class-detail admin-ux04-session-detail">
      <header className="topbar admin-class-detail-header">
        <div>
          <Link className="back-link compact" href={backHref}>
            ← Hoy
          </Link>
          <p className="eyebrow">OPERACIÓN DE CLASE · {studio.name}</p>
          <h1 className="dashboard-title">{template?.name ?? "Clase"}</h1>
          <p>
            {dateLabel} ·{" "}
            {session.space_id ? (spaceMap.get(session.space_id) ?? "Espacio") : "Sin espacio"} ·{" "}
            {session.instructor_id
              ? (instructorMap.get(session.instructor_id) ?? "Instructor")
              : "Sin instructor"}
          </p>
        </div>
        <Link className="secondary-button" href="/admin/agenda">
          Ver agenda
        </Link>
      </header>

      {showManagementNotice ? (
        <div className="notice success">Cambio guardado correctamente.</div>
      ) : null}
      {query.error ? (
        <div className="notice error">
          {errorCopy[decodeURIComponent(query.error)] ?? "No se pudo completar la operación."}
        </div>
      ) : null}

      <section className="stat-grid admin-class-stats">
        <article className="stat-card">
          <span>Cupo</span>
          <strong>
            {occupied}/{session.capacity}
          </strong>
          <small>{available} lugares disponibles</small>
        </article>
        <article className="stat-card">
          <span>Reservadas</span>
          <strong>{occupied}</strong>
          <small>Lugares activos</small>
        </article>
        <article className="stat-card">
          <span>Asistieron</span>
          <strong>{attended}</strong>
          <small>Marcadas en clase</small>
        </article>
        <article className="stat-card">
          <span>No show</span>
          <strong>{noShow}</strong>
          <small>Ausencias registradas</small>
        </article>
      </section>

      {session.minimum_reservations_enabled ? (
        <section
          className={`panel admin-minimum-status is-${session.minimum_review_status}`}
          aria-label="Mínimo de reservas"
        >
          <div className="admin-minimum-status-head">
            <div>
              <p className="eyebrow">MÍNIMO DE RESERVAS</p>
              <h2>{minimumStatusCopy(session.minimum_review_status)}</h2>
              <p>
                {occupied} de {session.capacity} reservados · mínimo {session.minimum_reservations}
              </p>
            </div>
            <span className="admin-minimum-status-pill">
              {minimumStatusCopy(session.minimum_review_status)}
            </span>
          </div>

          <div className="admin-minimum-grid">
            <div>
              <span>Reservas actuales</span>
              <strong>{occupied}</strong>
            </div>
            <div>
              <span>Mínimo requerido</span>
              <strong>{session.minimum_reservations}</strong>
            </div>
            <div>
              <span>Revisión automática</span>
              <strong>{formatSessionDateTime(session.minimum_review_at, timeZone, locale)}</strong>
            </div>
            <div>
              <span>Estado</span>
              <strong>{minimumStatusCopy(session.minimum_review_status)}</strong>
            </div>
          </div>

          {session.minimum_review_status === "cancelled" ? (
            <div className="admin-minimum-cancelled-detail">
              <strong>Sesión cancelada por mínimo no alcanzado</strong>
              <p>
                Cancelada {formatSessionDateTime(session.minimum_cancelled_at, timeZone, locale)} · mínimo
                requerido: {session.minimum_reservations} · reservas al revisar:{" "}
                {session.minimum_reservations_at_review ?? 0}.
              </p>
              <p>
                Reservas canceladas: {session.minimum_cancelled_reservations ?? 0} · créditos
                devueltos: {session.minimum_credits_returned ?? 0}.
              </p>
              <p>
                Avisos en app: {studentNotificationCount} alumna
                {studentNotificationCount === 1 ? "" : "s"} ·{" "}
                {coachNotificationCount > 0
                  ? "coach notificado"
                  : session.instructor_id
                    ? "aviso al coach pendiente"
                    : "sin coach asignado"}
                .
              </p>
            </div>
          ) : null}

          {session.minimum_review_status === "met" ? (
            <div className="admin-minimum-success">
              <span>✓</span>
              <p>
                La revisión se completó{" "}
                {formatSessionDateTime(session.minimum_reviewed_at, timeZone, locale)} con{" "}
                {session.minimum_reservations_at_review ?? occupied} reservas. Esta sesión ya no
                volverá a evaluarse automáticamente.
              </p>
            </div>
          ) : null}

          {session.minimum_review_status === "overridden" ? (
            <div className="admin-minimum-override-note">
              Esta sesión se impartirá aunque no alcance el mínimo. La regla general de la actividad
              no cambia.
            </div>
          ) : null}

          {canEdit &&
          session.status === "scheduled" &&
          session.minimum_override_allowed &&
          (session.minimum_review_status === "pending" ||
            session.minimum_review_status === "overridden") ? (
            <form action={setMinimumOverride} className="admin-minimum-override-form">
              <input type="hidden" name="session_id" value={sessionId} />
              <input type="hidden" name="return_to" value={returnTo} />
              <input
                type="hidden"
                name="enabled"
                value={session.minimum_override ? "false" : "true"}
              />
              <div>
                <strong>Impartir aunque no alcance el mínimo</strong>
                <small>
                  Esta excepción aplica únicamente a esta sesión y no modifica la actividad.
                </small>
              </div>
              <button type="submit" className={session.minimum_override ? "is-active" : ""}>
                {session.minimum_override ? "Quitar excepción" : "Activar excepción"}
              </button>
            </form>
          ) : null}
        </section>
      ) : null}

      <section className="panel admin-class-operations-panel">
        <SessionOperations
          sessionId={sessionId}
          returnDate={from}
          sessionStatus={session.status}
          startsAt={session.starts_at}
          endsAt={session.ends_at}
          roster={roster}
          candidates={operationCandidates}
          available={available}
          canAttendance={canAttendance && session.status !== "cancelled"}
          canBook={canEdit && session.status === "scheduled"}
          canCreateStudent={canCreateStudent && session.status === "scheduled"}
          locale={locale}
          timeZone={timeZone}
          returnTo={returnTo}
          initiallyOpen
          showToggle={false}
        />
      </section>

      {resourcesEnabled && session.requires_resource ? (
        <section className="panel">
          <p className="eyebrow">RECURSOS</p>
          <h2>Recursos de esta sesión</h2>
          <p>
            {enabledSessionResources} recursos habilitados · {session.resource_uses_per_item} uso
            {session.resource_uses_per_item === 1 ? "" : "s"} por recurso
          </p>
          <Link className="secondary-button" href={`/admin/agenda/${sessionId}/recursos`}>
            Configurar recursos
          </Link>
        </section>
      ) : null}

      {canEdit && session.status !== "cancelled" ? (
        <details className="panel admin-session-settings">
          <summary>
            <span>
              <small>CONFIGURACIÓN</small>
              <strong>Horario y operación</strong>
            </span>
            <b aria-hidden="true">⌄</b>
          </summary>

          <div className="admin-session-settings-body">
            <form action={updateSession} className="compact-form admin-session-management-form">
              <input type="hidden" name="session_id" value={sessionId} />
              <input type="hidden" name="return_to" value={returnTo} />

              <div className="admin-session-field-grid">
                <label>
                  <span>Horario</span>
                  <input
                    name="starts_at"
                    type="datetime-local"
                    defaultValue={localInput}
                    required
                  />
                </label>
                <label>
                  <span>Coach</span>
                  <select name="instructor_id" defaultValue={session.instructor_id ?? ""}>
                    <option value="">Sin instructor</option>
                    {instructors?.map((instructor) => (
                      <option key={instructor.id} value={instructor.id}>
                        {instructorMap.get(instructor.id)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Espacio</span>
                  <select name="space_id" defaultValue={session.space_id ?? ""}>
                    <option value="">Sin espacio</option>
                    {spaces?.map((space) => (
                      <option key={space.id} value={space.id}>
                        {space.name}
                        {space.capacity ? ` · máx. ${space.capacity}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Cupo</span>
                  <input
                    name="capacity"
                    type="number"
                    min="1"
                    defaultValue={session.capacity}
                    required
                  />
                </label>
              </div>

              <label className="admin-session-notes">
                <span>Notas</span>
                <textarea name="notes" rows={3} defaultValue={session.notes ?? ""} />
              </label>

              {session.recurring_schedule_id ? (
                <fieldset className="admin-session-scope">
                  <legend>Aplicar a</legend>
                  <label>
                    <input type="radio" name="scope" value="single" defaultChecked /> Solo esta
                    sesión
                  </label>
                  <label>
                    <input type="radio" name="scope" value="future" /> Esta y siguientes
                  </label>
                </fieldset>
              ) : (
                <input type="hidden" name="scope" value="single" />
              )}

              <div className="admin-session-form-actions">
                <button className="primary-button" type="submit">
                  Guardar cambios
                </button>
                <button
                  className="admin-session-cancel-button"
                  type="submit"
                  formAction={cancelSession}
                  formNoValidate
                >
                  Cancelar clase
                </button>
              </div>

              <small className="admin-session-cancel-note">
                Al cancelar, las reservas activas se cancelarán y sus créditos se liberarán.
              </small>
            </form>
          </div>
        </details>
      ) : null}
    </main>
  );
}
