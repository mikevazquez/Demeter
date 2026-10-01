import PendingActionButton from "@/app/admin/components/PendingActionButton";

import { setAcquisitionAvailableCredits, setAcquisitionStartDate } from "./actions";

type ClassEvent = {
  id: string;
  status: string;
  className: string;
  startsAt: string;
  creditsHeld: number;
};

type Props = {
  studentId: string;
  kind: "current" | "scheduled" | "historical";
  acquisition: {
    id: string;
    name: string;
    statusLabel: string;
    startsOn: string | null;
    expiresOn: string | null;
    unlimited: boolean;
    availableCredits: number | null;
    accessBlocked: boolean;
    activationMode: string | null;
  };
  classes: ClassEvent[];
  editable: boolean;
  timeZone: string;
  locale: string;
};

function formatDate(value: string | null, locale: string) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value + "T12:00:00Z"));
}

function formatClassDate(value: string, timeZone: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function classStatusLabel(status: string) {
  const labels: Record<string, string> = {
    reserved: "Reservada",
    attended: "Asistió",
    cancelled_on_time: "Canceló a tiempo",
    cancelled_late: "Cancelación tardía",
    no_show: "No show",
    cancelled_by_studio: "Cancelada por el estudio",
  };
  return labels[status] ?? status;
}

function classStatusDetail(status: string) {
  if (status === "cancelled_on_time") return "Crédito devuelto";
  if (status === "cancelled_late") return "Crédito no devuelto";
  if (status === "no_show") return "Crédito consumido";
  return null;
}

export default function StudentPackageCard({
  studentId,
  kind,
  acquisition,
  classes,
  editable,
  timeZone,
  locale,
}: Props) {
  const attendedCount = classes.filter((event) => event.status === "attended").length;
  const reservedCount = classes.filter((event) => event.status === "reserved").length;
  const noShowCount = classes.filter((event) => event.status === "no_show").length;
  const lateCancellationCount = classes.filter((event) => event.status === "cancelled_late").length;
  const onTimeCancellationCount = classes.filter(
    (event) => event.status === "cancelled_on_time",
  ).length;
  const studioCancellationCount = classes.filter(
    (event) => event.status === "cancelled_by_studio",
  ).length;
  const consumedCount = attendedCount + noShowCount + lateCancellationCount;
  const disciplineCounts = Array.from(
    classes
      .filter((event) => event.status === "attended")
      .reduce(
        (map, event) => map.set(event.className, (map.get(event.className) ?? 0) + 1),
        new Map<string, number>(),
      ),
  ).sort((left, right) => right[1] - left[1]);

  const eyebrow =
    kind === "current"
      ? "PAQUETE ACTUAL"
      : kind === "scheduled"
        ? "PRÓXIMO PAQUETE"
        : "PAQUETE HISTÓRICO";

  return (
    <details className={"profile360-package-card is-" + kind} open={kind === "current"}>
      <summary>
        <div className="profile360-package-card-summary">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h3>{acquisition.name}</h3>
            <span>
              {acquisition.startsOn && acquisition.expiresOn
                ? formatDate(acquisition.startsOn, locale) +
                  " → " +
                  formatDate(acquisition.expiresOn, locale)
                : acquisition.startsOn
                  ? "Inicia " + formatDate(acquisition.startsOn, locale)
                  : kind === "scheduled"
                    ? "Inicio programado"
                    : "Sin vigencia registrada"}
            </span>
          </div>
          <div className="profile360-package-card-side">
            <span className="status-pill">
              {acquisition.accessBlocked ? "Bloqueado" : acquisition.statusLabel}
            </span>
            <strong>
              {acquisition.unlimited
                ? "Ilimitado"
                : String(acquisition.availableCredits ?? 0) + " créditos"}
            </strong>
          </div>
        </div>
        <span className="profile360-package-chevron" aria-hidden="true">
          ›
        </span>
      </summary>

      <div className="profile360-package-card-body">
        <div className="profile360-package-facts">
          <div>
            <span>Inicio</span>
            <strong>{formatDate(acquisition.startsOn, locale)}</strong>
          </div>
          <div>
            <span>Vencimiento</span>
            <strong>{formatDate(acquisition.expiresOn, locale)}</strong>
          </div>
          <div>
            <span>Créditos</span>
            <strong>
              {acquisition.unlimited ? "Ilimitado" : (acquisition.availableCredits ?? 0)}
            </strong>
          </div>
          <div>
            <span>Clases registradas</span>
            <strong>{classes.length}</strong>
          </div>
        </div>

        <section className="profile360-package-usage">
          <div className="profile360-package-subheading">
            <strong>Consumo del paquete</strong>
            <span>{consumedCount} consumidas</span>
          </div>
          <div className="profile360-package-usage-stats">
            <div>
              <span>Asistencias</span>
              <strong>{attendedCount}</strong>
            </div>
            <div>
              <span>No shows</span>
              <strong>{noShowCount}</strong>
            </div>
            <div>
              <span>Cancelaciones tardías</span>
              <strong>{lateCancellationCount}</strong>
            </div>
            <div>
              <span>Cancelaciones a tiempo</span>
              <strong>{onTimeCancellationCount}</strong>
            </div>
          </div>
          {disciplineCounts.length ? (
            <div className="profile360-package-disciplines">
              <span>Clases asistidas por disciplina</span>
              <div>
                {disciplineCounts.map(([name, count]) => (
                  <b key={name}>
                    {name} · {count}
                  </b>
                ))}
              </div>
            </div>
          ) : null}
          {reservedCount > 0 || studioCancellationCount > 0 ? (
            <p className="profile360-package-secondary">
              {reservedCount > 0
                ? reservedCount + " reservada" + (reservedCount === 1 ? "" : "s")
                : ""}
              {reservedCount > 0 && studioCancellationCount > 0 ? " · " : ""}
              {studioCancellationCount > 0
                ? studioCancellationCount +
                  " cancelada" +
                  (studioCancellationCount === 1 ? "" : "s") +
                  " por el estudio"
                : ""}
            </p>
          ) : null}
        </section>

        {editable ? (
          <details className="profile360-package-edit">
            <summary>Editar paquete actual</summary>
            <div className="profile360-package-edit-body">
              <form action={setAcquisitionStartDate} className="grid gap-2">
                <input type="hidden" name="student_id" value={studentId} />
                <input type="hidden" name="acquisition_id" value={acquisition.id} />
                <label className="grid gap-1 text-sm text-zinc-300">
                  Fecha de inicio
                  <input
                    type="date"
                    name="starts_on"
                    required
                    defaultValue={acquisition.startsOn ?? ""}
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
                  />
                </label>
                <PendingActionButton className="ghost-button" pendingLabel="Actualizando…">
                  Actualizar fecha
                </PendingActionButton>
              </form>

              {!acquisition.unlimited ? (
                <form action={setAcquisitionAvailableCredits} className="grid gap-2">
                  <input type="hidden" name="student_id" value={studentId} />
                  <input type="hidden" name="acquisition_id" value={acquisition.id} />
                  <label className="grid gap-1 text-sm text-zinc-300">
                    Créditos disponibles
                    <input
                      type="number"
                      name="available_credits"
                      min="0"
                      max="100000"
                      step="1"
                      required
                      defaultValue={acquisition.availableCredits ?? 0}
                      className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
                    />
                  </label>
                  <label className="grid gap-1 text-sm text-zinc-300">
                    Motivo del ajuste
                    <input
                      type="text"
                      name="reason"
                      required
                      maxLength={500}
                      placeholder="Ej. Corrección por captura"
                      className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-white"
                    />
                  </label>
                  <PendingActionButton className="ghost-button" pendingLabel="Ajustando…">
                    Ajustar créditos
                  </PendingActionButton>
                </form>
              ) : null}
            </div>
          </details>
        ) : null}

        <div className="profile360-package-classes">
          <div className="profile360-package-subheading">
            <strong>{kind === "current" ? "Clases del paquete" : "Historial de clases"}</strong>
            <span>{classes.length}</span>
          </div>
          {classes.length ? (
            <div className="profile360-package-class-list">
              {classes.map((event) => {
                const detail = classStatusDetail(event.status);
                return (
                  <div key={event.id} className="profile360-package-class-row">
                    <div>
                      <strong>{event.className}</strong>
                      <span>{formatClassDate(event.startsAt, timeZone, locale)}</span>
                    </div>
                    <div>
                      <strong>{classStatusLabel(event.status)}</strong>
                      {detail ? <span>{detail}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">No hay clases vinculadas a este paquete.</div>
          )}
        </div>
      </div>
    </details>
  );
}
