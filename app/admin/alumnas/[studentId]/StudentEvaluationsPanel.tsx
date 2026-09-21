import Link from "next/link";

import PendingActionButton from "@/app/admin/components/PendingActionButton";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import {
  inviteStudentToEvaluationAction,
  startScheduledEvaluationAction,
} from "./evaluation-actions";

type Props = {
  studentId: string;
  timeZone: string;
  error?: string;
};

function localDate(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(value: string | null) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function outcomeCopy(value: string | null) {
  if (value === "approved") return "Aprobada";
  if (value === "stays") return "Permanece";
  return "Incompleta";
}

function errorCopy(value?: string) {
  const copy: Record<string, string> = {
    evaluation_invitation_already_open:
      "Ya existe una evaluación pendiente o en curso para esta disciplina.",
    evaluation_level_not_configured:
      "El nivel actual todavía no tiene una configuración activa para evaluar.",
    evaluation_invitation_window_invalid: "Revisa la ventana de fechas de la evaluación.",
    evaluation_invitation_cadence_invalid: "Selecciona una periodicidad válida.",
    evaluation_level_not_available: "Esta disciplina no tiene un nivel activo disponible.",
    evaluation_reservation_not_active:
      "La reserva vinculada ya no está activa. La alumna debe volver a programar.",
    evaluation_not_scheduled: "La evaluación todavía no tiene una clase programada.",
    evaluation_action_failed: "No pudimos completar la acción.",
  };
  return value ? (copy[value] ?? copy.evaluation_action_failed) : null;
}

export default async function StudentEvaluationsPanel({ studentId, timeZone, error }: Props) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_READ);

  const [
    studentResult,
    disciplinesResult,
    linksResult,
    definitionsResult,
    levelsResult,
    cyclesResult,
    invitationsResult,
    evaluationsResult,
    templatesResult,
  ] = await Promise.all([
    ctx.supabase
      .from("students")
      .select("id,full_name")
      .eq("id", studentId)
      .eq("studio_id", ctx.studio.id)
      .maybeSingle(),
    ctx.supabase
      .from("disciplines")
      .select("id,name")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true)
      .order("name"),
    ctx.supabase
      .from("discipline_technical_levels")
      .select("id,discipline_id,technical_level_id,discipline_order,active")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true)
      .order("discipline_order"),
    ctx.supabase
      .from("technical_level_definitions")
      .select("id,title")
      .eq("studio_id", ctx.studio.id)
      .eq("active", true),
    ctx.supabase
      .from("student_discipline_levels")
      .select("discipline_id,discipline_technical_level_id,effective_from")
      .eq("studio_id", ctx.studio.id)
      .eq("student_id", studentId),
    ctx.supabase
      .from("student_evaluation_cycles")
      .select(
        "id,discipline_id,active,cadence_months,window_days,joined_at,next_due_on,last_evaluation_id",
      )
      .eq("studio_id", ctx.studio.id)
      .eq("student_id", studentId),
    ctx.supabase
      .from("evaluation_invitations")
      .select(
        "id,discipline_id,discipline_level_id,cycle_id,invitation_kind,status,window_start,window_end,reservation_id,offered_at,scheduled_at,completed_at",
      )
      .eq("studio_id", ctx.studio.id)
      .eq("student_id", studentId)
      .order("created_at", { ascending: false }),
    ctx.supabase
      .from("technical_evaluations")
      .select(
        "id,discipline_id,target_discipline_level_id,resulting_discipline_level_id,evaluation_invitation_id,evaluation_date,status,total_score,automatic_outcome,final_outcome,created_at,published_at",
      )
      .eq("studio_id", ctx.studio.id)
      .eq("student_id", studentId)
      .order("created_at", { ascending: false }),
    ctx.supabase
      .from("evaluation_templates")
      .select("id,discipline_technical_level_id,archived_at")
      .eq("studio_id", ctx.studio.id)
      .is("archived_at", null),
  ]);

  if (!studentResult.data) {
    return <section className="empty-state">La alumna ya no está disponible.</section>;
  }

  const disciplines = disciplinesResult.data ?? [];
  const links = linksResult.data ?? [];
  const definitions = definitionsResult.data ?? [];
  const currentLevels = levelsResult.data ?? [];
  const cycles = cyclesResult.data ?? [];
  const invitations = invitationsResult.data ?? [];
  const evaluations = evaluationsResult.data ?? [];
  const templates = templatesResult.data ?? [];

  const definitionTitle = new Map(definitions.map((item) => [item.id, item.title]));
  const levelTitle = new Map(
    links.map((item) => [item.id, definitionTitle.get(item.technical_level_id) ?? "Nivel técnico"]),
  );

  const templateIds = templates.map((item) => item.id);
  const versionsResult = templateIds.length
    ? await ctx.supabase
        .from("evaluation_template_versions")
        .select("template_id,status,version_number")
        .in("template_id", templateIds)
        .eq("status", "active")
    : { data: [] };

  const activeTemplateIds = new Set((versionsResult.data ?? []).map((item) => item.template_id));
  const configuredLevelIds = new Set(
    templates
      .filter((item) => activeTemplateIds.has(item.id))
      .map((item) => item.discipline_technical_level_id),
  );

  const reservationIds = invitations
    .map((item) => item.reservation_id)
    .filter((value): value is string => Boolean(value));
  const reservationsResult = reservationIds.length
    ? await ctx.supabase
        .from("reservations")
        .select("id,session_id,status")
        .in("id", reservationIds)
    : { data: [] };
  const reservationMap = new Map((reservationsResult.data ?? []).map((item) => [item.id, item]));
  const sessionIds = [...new Set((reservationsResult.data ?? []).map((item) => item.session_id))];
  const sessionsResult = sessionIds.length
    ? await ctx.supabase
        .from("class_sessions")
        .select("id,template_id,starts_at,ends_at")
        .in("id", sessionIds)
    : { data: [] };
  const sessionMap = new Map((sessionsResult.data ?? []).map((item) => [item.id, item]));
  const classTemplateIds = [
    ...new Set((sessionsResult.data ?? []).map((item) => item.template_id)),
  ];
  const classTemplatesResult = classTemplateIds.length
    ? await ctx.supabase.from("class_templates").select("id,name").in("id", classTemplateIds)
    : { data: [] };
  const classNameMap = new Map(
    (classTemplatesResult.data ?? []).map((item) => [item.id, item.name]),
  );

  const today = localDate(timeZone);
  const defaultEnd = addDays(today, 7);
  const openStatuses = new Set(["offered", "pending_schedule", "scheduled", "in_progress"]);
  const errorMessage = errorCopy(error);

  const disciplineCards = disciplines
    .map((discipline) => {
      const disciplineLinks = links
        .filter((item) => item.discipline_id === discipline.id)
        .sort((a, b) => a.discipline_order - b.discipline_order);
      if (!disciplineLinks.length) return null;

      const current = currentLevels.find((item) => item.discipline_id === discipline.id);
      const resolvedLevelId =
        current?.discipline_technical_level_id ?? disciplineLinks[0]?.id ?? null;
      const cycle = cycles.find((item) => item.discipline_id === discipline.id && item.active);
      const openInvitation = invitations.find(
        (item) => item.discipline_id === discipline.id && openStatuses.has(item.status),
      );
      const draftEvaluation = evaluations.find(
        (item) => item.discipline_id === discipline.id && item.status === "draft",
      );
      const latestPublished = evaluations.find(
        (item) => item.discipline_id === discipline.id && item.status === "published",
      );
      const scheduledReservation = openInvitation?.reservation_id
        ? reservationMap.get(openInvitation.reservation_id)
        : null;
      const scheduledSession = scheduledReservation
        ? sessionMap.get(scheduledReservation.session_id)
        : null;

      return {
        discipline,
        currentLevelTitle: resolvedLevelId
          ? (levelTitle.get(resolvedLevelId) ?? "Principiante")
          : null,
        cycle,
        openInvitation,
        draftEvaluation,
        latestPublished,
        scheduledSession,
        scheduledClassName: scheduledSession
          ? (classNameMap.get(scheduledSession.template_id) ?? discipline.name)
          : null,
        configured: resolvedLevelId ? configuredLevelIds.has(resolvedLevelId) : false,
      };
    })
    .filter(Boolean) as Array<{
    discipline: { id: string; name: string };
    currentLevelTitle: string | null;
    cycle: (typeof cycles)[number] | undefined;
    openInvitation: (typeof invitations)[number] | undefined;
    draftEvaluation: (typeof evaluations)[number] | undefined;
    latestPublished: (typeof evaluations)[number] | undefined;
    scheduledSession:
      { id: string; template_id: string; starts_at: string; ends_at: string } | null | undefined;
    scheduledClassName: string | null;
    configured: boolean;
  }>;

  const history = evaluations.filter((item) => item.status === "published");

  return (
    <section className="profile360-evaluations-view">
      <div className="profile360-view-heading">
        <div>
          <p className="eyebrow">EVALUACIONES</p>
          <h2>Ciclo técnico de {studentResult.data.full_name}</h2>
          <p>Consulta evaluaciones en curso, próximas acciones y resultados por disciplina.</p>
        </div>
      </div>

      {errorMessage ? <div className="notice error">{errorMessage}</div> : null}

      <div className="profile360-evaluation-discipline-list">
        {disciplineCards.map((item) => {
          const invite = item.openInvitation;
          const draft = item.draftEvaluation;
          const inProgressEvaluation =
            draft ??
            (invite?.status === "in_progress"
              ? evaluations.find((evaluation) => evaluation.evaluation_invitation_id === invite.id)
              : undefined);

          return (
            <article className="profile360-evaluation-card" key={item.discipline.id}>
              <div className="profile360-evaluation-accent" aria-hidden="true" />
              <div className="profile360-evaluation-main">
                <div className="profile360-evaluation-title-row">
                  <div>
                    <h3>{item.discipline.name}</h3>
                    <p>
                      Nivel actual: <strong>{item.currentLevelTitle ?? "Sin nivel"}</strong>
                    </p>
                  </div>
                  {inProgressEvaluation ? (
                    <span className="profile360-evaluation-chip is-magenta">En curso</span>
                  ) : invite?.status === "scheduled" ? (
                    <span className="profile360-evaluation-chip is-purple">Programada</span>
                  ) : invite?.status === "pending_schedule" ? (
                    <span className="profile360-evaluation-chip is-purple">
                      Pendiente de programar
                    </span>
                  ) : invite?.status === "offered" ? (
                    <span className="profile360-evaluation-chip is-magenta">
                      Invitación enviada
                    </span>
                  ) : item.cycle ? (
                    <span className="profile360-evaluation-chip is-green">Ciclo activo</span>
                  ) : (
                    <span className="profile360-evaluation-chip">Sin evaluaciones</span>
                  )}
                </div>

                {inProgressEvaluation ? (
                  <div className="profile360-evaluation-action-row">
                    <div>
                      <strong>Evaluación en curso</strong>
                      <span>
                        {levelTitle.get(inProgressEvaluation.target_discipline_level_id) ??
                          item.currentLevelTitle ??
                          "Nivel técnico"}
                      </span>
                    </div>
                    <Link
                      className="profile360-evaluation-primary"
                      href={`/admin/evaluaciones/${inProgressEvaluation.id}`}
                    >
                      Continuar evaluación →
                    </Link>
                  </div>
                ) : invite?.status === "scheduled" && item.scheduledSession ? (
                  <div className="profile360-evaluation-action-row">
                    <div>
                      <strong>Próxima evaluación</strong>
                      <span>
                        {item.scheduledClassName} ·{" "}
                        {formatDateTime(item.scheduledSession.starts_at, timeZone)}
                      </span>
                    </div>
                    <form action={startScheduledEvaluationAction}>
                      <input type="hidden" name="student_id" value={studentId} />
                      <input type="hidden" name="invitation_id" value={invite.id} />
                      <PendingActionButton
                        className="profile360-evaluation-primary"
                        pendingLabel="Iniciando…"
                      >
                        Iniciar evaluación
                      </PendingActionButton>
                    </form>
                  </div>
                ) : invite?.status === "pending_schedule" ? (
                  <div className="profile360-evaluation-copy">
                    <strong>Pendiente de programar</strong>
                    <span>
                      Disponible del {formatDate(invite.window_start)} al{" "}
                      {formatDate(invite.window_end)}.
                    </span>
                    <small>La alumna debe elegir una clase válida desde su portal.</small>
                  </div>
                ) : invite?.status === "offered" ? (
                  <div className="profile360-evaluation-copy">
                    <strong>Esperando respuesta de la alumna</strong>
                    <span>
                      Invitación disponible del {formatDate(invite.window_start)} al{" "}
                      {formatDate(invite.window_end)}.
                    </span>
                  </div>
                ) : (
                  <div className="profile360-evaluation-action-row">
                    <div>
                      {item.latestPublished ? (
                        <>
                          <strong>
                            Última evaluación · {outcomeCopy(item.latestPublished.final_outcome)}
                          </strong>
                          <span>
                            {formatDate(item.latestPublished.evaluation_date)} ·{" "}
                            {item.latestPublished.total_score ?? "—"}%
                          </span>
                          {item.cycle?.next_due_on ? (
                            <small>Próxima disponible: {formatDate(item.cycle.next_due_on)}</small>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <strong>Aún no forma parte del ciclo</strong>
                          <span>Puedes enviarle su primera invitación cuando corresponda.</span>
                        </>
                      )}
                    </div>

                    {!item.cycle ? (
                      <details className="profile360-evaluation-invite">
                        <summary>
                          {invitations.some(
                            (candidate) =>
                              candidate.discipline_id === item.discipline.id &&
                              candidate.status === "declined",
                          )
                            ? "Volver a invitar"
                            : "Invitar a evaluación"}
                        </summary>
                        <form action={inviteStudentToEvaluationAction}>
                          <input type="hidden" name="student_id" value={studentId} />
                          <input type="hidden" name="discipline_id" value={item.discipline.id} />
                          <label>
                            <span>Disponible desde</span>
                            <input name="window_start" type="date" defaultValue={today} required />
                          </label>
                          <label>
                            <span>Hasta</span>
                            <input
                              name="window_end"
                              type="date"
                              defaultValue={defaultEnd}
                              required
                            />
                          </label>
                          <label>
                            <span>Periodicidad posterior</span>
                            <select name="cadence_months" defaultValue="3">
                              <option value="3">Cada 3 meses</option>
                              <option value="6">Cada 6 meses</option>
                            </select>
                          </label>
                          {!item.configured ? (
                            <p className="profile360-evaluation-warning">
                              Configura y guarda este nivel antes de enviar una invitación.
                            </p>
                          ) : null}
                          <PendingActionButton
                            className="profile360-evaluation-primary"
                            pendingLabel="Enviando…"
                            disabled={!item.configured}
                          >
                            Enviar invitación
                          </PendingActionButton>
                        </form>
                      </details>
                    ) : null}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <section className="profile360-evaluation-history">
        <div className="profile360-package-group-heading">
          <strong>Historial de evaluaciones</strong>
          <span>{history.length}</span>
        </div>

        {history.length ? (
          <div className="profile360-evaluation-history-list">
            {history.map((evaluation) => {
              const discipline = disciplines.find((item) => item.id === evaluation.discipline_id);
              return (
                <Link
                  href={`/admin/evaluaciones/${evaluation.id}`}
                  className="profile360-evaluation-history-row"
                  key={evaluation.id}
                >
                  <span>{formatDate(evaluation.evaluation_date)}</span>
                  <strong>{discipline?.name ?? "Disciplina"}</strong>
                  <span>
                    {levelTitle.get(evaluation.target_discipline_level_id) ?? "Nivel técnico"}
                  </span>
                  <span
                    className={`profile360-evaluation-chip ${
                      evaluation.final_outcome === "approved" ? "is-green" : "is-warning"
                    }`}
                  >
                    {outcomeCopy(evaluation.final_outcome)}
                  </span>
                  <strong>{evaluation.total_score ?? "—"}%</strong>
                  <span aria-hidden="true">›</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">Aún no hay evaluaciones finalizadas.</div>
        )}
      </section>
    </section>
  );
}
