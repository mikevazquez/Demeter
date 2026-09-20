import Link from "next/link";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

const statusCopy: Record<string, string> = {
  pending: "Pendiente",
  in_progress: "En proceso",
  resolved: "Resuelta",
  discarded: "Descartada",
};

const priorityCopy: Record<string, string> = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

const priorityRank: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Mexico_City",
  }).format(new Date(value));
}

export default async function RequiredActionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; priority?: string; assignee?: string }>;
}) {
  const { supabase, studio, user } = await getAdminContext(CAPABILITIES.REQUIRED_ACTIONS_READ);
  const params = await searchParams;

  const statusFilter = ["open", "pending", "in_progress", "resolved", "discarded", "all"].includes(
    params.status ?? "",
  )
    ? (params.status as string)
    : "open";
  const priorityFilter = ["high", "medium", "low", "all"].includes(params.priority ?? "")
    ? (params.priority as string)
    : "all";
  const assigneeFilter = ["all", "me", "unassigned"].includes(params.assignee ?? "")
    ? (params.assignee as string)
    : "all";

  const { data: actions } = await supabase
    .from("required_actions")
    .select(
      "id,incident_key,priority,status,reason,result,discard_reason,auto_closed,student_id,class_session_id,assignee_user_id,created_at,updated_at",
    )
    .eq("studio_id", studio.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const allActions = actions ?? [];
  const studentIds = [
    ...new Set(allActions.map((action) => action.student_id).filter(Boolean)),
  ] as string[];
  const sessionIds = [
    ...new Set(allActions.map((action) => action.class_session_id).filter(Boolean)),
  ] as string[];
  const assigneeIds = [
    ...new Set(allActions.map((action) => action.assignee_user_id).filter(Boolean)),
  ] as string[];

  const [{ data: students }, { data: sessions }, { data: assignees }] = await Promise.all([
    studentIds.length
      ? supabase
          .from("students")
          .select("id,full_name")
          .eq("studio_id", studio.id)
          .in("id", studentIds)
      : Promise.resolve({ data: [] }),
    sessionIds.length
      ? supabase
          .from("class_sessions")
          .select("id,starts_at,template_id")
          .eq("studio_id", studio.id)
          .in("id", sessionIds)
      : Promise.resolve({ data: [] }),
    assigneeIds.length
      ? supabase.from("profiles").select("id,full_name").in("id", assigneeIds)
      : Promise.resolve({ data: [] }),
  ]);

  const templateIds = [...new Set((sessions ?? []).map((session) => session.template_id))];
  const { data: templates } = templateIds.length
    ? await supabase.from("class_templates").select("id,name").in("id", templateIds)
    : { data: [] };

  const studentMap = new Map((students ?? []).map((student) => [student.id, student.full_name]));
  const assigneeMap = new Map(
    (assignees ?? []).map((assignee) => [assignee.id, assignee.full_name ?? "Responsable"]),
  );
  const templateMap = new Map((templates ?? []).map((template) => [template.id, template.name]));
  const sessionMap = new Map(
    (sessions ?? []).map((session) => [
      session.id,
      {
        name: templateMap.get(session.template_id) ?? "Clase",
        startsAt: session.starts_at,
      },
    ]),
  );

  const filteredActions = allActions
    .filter((action) => {
      if (statusFilter === "open" && !["pending", "in_progress"].includes(action.status))
        return false;
      if (!["open", "all"].includes(statusFilter) && action.status !== statusFilter) return false;
      if (priorityFilter !== "all" && action.priority !== priorityFilter) return false;
      if (assigneeFilter === "me" && action.assignee_user_id !== user.id) return false;
      if (assigneeFilter === "unassigned" && action.assignee_user_id) return false;
      return true;
    })
    .sort((a, b) => {
      const priorityDelta = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
      if (priorityDelta !== 0) return priorityDelta;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const openActions = allActions.filter((action) =>
    ["pending", "in_progress"].includes(action.status),
  );
  const highOpenActions = openActions.filter((action) => action.priority === "high");
  const inProgressActions = openActions.filter((action) => action.status === "in_progress");

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">ATENCIÓN · {studio.name}</p>
          <h1 className="dashboard-title">Atención</h1>
          <p>
            Incidencias que requieren intervención humana, ordenadas por prioridad y responsable.
          </p>
        </div>
      </header>

      <section className="stat-grid">
        <article className="stat-card">
          <span>Abiertas</span>
          <strong>{openActions.length}</strong>
          <small>Pendientes + en proceso</small>
        </article>
        <article className="stat-card">
          <span>Prioridad alta</span>
          <strong>{highOpenActions.length}</strong>
          <small>Requieren atención primero</small>
        </article>
        <article className="stat-card">
          <span>En proceso</span>
          <strong>{inProgressActions.length}</strong>
          <small>Ya tienen intervención</small>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">FILTROS</p>
            <h2>Acotar la bandeja</h2>
          </div>
          <Link className="ghost-button" href="/admin/acciones">
            Limpiar
          </Link>
        </div>
        <form method="get" className="compact-form">
          <label>
            <span>Estado</span>
            <select name="status" defaultValue={statusFilter}>
              <option value="open">Abiertas</option>
              <option value="pending">Pendientes</option>
              <option value="in_progress">En proceso</option>
              <option value="resolved">Resueltas</option>
              <option value="discarded">Descartadas</option>
              <option value="all">Todas</option>
            </select>
          </label>
          <label>
            <span>Prioridad</span>
            <select name="priority" defaultValue={priorityFilter}>
              <option value="all">Todas</option>
              <option value="high">Alta</option>
              <option value="medium">Media</option>
              <option value="low">Baja</option>
            </select>
          </label>
          <label>
            <span>Responsable</span>
            <select name="assignee" defaultValue={assigneeFilter}>
              <option value="all">Todos</option>
              <option value="me">Asignadas a mí</option>
              <option value="unassigned">Sin responsable</option>
            </select>
          </label>
          <button className="secondary-button" type="submit">
            Aplicar filtros
          </button>
        </form>
      </section>

      <section className="grid gap-4">
        {filteredActions.length === 0 ? (
          <div className="empty-state">No hay incidencias que coincidan con estos filtros.</div>
        ) : (
          filteredActions.map((action) => {
            const session = action.class_session_id
              ? sessionMap.get(action.class_session_id)
              : null;
            return (
              <article className="panel" key={action.id}>
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">
                      PRIORIDAD {priorityCopy[action.priority]?.toUpperCase() ?? action.priority}
                    </p>
                    <h2>{action.reason}</h2>
                  </div>
                  <span className="status-pill">{statusCopy[action.status] ?? action.status}</span>
                </div>

                <div className="grid gap-2 text-sm text-zinc-400 md:grid-cols-3">
                  <div>
                    <span className="block text-xs uppercase tracking-[0.14em] text-zinc-500">
                      Responsable
                    </span>
                    <strong className="text-zinc-200">
                      {action.assignee_user_id
                        ? (assigneeMap.get(action.assignee_user_id) ?? "Responsable")
                        : "Sin asignar"}
                    </strong>
                  </div>
                  <div>
                    <span className="block text-xs uppercase tracking-[0.14em] text-zinc-500">
                      Creada
                    </span>
                    <strong className="text-zinc-200">{formatDateTime(action.created_at)}</strong>
                  </div>
                  <div>
                    <span className="block text-xs uppercase tracking-[0.14em] text-zinc-500">
                      Contexto
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {action.student_id ? (
                        <Link
                          className="text-fuchsia-300 hover:text-fuchsia-200"
                          href={`/admin/alumnas/${action.student_id}`}
                        >
                          {studentMap.get(action.student_id) ?? "Alumna"}
                        </Link>
                      ) : null}
                      {action.class_session_id ? (
                        <Link
                          className="text-sky-300 hover:text-sky-200"
                          href={`/admin/agenda/${action.class_session_id}`}
                        >
                          {session?.name ?? "Clase"}
                        </Link>
                      ) : null}
                      {!action.student_id && !action.class_session_id ? "General" : null}
                    </div>
                  </div>
                </div>

                <div className="toolbar-actions mt-4">
                  <Link className="primary-button" href={`/admin/acciones/${action.id}`}>
                    Abrir acción
                  </Link>
                </div>
              </article>
            );
          })
        )}
      </section>
    </main>
  );
}
