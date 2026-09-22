import Link from "next/link";
import { notFound } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getCoachContext } from "@/lib/auth/coach-context";
import {
  formatSessionDate,
  formatTime,
  type CoachResourceMap,
  type CoachSessionDetail,
} from "@/lib/coach/portal";

function statusLabel(status: CoachSessionDetail["status"]) {
  if (status === "completed") return "Finalizada";
  if (status === "cancelled") return "Cancelada";
  return "Programada";
}

function percent(value: number | string) {
  return `${Number(value) * 100}%`;
}

export default async function CoachClassDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const { supabase, studio } = await getCoachContext(CAPABILITIES.SCHEDULE_READ);
  const [
    { data: detailData, error: detailError },
    { data: resourceMapData, error: resourceMapError },
  ] = await Promise.all([
    supabase.rpc("coach_session_detail", {
      target_studio_id: studio.id,
      target_session_id: sessionId,
    }),
    supabase.rpc("coach_session_resource_map", {
      target_studio_id: studio.id,
      target_session_id: sessionId,
    }),
  ]);

  if (detailError || resourceMapError || !detailData || !resourceMapData) notFound();

  const detail = detailData as CoachSessionDetail;
  const resourceMap = resourceMapData as CoachResourceMap;
  const occupied = Number(detail.reserved_count);
  const full = occupied >= detail.capacity;
  const resourceById = new Map(
    resourceMap.resources.map((resource) => [resource.resource_id, resource]),
  );

  return (
    <main className="space-y-6">
      <Link
        href="/coach"
        className="inline-flex text-sm font-semibold text-zinc-400 hover:text-white"
      >
        ← Mis clases
      </Link>

      <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
        <div className="border-b border-white/10 bg-gradient-to-br from-fuchsia-500/15 via-transparent to-transparent p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
                Detalle de clase
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
                {detail.activity}
              </h1>
              <p className="mt-3 capitalize text-zinc-300">
                {formatSessionDate(detail.starts_at, studio.timezone)}
              </p>
            </div>
            <span className="self-start rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-zinc-300">
              {statusLabel(detail.status)}
            </span>
          </div>
        </div>

        <div className="grid gap-4 p-6 sm:grid-cols-2 sm:p-8">
          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs text-zinc-500">Horario</p>
            <p className="mt-1 font-semibold text-white">
              {formatTime(detail.starts_at, studio.timezone)} –{" "}
              {formatTime(detail.ends_at, studio.timezone)}
            </p>
          </div>
          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs text-zinc-500">Espacio</p>
            <p className="mt-1 font-semibold text-white">
              {detail.space ?? "Espacio por confirmar"}
            </p>
          </div>
          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs text-zinc-500">Ocupación</p>
            <p className="mt-1 font-semibold text-white">
              {occupied} / {detail.capacity}
            </p>
          </div>
          <div className="rounded-2xl bg-black/20 p-4">
            <p className="text-xs text-zinc-500">Disponibilidad</p>
            <p className="mt-1 font-semibold text-white">
              {full ? "Clase llena" : `${detail.capacity - occupied} lugares disponibles`}
            </p>
          </div>
        </div>

        {detail.notes ? (
          <div className="mx-6 mb-6 rounded-2xl border border-white/10 p-4 text-sm leading-6 text-zinc-400 sm:mx-8 sm:mb-8">
            {detail.notes}
          </div>
        ) : null}

        <div className="border-t border-white/10 p-6 sm:p-8">
          <Link
            href={`/coach/clases/${sessionId}/roster`}
            className="block rounded-xl bg-fuchsia-600 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-fuchsia-500"
          >
            Ver roster
          </Link>
        </div>
      </section>

      {resourceMap.requires_resource ? (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
                Mapa de recursos
              </p>
              <h2 className="mt-2 text-xl font-semibold text-white">
                Distribución de {detail.space ?? "la clase"}
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Vista de solo lectura · misma geometría usada por administración y alumnas
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
              <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-emerald-200">
                Disponible
              </span>
              <span className="rounded-full border border-rose-400/25 bg-rose-400/10 px-2.5 py-1 text-rose-200">
                Completo
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-zinc-500">
                No disponible
              </span>
            </div>
          </div>

          {!resourceMap.map || !resourceMap.elements.length ? (
            <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4">
              <p className="text-sm font-semibold text-amber-100">
                El mapa todavía no está disponible
              </p>
              <p className="mt-1 text-xs leading-5 text-zinc-400">
                El espacio de esta sesión necesita una distribución publicada.
              </p>
            </div>
          ) : (
            <div
              className="relative mt-5 overflow-hidden rounded-3xl border border-white/10 bg-black/30"
              style={{
                aspectRatio: `${resourceMap.map.canvas_width} / ${resourceMap.map.canvas_height}`,
              }}
            >
              {resourceMap.elements.map((element) => {
                const resource = element.resource_id ? resourceById.get(element.resource_id) : null;
                const enabled = resource ? resource.enabled : true;
                const fullResource = resource ? resource.enabled && resource.available <= 0 : false;
                const label = resource
                  ? resource.short_label || resource.name
                  : element.label || element.element_kind;

                const stateClass = resource
                  ? !enabled
                    ? "border-white/10 bg-zinc-950 text-zinc-600"
                    : fullResource
                      ? "border-rose-400/40 bg-rose-500/15 text-rose-100"
                      : "border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
                  : "border-fuchsia-400/20 bg-fuchsia-500/[0.07] text-fuchsia-200";

                return (
                  <div
                    key={element.id}
                    className={`absolute flex items-center justify-center rounded-xl border text-center text-[10px] font-semibold sm:text-xs ${stateClass}`}
                    style={{
                      left: percent(element.x),
                      top: percent(element.y),
                      width: percent(element.width),
                      height: percent(element.height),
                      transform: `rotate(${Number(element.rotation_degrees)}deg)`,
                    }}
                    title={
                      resource ? `${resource.name}: ${resource.used}/${resource.capacity}` : label
                    }
                  >
                    <span className="truncate px-1">{label}</span>
                  </div>
                );
              })}
            </div>
          )}

          {resourceMap.resources.length ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {resourceMap.resources.map((resource) => (
                <div
                  key={resource.resource_id}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{resource.name}</p>
                    <p className="text-xs text-zinc-500">{resource.type_name}</p>
                  </div>
                  <span
                    className={`ml-3 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                      !resource.enabled
                        ? "border-white/10 text-zinc-500"
                        : resource.available <= 0
                          ? "border-rose-400/20 text-rose-200"
                          : "border-emerald-400/20 text-emerald-200"
                    }`}
                  >
                    {resource.used}/{resource.capacity}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
