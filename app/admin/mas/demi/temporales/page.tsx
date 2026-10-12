import Link from "next/link";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";
import {
  answerUntil,
  isTemporaryInformationAnswerable,
  type TemporaryInformation,
} from "@/lib/assistant/temporary-information";
import TemporaryInformationForm from "./TemporaryInformationForm";
import { archiveDemiTemporaryInformation } from "./actions";
import "./temporales.css";

export const dynamic = "force-dynamic";

function localToday(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return `${map.get("year")}-${map.get("month")}-${map.get("day")}`;
}

function dateLabel(value: string | null) {
  if (!value) return "Sin fecha límite";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function statusLabel(item: TemporaryInformation, today: string) {
  if (item.status === "draft") return "Borrador";
  if (item.status === "archived") return "Archivado";
  if (item.promotion_starts_on > today) return "Programado";
  if (isTemporaryInformationAnswerable(item, today)) return "Vigente para Demi";
  return "Vencido";
}

export default async function DemiTemporaryInformationPage({
  searchParams,
}: {
  searchParams: Promise<{ editar?: string; guardado?: string; error?: string }>;
}) {
  const [{ supabase, studio }, params] = await Promise.all([
    getAdminContext(CAPABILITIES.SETTINGS_WRITE),
    searchParams,
  ]);
  const { data, error } = await supabase
    .from("demi_temporary_information")
    .select(
      "id,title,kind,discipline,details,promotion_starts_on,event_starts_on,event_ends_on,registration_deadline,status,created_at",
    )
    .eq("studio_id", studio.id)
    .order("created_at", { ascending: false })
    .limit(100);
  const items = (data ?? []) as TemporaryInformation[];
  const editing = items.find((item) => item.id === params.editar) ?? null;
  const today = localToday(studio.timezone);
  const activeCount = items.filter((item) => isTemporaryInformationAnswerable(item, today)).length;

  return (
    <main className="demi-temporary-page">
      <header className="demi-temporary-header">
        <div>
          <Link href="/admin/mas/demi" className="demi-temporary-back">
            ← Demi
          </Link>
          <p className="demi-temporary-eyebrow">Demi · información temporal</p>
          <h1>Talleres, eventos y promociones</h1>
          <p>
            Carga estos datos una vez. Demi los consulta al responder y deja de compartirlos cuando
            termina el periodo de inscripción.
          </p>
        </div>
        <span className="demi-temporary-count">{activeCount} vigentes para Demi</span>
      </header>

      {params.guardado && (
        <p className="demi-temporary-success" role="status">
          Información guardada.
        </p>
      )}
      {params.error && (
        <p className="demi-temporary-error" role="alert">
          No se pudo guardar el cambio.
        </p>
      )}
      {error && (
        <p className="demi-temporary-error" role="alert">
          No se pudo cargar la información del estudio.
        </p>
      )}

      <section className="demi-temporary-panel">
        <h2>{editing ? "Editar información" : "Agregar información"}</h2>
        <p className="demi-temporary-help">
          La promoción puede iniciar antes del evento. Si no defines un límite de inscripción, Demi
          seguirá respondiendo hasta el último día del taller.
        </p>
        <TemporaryInformationForm key={editing?.id ?? "new"} item={editing} />
        {editing && (
          <Link className="demi-temporary-cancel" href="/admin/mas/demi/temporales">
            Cancelar edición
          </Link>
        )}
      </section>

      <section className="demi-temporary-list">
        <div className="demi-temporary-list-heading">
          <div>
            <h2>Información guardada</h2>
            <p>Los registros vencidos y archivados se conservan en el historial.</p>
          </div>
        </div>
        {!items.length ? (
          <div className="demi-temporary-empty">
            Todavía no hay talleres, eventos ni promociones.
          </div>
        ) : (
          <div className="demi-temporary-cards">
            {items.map((item) => {
              const effectiveUntil = answerUntil(item);
              const canArchive = item.status !== "archived";
              return (
                <article className="demi-temporary-card" key={item.id}>
                  <div className="demi-temporary-card-top">
                    <div>
                      <span
                        className={`demi-temporary-status status-${statusLabel(item, today).toLowerCase().replaceAll(" ", "-")}`}
                      >
                        {statusLabel(item, today)}
                      </span>
                      <h3>{item.title}</h3>
                      <p>
                        {item.discipline ||
                          (item.kind === "workshop"
                            ? "Taller"
                            : item.kind === "event"
                              ? "Evento"
                              : "Promoción")}
                      </p>
                    </div>
                    <Link href={`/admin/mas/demi/temporales?editar=${item.id}`}>Editar</Link>
                  </div>
                  <dl>
                    <div>
                      <dt>Demi puede anunciar desde</dt>
                      <dd>{dateLabel(item.promotion_starts_on)}</dd>
                    </div>
                    <div>
                      <dt>Evento</dt>
                      <dd>
                        {dateLabel(item.event_starts_on)} – {dateLabel(item.event_ends_on)}
                      </dd>
                    </div>
                    <div>
                      <dt>Responde hasta</dt>
                      <dd>{dateLabel(effectiveUntil)}</dd>
                    </div>
                  </dl>
                  <p className="demi-temporary-details">{item.details}</p>
                  {canArchive && (
                    <form action={archiveDemiTemporaryInformation}>
                      <input type="hidden" name="id" value={item.id} />
                      <button type="submit" className="demi-temporary-archive">
                        Archivar
                      </button>
                    </form>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
