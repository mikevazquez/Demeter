import Link from "next/link";

import { formatDateTime, getStudentPortalContext } from "@/lib/student/portal";

function movementTitle(
  type: string,
  activity: string | null,
  product: string,
  note: string | null,
) {
  if (type === "grant") return product || "Clases agregadas";
  if (type === "reserve") return activity ? `Reservaste ${activity}` : "Clase reservada";
  if (type === "release") return activity ? `Cancelaste ${activity}` : "Clase devuelta";
  if (type === "consume") return activity ?? "Clase utilizada";
  if (type === "adjustment") return note || "Ajuste de clases";
  return activity ?? product ?? "Movimiento de clases";
}

function movementDetail(type: string, product: string) {
  if (type === "grant") return "Clases agregadas a tu cuenta";
  if (type === "reserve") return "Apartadas para tu reserva";
  if (type === "release") return "Clase devuelta";
  if (type === "consume") return "Clase utilizada";
  if (type === "adjustment") return "Ajuste realizado por Demeter";
  return product;
}

function quantityCopy(quantity: number) {
  const absolute = Math.abs(quantity);
  const sign = quantity > 0 ? "+" : quantity < 0 ? "−" : "";
  return `${sign}${absolute} ${absolute === 1 ? "clase" : "clases"}`;
}

function quantityTone(quantity: number) {
  if (quantity > 0) return "text-emerald-300";
  if (quantity < 0) return "text-zinc-200";
  return "text-zinc-400";
}

export default async function StudentMovementsPage() {
  const { snapshot, studio } = await getStudentPortalContext();
  const activePackage =
    snapshot.acquisitions.find((item) => item.active_now && !item.reward_credit_wallet) ?? null;

  return (
    <main className="space-y-5 pb-6">
      <header>
        <Link
          href="/student/perfil"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-zinc-400 transition hover:text-white"
        >
          <span aria-hidden="true">←</span>
          Perfil
        </Link>
        <p className="student-eyebrow mt-3">Mi membresía</p>
        <h1 className="student-page-title mt-1">Uso de mis clases</h1>
        <p className="student-body mt-2">
          Consulta cuándo se agregaron, reservaron, utilizaron o devolvieron tus clases.
        </p>
      </header>

      {activePackage ? (
        <section data-movements-block="summary" className="student-card p-5">
          <p className="student-eyebrow">Paquete activo</p>
          <h2 className="mt-1 text-lg font-semibold text-white">{activePackage.name}</h2>
          <p className="mt-2 text-2xl font-semibold text-white">
            {activePackage.unlimited
              ? "Clases ilimitadas"
              : `${activePackage.available_credits ?? 0} clases disponibles`}
          </p>
          {activePackage.reserved_credits > 0 ? (
            <p className="mt-1 text-sm text-zinc-500">
              {activePackage.reserved_credits}{" "}
              {activePackage.reserved_credits === 1
                ? "próxima clase reservada"
                : "próximas clases reservadas"}
            </p>
          ) : null}
          <Link href="/student/paquete" className="student-action-secondary mt-4 w-full sm:w-auto">
            Ver mi paquete
          </Link>
        </section>
      ) : null}

      <section
        data-movements-block="history"
        className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]"
      >
        {snapshot.movements.length ? (
          <div className="divide-y divide-white/10">
            {snapshot.movements.map((movement) => {
              const title = movementTitle(
                movement.movement_type,
                movement.activity,
                movement.product,
                movement.note,
              );
              const detail = movementDetail(movement.movement_type, movement.product);

              return (
                <article
                  key={movement.id}
                  className="grid min-h-20 grid-cols-[1fr_auto] gap-4 px-4 py-4 sm:px-5"
                >
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-white">{title}</h2>
                    <p className="mt-1 text-sm text-zinc-500">{detail}</p>
                    <p className="mt-1 text-xs text-zinc-600">
                      {formatDateTime(movement.created_at, studio.timezone)}
                    </p>
                  </div>

                  <strong className={`shrink-0 text-sm ${quantityTone(movement.quantity)}`}>
                    {quantityCopy(movement.quantity)}
                  </strong>
                </article>
              );
            })}
          </div>
        ) : (
          <div data-movements-block="empty" className="p-8 text-center">
            <h2 className="font-semibold text-white">Todavía no hay uso registrado</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Cuando uses o recuperes clases, aparecerán aquí.
            </p>
            <Link
              href={activePackage ? "/student/reservar" : "/student/paquete"}
              className="student-action-secondary mt-5 w-full sm:w-auto"
            >
              {activePackage ? "Reservar una clase" : "Ver paquetes"}
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
