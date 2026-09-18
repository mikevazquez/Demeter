import Link from "next/link";
import { notFound } from "next/navigation";

import PendingActionButton from "@/app/admin/components/PendingActionButton";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

import {
  assignRequiredAction,
  discardRequiredAction,
  resolveRequiredAction,
  takeRequiredAction,
} from "../actions";
import RequiredActionNoticeDialog from "./RequiredActionNoticeDialog";

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

const operationCopy: Record<string, string> = {
  created: "Acción creada",
  assigned: "Responsable asignado",
  taken: "Acción tomada",
  resolved: "Acción resuelta",
  discarded: "Acción descartada",
  auto_closed: "Cierre automático",
};

function formatDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

export default async function RequiredActionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ actionId: string }>;
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  const { actionId } = await params;
  const query = await searchParams;
  const { supabase, studio, user, can } = await getAdminContext(CAPABILITIES.REQUIRED_ACTIONS_READ);

  const { data: action } = await supabase
    .from("required_actions")
    .select(
      "id,incident_key,priority,status,reason,result,discard_reason,auto_closed,source_event_id,student_id,class_session_id,assignee_user_id,created_by_user_id,assigned_at,started_at,resolved_at,discarded_at,created_at,updated_at",
    )
    .eq("id", actionId)
    .eq("studio_id", studio.id)
    .maybeSingle();

  if (!action) notFound();

  const canManage = can(CAPABILITIES.REQUIRED_ACTIONS_MANAGE);
  const [{ data: audit }, { data: memberships }] = await Promise.all([
    supabase
      .from("required_action_audit")
      .select("id,operation,from_status,to_status,actor_user_id,assignee_user_id,note,created_at")
      .eq("studio_id", studio.id)
      .eq("required_action_id", action.id)
      .order("created_at", { ascending: true }),
    canManage
      ? supabase
          .from("studio_memberships")
          .select("user_id,role")
          .eq("studio_id", studio.id)
          .eq("active", true)
          .in("role", ["owner", "admin"])
      : Promise.resolve({ data: [] }),
  ]);

  const profileIds = [
    ...new Set(
      [
        action.assignee_user_id,
        action.created_by_user_id,
        ...(audit ?? []).flatMap((item) => [item.actor_user_id, item.assignee_user_id]),
        ...(memberships ?? []).map((membership) => membership.user_id),
      ].filter(Boolean),
    ),
  ] as string[];

  const [{ data: profiles }, studentResult, sessionResult] = await Promise.all([
    profileIds.length
      ? supabase.from("profiles").select("id,full_name").in("id", profileIds)
      : Promise.resolve({ data: [] }),
    action.student_id
      ? supabase
          .from("students")
          .select("id,full_name")
          .eq("studio_id", studio.id)
          .eq("id", action.student_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    action.class_session_id
      ? supabase
          .from("class_sessions")
          .select("id,starts_at,template_id")
          .eq("studio_id", studio.id)
          .eq("id", action.class_session_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const session = sessionResult.data;
  const { data: template } = session
    ? await supabase
        .from("class_templates")
        .select("id,name")
        .eq("id", session.template_id)
        .maybeSingle()
    : { data: null };

  const profileMap = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile.full_name ?? "Usuario"]),
  );
  const assignees = (memberships ?? []).map((membership) => ({
    id: membership.user_id,
    name: profileMap.get(membership.user_id) ?? membership.role,
  }));
  const timeZone = studio.timezone ?? "America/Mexico_City";
  const isOpen = ["pending", "in_progress"].includes(action.status);
  const returnPath = `/admin/acciones/${action.id}`;

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <Link className="back-link compact" href="/admin/acciones">
            ← Acciones requeridas
          </Link>
          <p className="eyebrow">ACCIÓN REQUERIDA · {studio.name}</p>
          <h1 className="dashboard-title">{action.reason}</h1>
          <p>
            Prioridad {priorityCopy[action.priority] ?? action.priority} ·{" "}
            {statusCopy[action.status] ?? action.status}
          </p>
        </div>
        <span className="status-pill">{statusCopy[action.status] ?? action.status}</span>
      </header>

      <RequiredActionNoticeDialog
        actionId={action.id}
        updated={query.updated}
        error={query.error}
      />

      <section className="panel-grid">
        <article className="panel">
          <p className="eyebrow">CONTEXTO</p>
          <h2>Qué requiere intervención</h2>
          <div className="student-list mt-4">
            <div className="student-row">
              <div>
                <strong>Motivo</strong>
                <span>{action.reason}</span>
              </div>
            </div>
            <div className="student-row">
              <div>
                <strong>Responsable</strong>
                <span>
                  {action.assignee_user_id
                    ? (profileMap.get(action.assignee_user_id) ?? "Responsable")
                    : "Sin asignar"}
                </span>
              </div>
            </div>
            <div className="student-row">
              <div>
                <strong>Creada</strong>
                <span>{formatDateTime(action.created_at, timeZone)}</span>
              </div>
            </div>
            {action.student_id ? (
              <div className="student-row">
                <div>
                  <strong>Alumna relacionada</strong>
                  <span>{studentResult.data?.full_name ?? "Alumna"}</span>
                </div>
                <Link className="ghost-button" href={`/admin/alumnas/${action.student_id}`}>
                  Abrir perfil
                </Link>
              </div>
            ) : null}
            {action.class_session_id ? (
              <div className="student-row">
                <div>
                  <strong>Clase relacionada</strong>
                  <span>
                    {template?.name ?? "Clase"}
                    {session ? ` · ${formatDateTime(session.starts_at, timeZone)}` : ""}
                  </span>
                </div>
                <Link className="ghost-button" href={`/admin/agenda/${action.class_session_id}`}>
                  Abrir clase
                </Link>
              </div>
            ) : null}
          </div>

          {!isOpen ? (
            <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="eyebrow">RESULTADO</p>
              <p className="mt-2 text-sm leading-6 text-zinc-300">
                {action.status === "discarded"
                  ? action.discard_reason || "Descartada sin detalle adicional."
                  : action.result || "Resuelta sin detalle adicional."}
              </p>
              {action.auto_closed ? (
                <small className="mt-2 block text-zinc-500">
                  Esta acción se cerró automáticamente porque la causa se resolvió por otra vía.
                </small>
              ) : null}
            </div>
          ) : null}
        </article>

        <article className="panel">
          <p className="eyebrow">INTERVENCIÓN</p>
          <h2>{isOpen ? "Resolver la acción" : "Acción cerrada"}</h2>

          {!canManage ? (
            <div className="empty-state mt-4">
              Tu rol puede consultar esta acción, pero no modificarla.
            </div>
          ) : !isOpen ? (
            <div className="empty-state mt-4">
              Esta acción ya no admite cambios de responsable, resolución o descarte.
            </div>
          ) : (
            <div className="grid gap-5 mt-4">
              <form action={assignRequiredAction} className="compact-form">
                <input type="hidden" name="action_id" value={action.id} />
                <input type="hidden" name="return_path" value={returnPath} />
                <label>
                  <span>Responsable</span>
                  <select
                    name="assignee_user_id"
                    required
                    defaultValue={action.assignee_user_id ?? ""}
                  >
                    <option value="" disabled>
                      Selecciona responsable
                    </option>
                    {assignees.map((assignee) => (
                      <option key={assignee.id} value={assignee.id}>
                        {assignee.name}
                      </option>
                    ))}
                  </select>
                </label>
                <PendingActionButton className="secondary-button" pendingLabel="Asignando…">
                  Asignar responsable
                </PendingActionButton>
              </form>

              {action.assignee_user_id !== user.id || action.status === "pending" ? (
                <form action={takeRequiredAction}>
                  <input type="hidden" name="action_id" value={action.id} />
                  <input type="hidden" name="return_path" value={returnPath} />
                  <PendingActionButton className="ghost-button" pendingLabel="Tomando acción…">
                    Tomar esta acción
                  </PendingActionButton>
                </form>
              ) : null}

              <form action={resolveRequiredAction} className="compact-form">
                <input type="hidden" name="action_id" value={action.id} />
                <input type="hidden" name="return_path" value={returnPath} />
                <label>
                  <span>Resultado de la intervención</span>
                  <textarea
                    name="result"
                    rows={4}
                    maxLength={1000}
                    placeholder="Ej. Pago registrado y acceso regularizado"
                  />
                </label>
                <PendingActionButton className="primary-button" pendingLabel="Resolviendo…">
                  Marcar como resuelta
                </PendingActionButton>
              </form>

              <form action={discardRequiredAction} className="compact-form">
                <input type="hidden" name="action_id" value={action.id} />
                <input type="hidden" name="return_path" value={returnPath} />
                <label>
                  <span>Motivo obligatorio de descarte</span>
                  <textarea
                    name="reason"
                    rows={3}
                    required
                    maxLength={1000}
                    placeholder="Explica por qué esta incidencia no requiere intervención"
                  />
                </label>
                <PendingActionButton className="ghost-button" pendingLabel="Descartando…">
                  Descartar acción
                </PendingActionButton>
              </form>
            </div>
          )}
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">TIMELINE</p>
            <h2>Trazabilidad de la acción</h2>
          </div>
          <span className="count-badge">{audit?.length ?? 0}</span>
        </div>

        {!audit?.length ? (
          <div className="empty-state">Todavía no hay movimientos registrados.</div>
        ) : (
          <div className="grid gap-3">
            {audit.map((item) => (
              <div key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <strong className="text-sm text-white">
                      {operationCopy[item.operation] ?? item.operation}
                    </strong>
                    <p className="mt-1 text-sm text-zinc-400">
                      {item.from_status
                        ? `${statusCopy[item.from_status] ?? item.from_status} → `
                        : ""}
                      {statusCopy[item.to_status] ?? item.to_status}
                    </p>
                  </div>
                  <span className="text-xs text-zinc-500">
                    {formatDateTime(item.created_at, timeZone)}
                  </span>
                </div>
                <div className="mt-3 text-xs text-zinc-500">
                  {item.actor_user_id
                    ? `Por ${profileMap.get(item.actor_user_id) ?? "Usuario"}`
                    : "Ejecutado por el sistema"}
                  {item.assignee_user_id
                    ? ` · Responsable: ${profileMap.get(item.assignee_user_id) ?? "Usuario"}`
                    : ""}
                </div>
                {item.note ? <p className="mt-2 text-sm text-zinc-300">{item.note}</p> : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
