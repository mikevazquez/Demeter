import Link from "next/link";

import {
  formatDateTime,
  getStudentPortalContext,
  selectPrimaryStudentPackage,
} from "@/lib/student/portal";

const movementCopy: Record<
  string,
  { label: string; symbol: string; accent: string; icon: string }
> = {
  grant: {
    label: "Créditos otorgados",
    symbol: "+",
    accent: "text-emerald-300",
    icon: "bg-emerald-500/12 text-emerald-300",
  },
  reserve: {
    label: "Crédito reservado",
    symbol: "−",
    accent: "text-amber-300",
    icon: "bg-amber-500/12 text-amber-300",
  },
  release: {
    label: "Crédito liberado",
    symbol: "+",
    accent: "text-emerald-300",
    icon: "bg-emerald-500/12 text-emerald-300",
  },
  consume: {
    label: "Clase utilizada",
    symbol: "−",
    accent: "text-fuchsia-300",
    icon: "bg-fuchsia-500/12 text-fuchsia-300",
  },
  adjustment: {
    label: "Ajuste de créditos",
    symbol: "±",
    accent: "text-zinc-300",
    icon: "bg-white/[0.07] text-zinc-300",
  },
};

function movementVisual(type: string, quantity: number) {
  const base = movementCopy[type] ?? {
    label: "Movimiento de créditos",
    symbol: "·",
    accent: "text-zinc-300",
    icon: "bg-white/[0.07] text-zinc-300",
  };

  if (type !== "adjustment") return base;

  return {
    ...base,
    accent: quantity > 0 ? "text-emerald-300" : quantity < 0 ? "text-rose-300" : "text-zinc-300",
  };
}

function quantityCopy(quantity: number) {
  return quantity > 0 ? `+${quantity}` : String(quantity);
}

export default async function StudentMovementsPage() {
  const { snapshot, studio } = await getStudentPortalContext();
  const activePackage = selectPrimaryStudentPackage(snapshot.acquisitions);

  return (
    <main className="space-y-5 pb-4">
      <header>
        <p className="sendero-brand">Movimientos</p>
        <h1 className="mt-2 text-4xl tracking-tight text-[var(--sendero-ink)] sm:text-5xl">
          Historial de tus créditos
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--sendero-muted)]">
          Consulta cómo entran, se reservan, se liberan y se utilizan los créditos de tus paquetes.
        </p>
      </header>

      {activePackage ? (
        <section
          data-movements-block="summary"
          className="sendero-surface overflow-hidden p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium text-zinc-500">Paquete activo</p>
              <h2 className="mt-1 text-2xl text-[var(--sendero-ink)]">{activePackage.name}</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Este resumen refleja el estado actual; el historial completo aparece debajo.
              </p>
            </div>
            <Link
              href="/student/paquete"
              className="sendero-button sendero-button-ghost !min-h-10 !px-3.5 !text-xs"
            >
              Ver mi paquete
            </Link>
          </div>

          <div className="mt-5 grid grid-cols-3 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
            <div className="p-4 text-center">
              <strong className="block text-2xl text-white">
                {activePackage.unlimited ? "∞" : activePackage.available_credits}
              </strong>
              <span className="mt-1 block text-[11px] text-zinc-500">Disponibles</span>
            </div>
            <div className="border-x border-white/10 p-4 text-center">
              <strong className="block text-2xl text-white">
                {activePackage.reserved_credits}
              </strong>
              <span className="mt-1 block text-[11px] text-zinc-500">Reservadas</span>
            </div>
            <div className="p-4 text-center">
              <strong className="block text-2xl text-white">{activePackage.used_credits}</strong>
              <span className="mt-1 block text-[11px] text-zinc-500">Utilizadas</span>
            </div>
          </div>
        </section>
      ) : null}

      <section data-movements-block="ledger" className="sendero-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl text-[var(--sendero-ink)]">Actividad de créditos</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Los movimientos más recientes aparecen primero.
            </p>
          </div>
          {snapshot.movements.length ? (
            <span className="rounded-full bg-white/[0.07] px-2.5 py-1 text-xs text-zinc-400">
              {snapshot.movements.length} movimientos
            </span>
          ) : null}
        </div>

        {snapshot.movements.length ? (
          <div className="mt-4 divide-y divide-white/10">
            {snapshot.movements.map((movement) => {
              const visual = movementVisual(movement.movement_type, movement.quantity);
              const title = movement.activity ?? movement.product ?? visual.label;

              return (
                <article
                  key={movement.id}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 py-4 first:pt-0 last:pb-0 sm:gap-4"
                >
                  <div
                    aria-hidden="true"
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${visual.icon}`}
                  >
                    {visual.symbol}
                  </div>

                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                      <span>{visual.label}</span>
                      {movement.activity && movement.product ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{movement.product}</span>
                        </>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-zinc-600">
                      {formatDateTime(movement.created_at, studio.timezone)}
                    </p>
                    {movement.note ? (
                      <p className="mt-2 rounded-xl bg-black/15 px-3 py-2 text-xs leading-5 text-zinc-500">
                        {movement.note}
                      </p>
                    ) : null}
                  </div>

                  <div className="text-right">
                    <strong className={`block text-lg ${visual.accent}`}>
                      {quantityCopy(movement.quantity)}
                    </strong>
                    <span className="text-[11px] text-zinc-600">créditos</span>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div
            data-movements-block="empty"
            className="sendero-surface-soft mt-4 border-dashed p-7 text-center sm:p-8"
          >
            <div
              aria-hidden="true"
              className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--sendero-lilac-soft)] text-lg text-[var(--sendero-lilac)]"
            >
              ↕
            </div>
            <h2 className="mt-4 font-semibold text-white">Todavía no hay movimientos</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-400">
              Cuando recibas, reserves, liberes o utilices créditos, el movimiento aparecerá aquí.
            </p>
            <Link
              href={activePackage ? "/student/reservar" : "/student/paquete"}
              className="sendero-button sendero-button-ghost mt-5 !min-h-10"
            >
              {activePackage ? "Reservar una clase" : "Ver paquetes"}
            </Link>
          </div>
        )}
      </section>

      <p className="px-1 text-xs leading-5 text-zinc-600">
        Este historial proviene del ledger real de Studio Flow y es de sólo lectura para la alumna.
      </p>
    </main>
  );
}
