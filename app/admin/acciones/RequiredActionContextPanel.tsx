import Link from "next/link";

export type RequiredActionContextItem = {
  id: string;
  priority: string;
  status: string;
  reason: string;
  created_at: string;
};

const priorityCopy: Record<string, string> = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

const statusCopy: Record<string, string> = {
  pending: "Pendiente",
  in_progress: "En proceso",
  resolved: "Resuelta",
  discarded: "Descartada",
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Mexico_City",
  }).format(new Date(value));
}

export default function RequiredActionContextPanel({
  eyebrow,
  title,
  actions,
  totalCount,
  emptyCopy = "No hay acciones requeridas abiertas en este contexto.",
  viewAllHref = "/admin/acciones",
}: {
  eyebrow: string;
  title: string;
  actions: RequiredActionContextItem[];
  totalCount?: number;
  emptyCopy?: string;
  viewAllHref?: string;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <div className="toolbar-actions">
          <span className="count-badge">{totalCount ?? actions.length}</span>
          <Link className="secondary-button" href={viewAllHref}>
            Ver bandeja
          </Link>
        </div>
      </div>

      {actions.length === 0 ? (
        <div className="empty-state">{emptyCopy}</div>
      ) : (
        <div className="student-list">
          {actions.map((action) => (
            <div className="student-row" key={action.id}>
              <div>
                <strong>{action.reason}</strong>
                <span>
                  Prioridad {priorityCopy[action.priority] ?? action.priority} ·{" "}
                  {statusCopy[action.status] ?? action.status} · {formatDateTime(action.created_at)}
                </span>
              </div>
              <Link className="ghost-button" href={`/admin/acciones/${action.id}`}>
                Abrir
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
