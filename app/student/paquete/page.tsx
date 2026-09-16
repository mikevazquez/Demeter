import Link from "next/link";

import { formatDate, getStudentPortalContext, type StudentAcquisition } from "@/lib/student/portal";

const statusCopy: Record<string, string> = {
  active: "Activo",
  expired: "Vencido",
  cancelled: "Inactivo",
};

const termCopy: Record<string, string> = {
  monthly: "Mensual",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  annual: "Anual",
  custom: "Otra vigencia",
};

const packageGroups: Array<{ key: string; title: string; description: string }> = [
  { key: "monthly", title: "Mensuales", description: "Paquetes con ciclo mensual" },
  { key: "quarterly", title: "Trimestrales", description: "Paquetes con ciclo de tres meses" },
  { key: "semiannual", title: "Semestrales", description: "Paquetes con ciclo de seis meses" },
  { key: "annual", title: "Anuales", description: "Paquetes con ciclo anual" },
  { key: "other", title: "Otros", description: "Otras vigencias y productos" },
];

function groupKey(item: StudentAcquisition) {
  return item.package_term && item.package_term !== "custom" ? item.package_term : "other";
}

export default async function StudentPackagePage() {
  const { snapshot, studio } = await getStudentPortalContext();
  const activePackage = snapshot.acquisitions.find((item) => item.active_now) ?? null;
  const others = snapshot.acquisitions.filter((item) => item.id !== activePackage?.id);
  const grouped = new Map<string, StudentAcquisition[]>();

  for (const item of others) {
    const key = groupKey(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }

  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm text-fuchsia-300">Mi paquete</p>
        <h1 className="mt-1 text-3xl font-semibold text-white sm:text-4xl">
          Tus clases y vigencia
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Consulta lo disponible, lo reservado y lo que ya utilizaste, organizado por tipo de
          vigencia.
        </p>
      </header>

      {activePackage ? (
        <section className="rounded-3xl border border-fuchsia-500/25 bg-gradient-to-br from-fuchsia-500/15 via-white/[0.04] to-transparent p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
                  Activo
                </span>
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-zinc-300">
                  {activePackage.package_term
                    ? (termCopy[activePackage.package_term] ?? "Otra vigencia")
                    : "Otra vigencia"}
                </span>
              </div>
              <h2 className="mt-3 text-2xl font-semibold text-white">{activePackage.name}</h2>
              <p className="mt-2 text-sm text-zinc-400">
                {formatDate(activePackage.starts_on, studio.timezone)} →{" "}
                {formatDate(activePackage.expires_on, studio.timezone)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-5 py-4 text-right">
              <strong className="block text-4xl text-white">
                {activePackage.unlimited ? "∞" : activePackage.available_credits}
              </strong>
              <span className="text-xs text-zinc-400">
                {activePackage.unlimited ? "acceso ilimitado" : "disponibles"}
              </span>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-black/20 p-4">
              <p className="text-xs text-zinc-500">Disponibles</p>
              <strong className="mt-1 block text-xl text-white">
                {activePackage.unlimited ? "∞" : activePackage.available_credits}
              </strong>
            </div>
            <div className="rounded-2xl bg-black/20 p-4">
              <p className="text-xs text-zinc-500">Reservadas</p>
              <strong className="mt-1 block text-xl text-white">
                {activePackage.reserved_credits}
              </strong>
            </div>
            <div className="rounded-2xl bg-black/20 p-4">
              <p className="text-xs text-zinc-500">Utilizadas</p>
              <strong className="mt-1 block text-xl text-white">
                {activePackage.used_credits}
              </strong>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/student/reservar"
              className="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-500"
            >
              Reservar clase
            </Link>
            <Link
              href="/student/movimientos"
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/[0.05]"
            >
              Ver movimientos
            </Link>
          </div>
        </section>
      ) : (
        <section className="rounded-3xl border border-dashed border-white/10 p-8 text-center">
          <h2 className="font-semibold text-white">No tienes un paquete activo</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Tus paquetes anteriores seguirán visibles como historial. Para adquirir uno nuevo,
            contacta al estudio.
          </p>
        </section>
      )}

      {snapshot.enrollment ? (
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                Inscripción
              </p>
              <h2 className="mt-1 text-lg font-semibold text-white">
                {snapshot.enrollment.active_now ? "Vigente" : "Sin vigencia actual"}
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                {snapshot.enrollment.expires_on
                  ? `Vence ${formatDate(snapshot.enrollment.expires_on, studio.timezone)}`
                  : snapshot.enrollment.active_now
                    ? "Vitalicia · sin vencimiento"
                    : "Consulta el estado con el estudio"}
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${snapshot.enrollment.active_now ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-500/15 text-zinc-400"}`}
            >
              {snapshot.enrollment.status}
            </span>
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            La gestión completa de inscripción y documentos pertenece a la fase de
            políticas/documentos; aquí sólo se muestra tu estado vigente.
          </p>
        </section>
      ) : null}

      {others.length ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-white">Paquetes e historial</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Se muestran por periodo para que puedas distinguir fácilmente cada vigencia.
            </p>
          </div>

          {packageGroups.map((group) => {
            const items = grouped.get(group.key) ?? [];
            if (!items.length) return null;

            return (
              <section
                key={group.key}
                className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6"
              >
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fuchsia-300">
                      {group.title}
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">{group.description}</p>
                  </div>
                  <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-zinc-300">
                    {items.length}
                  </span>
                </div>

                <div className="mt-4 divide-y divide-white/10">
                  {items.map((item) => (
                    <article
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
                    >
                      <div>
                        <p className="font-medium text-white">{item.name}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {formatDate(item.starts_on, studio.timezone)} →{" "}
                          {formatDate(item.expires_on, studio.timezone)}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {item.unlimited
                            ? "Acceso ilimitado"
                            : `${item.available_credits ?? 0} disponibles · ${item.reserved_credits} reservadas · ${item.used_credits} utilizadas`}
                        </p>
                      </div>
                      <span className="rounded-full bg-zinc-500/15 px-2.5 py-1 text-xs font-medium text-zinc-400">
                        {statusCopy[item.status] ?? item.status}
                      </span>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </section>
      ) : null}
    </main>
  );
}
