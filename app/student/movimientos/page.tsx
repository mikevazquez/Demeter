import { formatDateTime, getStudentPortalContext } from "@/lib/student/portal";

const movementCopy: Record<string, { label: string; sign: string }> = {
  grant: { label: "Créditos otorgados", sign: "+" },
  reserve: { label: "Reserva", sign: "" },
  release: { label: "Crédito liberado", sign: "+" },
  consume: { label: "Clase utilizada", sign: "" },
  adjustment: { label: "Ajuste", sign: "" },
};

export default async function StudentMovementsPage() {
  const { snapshot, studio } = await getStudentPortalContext();

  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm text-fuchsia-300">Movimientos</p>
        <h1 className="mt-1 text-3xl font-semibold text-white sm:text-4xl">
          Historial de tus créditos
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Reservas, liberaciones, consumos y ajustes se muestran desde el ledger real de tu paquete.
        </p>
      </header>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        {snapshot.movements.length ? (
          <div className="divide-y divide-white/10">
            {snapshot.movements.map((movement) => {
              const copy = movementCopy[movement.movement_type] ?? {
                label: movement.movement_type,
                sign: "",
              };
              const positive = movement.quantity > 0;
              return (
                <article
                  key={movement.id}
                  className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-white">{movement.activity ?? copy.label}</p>
                    <p className="mt-1 text-sm text-zinc-400">
                      {movement.activity ? copy.label : movement.product}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {formatDateTime(movement.created_at, studio.timezone)}
                    </p>
                    {movement.note ? (
                      <p className="mt-2 text-xs leading-5 text-zinc-500">{movement.note}</p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <strong
                      className={`text-lg ${positive ? "text-emerald-300" : movement.quantity < 0 ? "text-rose-300" : "text-zinc-300"}`}
                    >
                      {movement.quantity > 0 ? "+" : ""}
                      {movement.quantity}
                    </strong>
                    <p className="text-xs text-zinc-500">créditos</p>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center">
            <h2 className="font-semibold text-white">Todavía no hay movimientos</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Cuando recibas, reserves o utilices créditos aparecerán aquí.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
